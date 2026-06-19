-- ============================================================================
-- 057_deduct_allow_negative_stock
--
-- Previously deduct_fulfilled_stock capped deductions at the current
-- qty_on_hand (LEAST logic), so if stock was already 0 the movement was
-- silently skipped. This caused orders to appear partially deducted.
--
-- Fix:
--   • Always deduct the full required qty, even if it pushes stock negative.
--   • When a deduction causes qty_on_hand < 0, the movement note carries a
--     ⚠ WARNING prefix so it is visible in the audit trail.
--   • The function return value gains a "went_negative" array listing the
--     SKUs that went below zero, for operational alerting.
--
-- Stock going negative is the signal that a receipt, stock count, or
-- production yield is missing — it must be investigated and corrected
-- rather than silently swallowed.
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
  v_orders_processed    int    := 0;
  v_rows_written        int    := 0;
  v_missing_skus        text[] := '{}';
  v_missing_boms        text[] := '{}';
  v_went_negative       text[] := '{}';
  v_order_missing_skus  text[] := '{}';
  v_order_missing_boms  text[] := '{}';
  v_order_went_negative text[] := '{}';
  ord             RECORD;
  r               RECORD;
  comp_r          RECORD;
  bom_rec         RECORD;
  v_committed     jsonb;
  comp_sku        text;
  meal_qty        numeric;
  overrides       jsonb;
  bom_found       boolean;
  sku_key         text;
  qty_to_deduct   numeric;
  v_pid           text;
  v_soh           stock_on_hand%ROWTYPE;
  v_note          text;
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
    v_committed           := '{}'::jsonb;
    v_order_missing_skus  := '{}';
    v_order_missing_boms  := '{}';
    v_order_went_negative := '{}';

    -- ── Step 1: build the set of SKUs + quantities to deduct ─────────────────
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

        -- Preferred: component lines already stored (same source as Packing List)
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
          -- Fall-back: no component lines — use pack_boms (older imported orders)
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
        -- Standalone (non-package) line — deduct directly
        v_committed := jsonb_set(
          v_committed,
          ARRAY[r.sku],
          to_jsonb(COALESCE((v_committed ->> r.sku)::numeric, 0) + r.qty),
          true
        );
      END IF;
    END LOOP;

    -- ── Step 2: deduct each SKU — always full qty, allow negative ────────────
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

      -- Always deduct full required qty — no LEAST() cap
      -- Build note; warn when this will push stock below zero
      IF COALESCE(v_soh.qty_on_hand, 0) < qty_to_deduct THEN
        v_note := '⚠ NEGATIVE STOCK — deducted ' || qty_to_deduct::text
                  || ' but only ' || COALESCE(v_soh.qty_on_hand, 0)::text
                  || ' was on hand. Check receipts/stock count for ' || sku_key || '.'
                  || ' (Order ' || COALESCE(ord.order_number, ord.id) || ')';
        IF NOT (sku_key = ANY(v_order_went_negative)) THEN
          v_order_went_negative := v_order_went_negative || sku_key;
        END IF;
      ELSE
        v_note := 'Auto-deduct on Shopify fulfilment of order '
                  || COALESCE(ord.order_number, ord.id);
      END IF;

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
          v_soh.location_id, qty_to_deduct, COALESCE(v_soh.uom, 'pcs'),
          'sale_fulfillment', 'sales_order', ord.id, ord.order_number,
          'sale_fulfillment:' || ord.id || ':' || sku_key,
          0,
          v_note,
          now(), now()
        );

        -- Allow qty_on_hand to go negative — it is the correctness signal
        UPDATE stock_on_hand
           SET qty_on_hand   = qty_on_hand - qty_to_deduct,
               qty_available = GREATEST(0, (qty_on_hand - qty_to_deduct) - COALESCE(qty_committed, 0)),
               updated_date  = now()
         WHERE id = v_soh.id;

        v_rows_written := v_rows_written + 1;
      END IF;
    END LOOP;

    v_missing_skus  := v_missing_skus  || v_order_missing_skus;
    v_missing_boms  := v_missing_boms  || v_order_missing_boms;
    v_went_negative := v_went_negative || v_order_went_negative;

    -- Mark complete when no unresolvable SKUs remain
    -- (negative-stock deductions are still valid deductions)
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
    'missing_boms',     v_missing_boms,
    'went_negative',    v_went_negative
  );
END;
$$;

GRANT EXECUTE ON FUNCTION deduct_fulfilled_stock(text, int) TO service_role, authenticated;
