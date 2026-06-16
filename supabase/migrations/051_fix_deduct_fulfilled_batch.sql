-- ============================================================================
-- 051_fix_deduct_fulfilled_batch
--
-- 1. Clear the existing backlog of fulfilled-but-undeducted orders by
--    marking them stock_deducted=true WITHOUT touching qty_on_hand.
--
-- 2. Replace deduct_fulfilled_stock() fixing four bugs found in code review:
--    BUG-1  Per-order missing tracking: orders with unresolved BOMs/SKUs are
--           left as stock_deducted=false so the cron retries them instead of
--           permanently marking them done with partial deductions.
--    BUG-2  Movement qty = actual deducted (LEAST of requested and on-hand),
--           not the requested qty, so the audit trail is accurate.
--    BUG-3  Call recalc_committed_stock() after the sweep batch so the
--           just-fulfilled orders stop inflating qty_committed immediately
--           (sweep path only; single-order webhook path relies on 15-min cron).
--    BUG-4  Handled in shopify-webhook-handler: deduction only fires when
--           sales_order_lines insert succeeded (see that file).
--
-- 3. Replace recalc_committed_stock() fixing the stale qty_available bug:
--    Previously the UPDATE was skipped when old_committed == new_committed,
--    even if qty_on_hand had changed (e.g. after a fulfillment deduction),
--    leaving qty_available permanently wrong until committed itself changed.
--    Now also updates when old_available != new_available.
-- ============================================================================

-- 1. Clear the backlog -------------------------------------------------------
UPDATE sales_orders
   SET stock_deducted    = true,
       stock_deducted_at = now()
 WHERE lifecycle_state = 'fulfilled'
   AND stock_deducted  = false;

-- 2. Corrected deduct_fulfilled_stock ----------------------------------------
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
  -- Per-order tracking: orders with unresolved SKUs/BOMs stay pending for retry
  v_order_missing_skus text[] := '{}';
  v_order_missing_boms text[] := '{}';
  ord             RECORD;
  r               RECORD;
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

    -- Step 1: explode order lines into component SKUs.
    FOR r IN
      SELECT sol.sku, sol.qty, sol.is_package_parent
      FROM   sales_order_lines sol
      WHERE  sol.sales_order_id      = ord.id
        AND  sol.is_package_component = false
        AND  sol.status               = 'active'
        AND  sol.sku IS NOT NULL
        AND  COALESCE(sol.line_type, '') NOT IN ('bundle', 'bundle_child')
    LOOP
      IF r.is_package_parent THEN
        bom_found := false;
        FOR bom_rec IN
          SELECT multiplier, component_skus, disabled_skus, sku_overrides
          FROM   pack_boms
          WHERE  package_sku = r.sku AND active = true
          LIMIT 1
        LOOP
          bom_found := true;
          overrides := CASE
            WHEN bom_rec.sku_overrides IS NULL OR bom_rec.sku_overrides = '' OR bom_rec.sku_overrides = '{}'
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
      ELSE
        v_committed := jsonb_set(
          v_committed,
          ARRAY[r.sku],
          to_jsonb(COALESCE((v_committed ->> r.sku)::numeric, 0) + r.qty),
          true
        );
      END IF;
    END LOOP;

    -- Step 2: deduct each component SKU and write one idempotent movement.
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

      -- Record what was actually taken (capped at on-hand), not what was requested.
      v_actual_deduct := LEAST(qty_to_deduct, COALESCE(v_soh.qty_on_hand, 0));

      -- Idempotency: skip if a movement for this order+sku already exists.
      -- Uses NOT EXISTS rather than ON CONFLICT because stock_movements has no
      -- unique constraint on reference_key (avoids requiring a schema change).
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
          v_soh.location_id, v_actual_deduct, COALESCE(v_soh.uom, 'pcs'), 'sale_fulfillment',
          'sales_order', ord.id, ord.order_number,
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

    -- Accumulate into the global missing arrays for the return payload.
    v_missing_skus := v_missing_skus || v_order_missing_skus;
    v_missing_boms := v_missing_boms || v_order_missing_boms;

    -- Only mark done when every SKU in this order was resolved.
    -- Partial orders stay pending so the cron retries them next run.
    IF v_order_missing_skus = '{}' AND v_order_missing_boms = '{}' THEN
      UPDATE sales_orders
         SET stock_deducted    = true,
             stock_deducted_at = now()
       WHERE id = ord.id;
      v_orders_processed := v_orders_processed + 1;
    END IF;
  END LOOP;

  -- After a sweep batch, immediately recalculate committed stock so the
  -- just-fulfilled orders no longer inflate qty_committed / qty_available.
  -- Skipped on single-order webhook calls (p_order_id set) to keep latency low;
  -- the 15-min cron corrects those within one tick.
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

-- 3. Fix recalc_committed_stock: update qty_available even when committed -----
--    hasn't changed (e.g. after a fulfillment deduction changed qty_on_hand).
CREATE OR REPLACE FUNCTION recalc_committed_stock()
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_committed    jsonb    := '{}'::jsonb;
  v_written      int      := 0;
  r              RECORD;
  bom_rec        RECORD;
  comp_sku       text;
  meal_qty       numeric;
  overrides      jsonb;
  new_committed  numeric;
  new_available  numeric;
  seen_products  text[]   := '{}';
  missing_boms   text[]   := '{}';
  bom_found      boolean;
BEGIN

  -- Step 1: walk every active non-component, non-bundle line on paid_unfulfilled orders.
  FOR r IN
    SELECT sol.sku, sol.qty, sol.is_package_parent
    FROM   sales_order_lines sol
    JOIN   sales_orders so ON so.id = sol.sales_order_id
    WHERE  so.lifecycle_state       = 'paid_unfulfilled'
      AND  sol.is_package_component = false
      AND  sol.status               = 'active'
      AND  sol.sku IS NOT NULL
      AND  COALESCE(sol.line_type, '') NOT IN ('bundle', 'bundle_child')
  LOOP
    IF r.is_package_parent THEN
      bom_found := false;
      FOR bom_rec IN
        SELECT multiplier, component_skus, disabled_skus, sku_overrides
        FROM   pack_boms
        WHERE  package_sku = r.sku AND active = true
        LIMIT 1
      LOOP
        bom_found := true;
        overrides := CASE
          WHEN bom_rec.sku_overrides IS NULL OR bom_rec.sku_overrides = '' OR bom_rec.sku_overrides = '{}'
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
      IF NOT bom_found AND NOT (r.sku = ANY(missing_boms)) THEN
        missing_boms := missing_boms || r.sku;
      END IF;
    ELSE
      v_committed := jsonb_set(
        v_committed,
        ARRAY[r.sku],
        to_jsonb(COALESCE((v_committed ->> r.sku)::numeric, 0) + r.qty),
        true
      );
    END IF;
  END LOOP;

  -- Step 2: write to stock_on_hand — one row per product only.
  FOR r IN
    SELECT soh.id,
           soh.product_id,
           soh.qty_on_hand,
           soh.qty_committed AS old_committed,
           soh.qty_available AS old_available,
           p.sku
    FROM   stock_on_hand soh
    JOIN   products p ON p.id = soh.product_id
    WHERE  p.sku IS NOT NULL
    ORDER  BY soh.product_id,
              soh.qty_on_hand DESC NULLS LAST,
              soh.id
  LOOP
    IF r.product_id = ANY(seen_products) THEN
      -- Secondary location row: zero out committed; available = full on-hand.
      -- Also write when qty_available is stale even if committed was already 0.
      IF COALESCE(r.old_committed, 0) != 0
         OR COALESCE(r.old_available, 0) != GREATEST(0, COALESCE(r.qty_on_hand, 0)) THEN
        UPDATE stock_on_hand
           SET qty_committed = 0,
               qty_available = GREATEST(0, COALESCE(r.qty_on_hand, 0)),
               updated_date  = now()
         WHERE id = r.id;
        v_written := v_written + 1;
      END IF;
    ELSE
      -- Primary row: write total committed here; zero it on all others.
      seen_products := seen_products || r.product_id;
      new_committed := COALESCE((v_committed ->> r.sku)::numeric, 0);
      new_available := GREATEST(0, COALESCE(r.qty_on_hand, 0) - new_committed);

      -- Update when committed changed OR when qty_available is stale
      -- (qty_on_hand can change independently via fulfillment deductions).
      IF COALESCE(r.old_committed, 0) != new_committed
         OR COALESCE(r.old_available, 0) != new_available THEN
        UPDATE stock_on_hand
           SET qty_committed = new_committed,
               qty_available = new_available,
               updated_date  = now()
         WHERE id = r.id;
        v_written := v_written + 1;
      END IF;
    END IF;
  END LOOP;

  RETURN json_build_object(
    'status',        'completed',
    'rows_written',  v_written,
    'unique_skus',   (SELECT COUNT(*) FROM jsonb_object_keys(v_committed)),
    'missing_boms',  missing_boms
  );
END;
$$;
