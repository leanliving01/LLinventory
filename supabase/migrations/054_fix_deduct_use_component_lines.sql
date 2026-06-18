-- ============================================================================
-- 054_fix_deduct_use_component_lines
--
-- Bug: deduct_fulfilled_stock expanded package SKUs via pack_boms.
-- If pack_boms had wrong/incomplete data (e.g. MenLeaMus30 only had MLM1
-- instead of all 12 components), the wrong qty or wrong SKUs were deducted.
--
-- Fix: when sales_order_lines already has is_package_component=true rows
-- for a parent line, use those directly — they are the ground truth (same
-- source the Packing List tab uses). Fall back to pack_boms only for older
-- orders that lack component rows.
--
-- Data cleanup: reverse and reset all fulfilled orders that have component
-- lines so they are re-processed correctly on the next cron run.
-- ============================================================================

CREATE OR REPLACE FUNCTION deduct_fulfilled_stock(
  p_order_id text DEFAULT NULL,
  p_limit    int  DEFAULT 50
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_orders_processed   int    := 0;
  v_rows_written       int    := 0;
  v_missing_skus       text[] := '{}';
  v_missing_boms       text[] := '{}';
  v_order_missing_skus text[] := '{}';
  v_order_missing_boms text[] := '{}';
  ord             RECORD;
  r               RECORD;
  comp_r          RECORD;   -- component line from sales_order_lines
  bom_rec         RECORD;
  v_committed     jsonb;
  comp_sku        text;
  meal_qty        numeric;
  overrides       jsonb;
  bom_found       boolean;
  sku_key         text;
  qty_to_deduct   numeric;
  v_actual_deduct numeric;
  v_pid           text;
  v_soh           stock_on_hand%ROWTYPE;
BEGIN
  FOR ord IN
    SELECT id, order_number
    FROM   sales_orders
    WHERE  lifecycle_state = 'fulfilled'
      AND  stock_deducted  = false
      AND  (p_order_id IS NULL OR id = p_order_id)
    ORDER  BY order_date NULLS LAST, id
    LIMIT  CASE WHEN p_order_id IS NULL THEN p_limit ELSE 1 END
  LOOP
    v_committed          := '{}'::jsonb;
    v_order_missing_skus := '{}';
    v_order_missing_boms := '{}';

    -- Step 1: build the set of SKUs + quantities to deduct.
    FOR r IN
      SELECT sol.id, sol.sku, sol.qty, sol.is_package_parent
      FROM   sales_order_lines sol
      WHERE  sol.sales_order_id      = ord.id
        AND  sol.is_package_component = false
        AND  sol.status               = 'active'
        AND  sol.sku IS NOT NULL
        AND  COALESCE(sol.line_type, '') NOT IN ('bundle', 'bundle_child')
    LOOP
      IF r.is_package_parent THEN

        -- Preferred path: component lines are already stored in sales_order_lines
        -- (same source as the Packing List tab — ground truth).
        IF EXISTS (
          SELECT 1
          FROM   sales_order_lines comp
          WHERE  comp.parent_line_id      = r.id
            AND  comp.is_package_component = true
            AND  comp.status               = 'active'
            AND  comp.sku                  IS NOT NULL
        ) THEN
          FOR comp_r IN
            SELECT comp.sku, comp.qty
            FROM   sales_order_lines comp
            WHERE  comp.parent_line_id      = r.id
              AND  comp.is_package_component = true
              AND  comp.status               = 'active'
              AND  comp.sku                  IS NOT NULL
          LOOP
            v_committed := jsonb_set(
              v_committed,
              ARRAY[comp_r.sku],
              to_jsonb(COALESCE((v_committed ->> comp_r.sku)::numeric, 0) + comp_r.qty),
              true
            );
          END LOOP;

        ELSE
          -- Fall-back: no component lines stored — use pack_boms (older imported orders).
          bom_found := false;
          FOR bom_rec IN
            SELECT multiplier, component_skus, disabled_skus, sku_overrides
            FROM   pack_boms
            WHERE  package_sku = r.sku AND active = true
            LIMIT  1
          LOOP
            bom_found := true;
            overrides := CASE
              WHEN bom_rec.sku_overrides IS NULL
                OR bom_rec.sku_overrides = ''
                OR bom_rec.sku_overrides = '{}'
              THEN '{}'::jsonb
              ELSE bom_rec.sku_overrides::jsonb
            END;

            FOREACH comp_sku IN ARRAY COALESCE(bom_rec.component_skus, '{}') LOOP
              IF bom_rec.disabled_skus IS NOT NULL
                 AND comp_sku = ANY(bom_rec.disabled_skus) THEN
                CONTINUE;
              END IF;
              meal_qty := COALESCE(
                (overrides ->> comp_sku)::numeric,
                bom_rec.multiplier::numeric
              ) * r.qty;
              v_committed := jsonb_set(
                v_committed,
                ARRAY[comp_sku],
                to_jsonb(COALESCE((v_committed ->> comp_sku)::numeric, 0) + meal_qty),
                true
              );
            END LOOP;
          END LOOP;

          IF NOT bom_found AND NOT (r.sku = ANY(v_order_missing_boms)) THEN
            v_order_missing_boms := v_order_missing_boms || r.sku;
          END IF;
        END IF;

      ELSE
        -- Standalone (non-package) line — deduct directly.
        v_committed := jsonb_set(
          v_committed,
          ARRAY[r.sku],
          to_jsonb(COALESCE((v_committed ->> r.sku)::numeric, 0) + r.qty),
          true
        );
      END IF;
    END LOOP;

    -- Step 2: deduct each SKU and write one idempotent movement.
    FOR sku_key, qty_to_deduct IN
      SELECT key, value::numeric FROM jsonb_each_text(v_committed)
    LOOP
      IF qty_to_deduct IS NULL OR qty_to_deduct = 0 THEN CONTINUE; END IF;

      SELECT id INTO v_pid FROM products WHERE sku = sku_key LIMIT 1;
      IF v_pid IS NULL THEN
        IF NOT (sku_key = ANY(v_order_missing_skus)) THEN
          v_order_missing_skus := v_order_missing_skus || sku_key;
        END IF;
        CONTINUE;
      END IF;

      SELECT * INTO v_soh
      FROM   stock_on_hand
      WHERE  product_id = v_pid
      ORDER  BY qty_on_hand DESC NULLS LAST, id
      LIMIT  1;

      IF v_soh.id IS NULL THEN
        IF NOT (sku_key = ANY(v_order_missing_skus)) THEN
          v_order_missing_skus := v_order_missing_skus || sku_key;
        END IF;
        CONTINUE;
      END IF;

      v_actual_deduct := LEAST(qty_to_deduct, COALESCE(v_soh.qty_on_hand, 0));
      IF v_actual_deduct <= 0 THEN CONTINUE; END IF;

      IF NOT EXISTS (
        SELECT 1 FROM stock_movements
        WHERE reference_key = 'sale_fulfillment:' || ord.id || ':' || sku_key
      ) THEN
        INSERT INTO stock_movements (
          id, product_id, product_sku, product_name,
          from_location_id, qty, uom, reason, ref_type, ref_id, ref_number,
          reference_key, unit_cost_at_movement, notes, created_date, updated_date
        ) VALUES (
          gen_random_uuid()::text, v_pid, sku_key, v_soh.product_name,
          v_soh.location_id, v_actual_deduct, COALESCE(v_soh.uom, 'pcs'),
          'sale_fulfillment', 'sales_order', ord.id, ord.order_number,
          'sale_fulfillment:' || ord.id || ':' || sku_key,
          0,
          'Auto-deduct on Shopify fulfilment of order ' || COALESCE(ord.order_number, ord.id),
          now(), now()
        );

        UPDATE stock_on_hand
           SET qty_on_hand   = qty_on_hand - v_actual_deduct,
               qty_available = GREATEST(0, (qty_on_hand - v_actual_deduct) - COALESCE(qty_committed, 0)),
               updated_date  = now()
         WHERE id = v_soh.id;
        v_rows_written := v_rows_written + 1;
      END IF;
    END LOOP;

    v_missing_skus := v_missing_skus || v_order_missing_skus;
    v_missing_boms := v_missing_boms || v_order_missing_boms;

    IF v_order_missing_skus = '{}' AND v_order_missing_boms = '{}' THEN
      UPDATE sales_orders
         SET stock_deducted    = true,
             stock_deducted_at = now()
       WHERE id = ord.id;
      v_orders_processed := v_orders_processed + 1;
    END IF;
  END LOOP;

  IF v_orders_processed > 0 AND p_order_id IS NULL THEN
    PERFORM recalc_committed_stock();
  END IF;

  RETURN json_build_object(
    'status',           'completed',
    'orders_processed', v_orders_processed,
    'rows_written',     v_rows_written,
    'missing_skus',     v_missing_skus,
    'missing_boms',     v_missing_boms
  );
END;
$$;

GRANT EXECUTE ON FUNCTION deduct_fulfilled_stock(text, int) TO service_role, authenticated;

-- ── Data cleanup ─────────────────────────────────────────────────────────────
-- Reverse and reset fulfilled orders that have is_package_component rows in
-- sales_order_lines. These were previously deducted via pack_boms (which may
-- have been wrong). The fixed function will re-process them correctly using
-- the component lines on the next cron invocation.
--
-- Orders with NO component lines (imported without BOM explosion) keep their
-- existing movements — the pack_boms fallback path handles them.
-- ─────────────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  ord_rec  RECORD;
  mov_rec  RECORD;
  n_orders int := 0;
  n_movs   int := 0;
BEGIN
  FOR ord_rec IN
    SELECT DISTINCT so.id, so.order_number
    FROM   sales_orders so
    WHERE  so.stock_deducted  = true
      AND  so.lifecycle_state = 'fulfilled'
      -- Has at least one pack parent line with component children
      AND  EXISTS (
        SELECT 1
        FROM   sales_order_lines parent
        JOIN   sales_order_lines comp
               ON comp.parent_line_id = parent.id
        WHERE  parent.sales_order_id   = so.id
          AND  parent.is_package_parent = true
          AND  comp.is_package_component = true
          AND  comp.status               = 'active'
      )
    ORDER BY so.id
  LOOP
    -- Reverse each existing sale_fulfillment movement for this order
    FOR mov_rec IN
      SELECT sm.product_id, sm.from_location_id, sm.qty
      FROM   stock_movements sm
      WHERE  sm.ref_id = ord_rec.id
        AND  sm.reason = 'sale_fulfillment'
    LOOP
      UPDATE stock_on_hand
         SET qty_on_hand   = qty_on_hand + mov_rec.qty,
             qty_available = qty_available + mov_rec.qty,
             updated_date  = now()
       WHERE product_id  = mov_rec.product_id
         AND location_id = mov_rec.from_location_id;
    END LOOP;

    -- Delete the movements so the idempotency key is cleared
    DELETE FROM stock_movements
     WHERE ref_id = ord_rec.id
       AND reason = 'sale_fulfillment';

    GET DIAGNOSTICS n_movs = ROW_COUNT;

    -- Reset so the cron picks it up again
    UPDATE sales_orders
       SET stock_deducted    = false,
           stock_deducted_at = null
     WHERE id = ord_rec.id;

    n_orders := n_orders + 1;
  END LOOP;

  RAISE NOTICE 'Reset % orders with component-line packs for re-deduction.', n_orders;
END;
$$;
