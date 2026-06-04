-- ============================================================================
-- 033_deduct_fulfilled_stock
-- Deduct physical stock (qty_on_hand) when a Shopify order is fulfilled.
--
-- Today a sale only reserves (qty_committed on paid_unfulfilled) then releases.
-- This migration adds the missing "deplete" step: on the unfulfilled -> fulfilled
-- transition, deduct the sold qty from the PRIMARY stock_on_hand row (highest
-- on-hand) and write a 'sale_fulfillment' audit row to stock_movements.
--
-- Idempotency: two layers.
--   1. stock_movements.reference_key UNIQUE  ('sale_fulfillment:{order_id}:{sku}')
--      -> ON CONFLICT DO NOTHING makes a re-run a no-op.
--   2. sales_orders.stock_deducted boolean flips true once processed (sticky;
--      never reset) so the batch scan skips it.
--
-- Reversals: NONE here. Stock physically returned is added back manually with a
-- reason via the existing returns flow. The sticky flag prevents re-deduction.
-- ============================================================================

-- 1. Idempotency / status columns on sales_orders ---------------------------
ALTER TABLE sales_orders
  ADD COLUMN IF NOT EXISTS stock_deducted    boolean NOT NULL DEFAULT false;
ALTER TABLE sales_orders
  ADD COLUMN IF NOT EXISTS stock_deducted_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_sales_orders_stock_deducted
  ON sales_orders(stock_deducted) WHERE stock_deducted = false;

-- 2. SAFETY BACKFILL: mark every already-fulfilled order as done so go-live
--    does NOT retroactively drain stock. Only orders fulfilled AFTER this point
--    will deduct.
UPDATE sales_orders
   SET stock_deducted    = true,
       stock_deducted_at = now()
 WHERE lifecycle_state = 'fulfilled'
   AND stock_deducted  = false;

-- 3. Engine: deduct_fulfilled_stock(p_order_id) -----------------------------
--    p_order_id NULL  -> sweep all fulfilled & not-yet-deducted orders (cron).
--    p_order_id set   -> process just that order (webhook).
CREATE OR REPLACE FUNCTION deduct_fulfilled_stock(p_order_id text DEFAULT NULL)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_orders_processed int    := 0;
  v_rows_written     int    := 0;
  v_missing_skus     text[] := '{}';
  v_missing_boms     text[] := '{}';
  ord            RECORD;
  r              RECORD;
  bom_rec        RECORD;
  v_committed    jsonb;          -- per-order: component sku => qty
  comp_sku       text;
  meal_qty       numeric;
  overrides      jsonb;
  bom_found      boolean;
  sku_key        text;
  qty_to_deduct  numeric;
  v_pid          text;
  v_soh          stock_on_hand%ROWTYPE;
  v_unit_cost    numeric;
BEGIN
  FOR ord IN
    SELECT id, order_number
    FROM   sales_orders
    WHERE  lifecycle_state = 'fulfilled'
      AND  stock_deducted  = false
      AND  (p_order_id IS NULL OR id = p_order_id)
    ORDER  BY order_date NULLS LAST, id
  LOOP
    v_committed := '{}'::jsonb;

    -- Step 1: explode the order's active, non-component lines into component SKUs.
    --         Mirrors recalc_committed_stock (004_recalc_committed_rpc.sql:26-81).
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
        IF NOT bom_found AND NOT (r.sku = ANY(v_missing_boms)) THEN
          v_missing_boms := v_missing_boms || r.sku;
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

    -- Step 2: deduct each component SKU from its primary stock_on_hand row and
    --         write one idempotent 'sale_fulfillment' movement per (order, sku).
    FOR sku_key, qty_to_deduct IN
      SELECT key, value::numeric FROM jsonb_each_text(v_committed)
    LOOP
      IF qty_to_deduct IS NULL OR qty_to_deduct = 0 THEN CONTINUE; END IF;

      SELECT id INTO v_pid FROM products WHERE sku = sku_key LIMIT 1;
      IF v_pid IS NULL THEN
        IF NOT (sku_key = ANY(v_missing_skus)) THEN v_missing_skus := v_missing_skus || sku_key; END IF;
        CONTINUE;
      END IF;

      -- Primary row = location with the most stock (same rule as committed calc).
      SELECT * INTO v_soh
      FROM   stock_on_hand
      WHERE  product_id = v_pid
      ORDER  BY qty_on_hand DESC NULLS LAST, id
      LIMIT  1;

      IF v_soh.id IS NULL THEN
        IF NOT (sku_key = ANY(v_missing_skus)) THEN v_missing_skus := v_missing_skus || sku_key; END IF;
        CONTINUE;
      END IF;

      v_unit_cost := 0;  -- stock_on_hand has no cost column; movements record 0 cost here.

      -- Idempotent audit row. ON CONFLICT means a re-run for the same (order,sku)
      -- inserts nothing, and FOUND stays false -> we skip the on-hand update too.
      INSERT INTO stock_movements (
        id, product_id, product_sku, product_name,
        from_location_id, qty, uom, reason, ref_type, ref_id, ref_number,
        reference_key, unit_cost_at_movement, notes, created_date, updated_date
      ) VALUES (
        gen_random_uuid()::text, v_pid, sku_key, v_soh.product_name,
        v_soh.location_id, qty_to_deduct, COALESCE(v_soh.uom, 'pcs'), 'sale_fulfillment',
        'sales_order', ord.id, ord.order_number,
        'sale_fulfillment:' || ord.id || ':' || sku_key,
        v_unit_cost,
        'Auto-deduct on Shopify fulfilment of order ' || COALESCE(ord.order_number, ord.id),
        now(), now()
      )
      ON CONFLICT (reference_key) DO NOTHING;

      IF FOUND THEN
        UPDATE stock_on_hand
           SET qty_on_hand   = GREATEST(0, qty_on_hand - qty_to_deduct),
               qty_available = GREATEST(0, GREATEST(0, qty_on_hand - qty_to_deduct) - COALESCE(qty_committed, 0)),
               updated_date  = now()
         WHERE id = v_soh.id;
        v_rows_written := v_rows_written + 1;
      END IF;
    END LOOP;

    -- Step 3: mark the order done (sticky — never reset).
    UPDATE sales_orders
       SET stock_deducted    = true,
           stock_deducted_at = now()
     WHERE id = ord.id;
    v_orders_processed := v_orders_processed + 1;
  END LOOP;

  RETURN json_build_object(
    'status',           'completed',
    'orders_processed', v_orders_processed,
    'rows_written',     v_rows_written,
    'missing_skus',     v_missing_skus,
    'missing_boms',     v_missing_boms
  );
END;
$$;

-- 4. Dry-run: compute what WOULD be deducted across pending orders, write nothing.
CREATE OR REPLACE FUNCTION deduct_fulfilled_stock_dry_run(p_order_id text DEFAULT NULL)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_orders       int    := 0;
  v_committed    jsonb  := '{}'::jsonb;   -- aggregate sku => qty across orders
  v_missing_boms text[] := '{}';
  ord            RECORD;
  r              RECORD;
  bom_rec        RECORD;
  comp_sku       text;
  meal_qty       numeric;
  overrides      jsonb;
  bom_found      boolean;
BEGIN
  FOR ord IN
    SELECT id
    FROM   sales_orders
    WHERE  lifecycle_state = 'fulfilled'
      AND  stock_deducted  = false
      AND  (p_order_id IS NULL OR id = p_order_id)
  LOOP
    v_orders := v_orders + 1;
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
          FROM   pack_boms WHERE package_sku = r.sku AND active = true LIMIT 1
        LOOP
          bom_found := true;
          overrides := CASE
            WHEN bom_rec.sku_overrides IS NULL OR bom_rec.sku_overrides = '' OR bom_rec.sku_overrides = '{}'
            THEN '{}'::jsonb ELSE bom_rec.sku_overrides::jsonb END;
          FOREACH comp_sku IN ARRAY COALESCE(bom_rec.component_skus, '{}') LOOP
            IF bom_rec.disabled_skus IS NOT NULL AND comp_sku = ANY(bom_rec.disabled_skus) THEN CONTINUE; END IF;
            meal_qty := COALESCE((overrides ->> comp_sku)::numeric, bom_rec.multiplier::numeric) * r.qty;
            v_committed := jsonb_set(v_committed, ARRAY[comp_sku],
              to_jsonb(COALESCE((v_committed ->> comp_sku)::numeric, 0) + meal_qty), true);
          END LOOP;
        END LOOP;
        IF NOT bom_found AND NOT (r.sku = ANY(v_missing_boms)) THEN
          v_missing_boms := v_missing_boms || r.sku;
        END IF;
      ELSE
        v_committed := jsonb_set(v_committed, ARRAY[r.sku],
          to_jsonb(COALESCE((v_committed ->> r.sku)::numeric, 0) + r.qty), true);
      END IF;
    END LOOP;
  END LOOP;

  RETURN json_build_object(
    'status',               'dry_run',
    'orders_pending',       v_orders,
    'would_deduct_by_sku',  v_committed,
    'unique_skus',          (SELECT COUNT(*) FROM jsonb_object_keys(v_committed)),
    'missing_boms',         v_missing_boms
  );
END;
$$;

GRANT EXECUTE ON FUNCTION deduct_fulfilled_stock(text)         TO service_role, authenticated;
GRANT EXECUTE ON FUNCTION deduct_fulfilled_stock_dry_run(text) TO service_role, authenticated;
