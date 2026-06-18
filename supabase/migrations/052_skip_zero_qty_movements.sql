-- ============================================================================
-- 052_skip_zero_qty_movements
--
-- Fix: deduct_fulfilled_stock was writing stock_movements with qty=0 when
-- qty_on_hand = 0 (LEAST(requested, 0) = 0). Zero-qty movements are noise
-- in the audit trail — skip the INSERT and stock_on_hand UPDATE when nothing
-- was actually deducted.
--
-- The order is still marked stock_deducted=true once all SKUs are processed.
-- (Retrying forever when stock is 0 would cause infinite loops; if stock
-- comes in later and needs to be reconciled, that's a manual stocktake adj.)
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

      v_actual_deduct := LEAST(qty_to_deduct, COALESCE(v_soh.qty_on_hand, 0));

      -- Skip when nothing to deduct — on-hand was already 0.
      -- Zero-qty movements are noise in the audit trail.
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

-- Clean up existing zero-qty movements — they serve no audit purpose.
DELETE FROM stock_movements WHERE qty = 0 AND reason = 'sale_fulfillment';
