-- ============================================================================
-- 048_order_fulfilment_costs
-- Auto-snapshot each order's true fulfilment cost at fulfilment time:
--   * packaging materials  = packing_material_rules applied to the order,
--                            each material costed at its inventory cost_avg
--   * courier              = a configurable standard fee (settings)
-- Snapshotted as sales_order_costs rows (reference='auto-fulfilment') so they
-- flow into order_profitability.added_order_costs and net_profit automatically,
-- and are LOCKED IN at the moment of fulfilment (historical accuracy).
--
-- Inventory product COGS already flows into profitability separately (043,
-- components costed at products.cost_avg) — this only adds packaging + courier.
--
-- Trigger fires when sales_orders.stock_deducted flips true — the single choke
-- point both Shopify (webhook/cron -> deduct_fulfilled_stock) and manual
-- (fulfill_manual_order -> deduct_fulfilled_stock) fulfilment pass through, so
-- the core stock function is left untouched.
-- ============================================================================

-- 0. Standard courier cost setting (editable in Settings -> Packing Materials).
INSERT INTO settings (id, key, value, "group", label)
SELECT gen_random_uuid()::text, 'standard_courier_cost', '0', 'org', 'Standard courier cost per order (R)'
WHERE NOT EXISTS (SELECT 1 FROM settings WHERE key = 'standard_courier_cost');

-- 1. Compute + snapshot fulfilment costs for one order (idempotent / locked-in).
CREATE OR REPLACE FUNCTION snapshot_order_fulfilment_costs(p_order_id text)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_meals      numeric := 0;
  v_supp_units numeric := 0;
  v_has_meals  boolean := false;
  v_has_supp   boolean := false;
  v_rule       RECORD;
  v_materials  jsonb;
  v_mat        jsonb;
  v_pid        text;
  v_qty        numeric;
  v_basis      numeric;
  v_cost       numeric;
  v_name       text;
  v_pkg_total  numeric := 0;
  v_breakdown  text := '';
  v_courier    numeric := 0;
  v_order_num  text;
BEGIN
  -- Locked-in: never overwrite an existing auto snapshot.
  IF EXISTS (SELECT 1 FROM sales_order_costs
             WHERE sales_order_id = p_order_id AND reference = 'auto-fulfilment') THEN
    RETURN json_build_object('order_id', p_order_id, 'status', 'already_snapshotted');
  END IF;

  SELECT order_number INTO v_order_num FROM sales_orders WHERE id = p_order_id;

  -- Meal count + supplement units from the shared component explosion.
  SELECT
    COALESCE(SUM(e.qty) FILTER (WHERE p.type = 'finished_meal'), 0),
    COALESCE(SUM(e.qty) FILTER (WHERE p.type = 'supplement'), 0)
  INTO v_meals, v_supp_units
  FROM explode_order_components(p_order_id) e
  LEFT JOIN products p ON p.sku = e.sku;

  v_has_meals := v_meals > 0;
  v_has_supp  := v_supp_units > 0;

  -- Packaging: evaluate every active rule that applies to this order.
  FOR v_rule IN SELECT * FROM packing_material_rules WHERE is_active = true LOOP
    IF v_rule.trigger = 'has_meals'       AND NOT v_has_meals THEN CONTINUE; END IF;
    IF v_rule.trigger = 'has_supplements' AND NOT v_has_supp  THEN CONTINUE; END IF;

    v_basis := CASE v_rule.trigger
                 WHEN 'has_meals'       THEN v_meals
                 WHEN 'has_supplements' THEN v_supp_units
                 ELSE (v_meals + v_supp_units) END;

    -- materials JSON (fall back to legacy single-material columns).
    BEGIN
      v_materials := v_rule.materials::jsonb;
    EXCEPTION WHEN OTHERS THEN
      v_materials := NULL;
    END;
    IF v_materials IS NULL OR jsonb_typeof(v_materials) <> 'array'
       OR jsonb_array_length(v_materials) = 0 THEN
      IF v_rule.material_product_id IS NOT NULL THEN
        v_materials := jsonb_build_array(jsonb_build_object(
          'product_id',       v_rule.material_product_id,
          'name',             v_rule.material_name,
          'deduction_mode',   COALESCE(v_rule.deduction_mode, 'fixed_per_order'),
          'qty_per_deduction',COALESCE(v_rule.qty_per_deduction, 1),
          'per_x_items',      COALESCE(v_rule.per_x_items, 1)));
      ELSE
        v_materials := '[]'::jsonb;
      END IF;
    END IF;

    FOR v_mat IN SELECT * FROM jsonb_array_elements(v_materials) LOOP
      v_pid := v_mat->>'product_id';
      IF v_pid IS NULL OR v_pid = '' THEN CONTINUE; END IF;

      IF COALESCE(v_mat->>'deduction_mode', 'fixed_per_order') = 'per_x_items' THEN
        v_qty := ceil(v_basis / GREATEST(COALESCE((v_mat->>'per_x_items')::numeric, 1), 1))
                 * COALESCE((v_mat->>'qty_per_deduction')::numeric, 1);
      ELSE
        v_qty := COALESCE((v_mat->>'qty_per_deduction')::numeric, 1);
      END IF;
      IF v_qty IS NULL OR v_qty <= 0 THEN CONTINUE; END IF;

      SELECT cost_avg, name INTO v_cost, v_name FROM products WHERE id = v_pid LIMIT 1;
      IF v_cost IS NULL OR v_cost = 0 THEN CONTINUE; END IF;

      v_pkg_total := v_pkg_total + (v_qty * v_cost);
      v_breakdown := v_breakdown || COALESCE(v_mat->>'name', v_name, 'material')
                     || ' x' || trim(to_char(v_qty, 'FM999990.##')) || '; ';
    END LOOP;
  END LOOP;

  -- Courier: standard fee from settings.
  BEGIN
    SELECT NULLIF(value, '')::numeric INTO v_courier
    FROM settings WHERE key = 'standard_courier_cost' LIMIT 1;
  EXCEPTION WHEN OTHERS THEN
    v_courier := 0;
  END;
  v_courier := COALESCE(v_courier, 0);

  IF v_pkg_total > 0 THEN
    INSERT INTO sales_order_costs (id, created_by, sales_order_id, order_number,
      cost_type, description, reference, amount, cost_date)
    VALUES (gen_random_uuid()::text, 'system', p_order_id, v_order_num,
      'packaging', NULLIF(trim(v_breakdown), ''), 'auto-fulfilment', round(v_pkg_total, 2), CURRENT_DATE);
  END IF;

  IF v_courier > 0 THEN
    INSERT INTO sales_order_costs (id, created_by, sales_order_id, order_number,
      cost_type, description, reference, amount, cost_date)
    VALUES (gen_random_uuid()::text, 'system', p_order_id, v_order_num,
      'courier_actual', 'Standard courier fee', 'auto-fulfilment', round(v_courier, 2), CURRENT_DATE);
  END IF;

  RETURN json_build_object(
    'order_id', p_order_id, 'status', 'snapshotted',
    'packaging_cost', round(v_pkg_total, 2), 'courier_cost', round(v_courier, 2),
    'meals', v_meals, 'supplement_units', v_supp_units);
END;
$$;

-- 2. Trigger: snapshot the moment stock is deducted (= order fulfilled).
CREATE OR REPLACE FUNCTION trg_snapshot_fulfilment_costs()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.stock_deducted = true AND COALESCE(OLD.stock_deducted, false) = false THEN
    BEGIN
      PERFORM snapshot_order_fulfilment_costs(NEW.id);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'snapshot_order_fulfilment_costs failed for %: %', NEW.id, SQLERRM;
    END;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sales_orders_fulfil_cost_snapshot ON sales_orders;
CREATE TRIGGER trg_sales_orders_fulfil_cost_snapshot
  AFTER UPDATE OF stock_deducted ON sales_orders
  FOR EACH ROW EXECUTE FUNCTION trg_snapshot_fulfilment_costs();

-- 3. order_profitability: unchanged maths, plus a cost breakdown by type so the
--    Profitability tab can show packaging / courier / other separately.
CREATE OR REPLACE FUNCTION order_profitability(p_order_id text)
RETURNS json
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_product_revenue numeric := 0;
  v_discounts       numeric := 0;
  v_shipping        numeric := 0;
  v_voucher_credit  numeric := 0;
  v_refunds_fin     numeric := 0;
  v_refunds_returns numeric := 0;
  v_other_charges   numeric := 0;
  v_product_cogs    numeric := 0;
  v_added_costs     numeric := 0;
  v_missing_cost    text[]  := '{}';
  v_missing_boms    text[]  := '{}';
  v_breakdown       json;
  c                 RECORD;
  v_cost            numeric;
  v_net             numeric;
BEGIN
  SELECT COALESCE(SUM(line_total), 0) INTO v_product_revenue
  FROM   sales_order_lines
  WHERE  sales_order_id = p_order_id AND status = 'active';

  SELECT
    COALESCE(SUM(amount) FILTER (WHERE category = 'discount'), 0),
    COALESCE(SUM(amount) FILTER (WHERE category = 'shipping'), 0),
    COALESCE(SUM(amount) FILTER (WHERE category IN ('voucher','store_credit')), 0),
    COALESCE(SUM(amount) FILTER (WHERE category IN ('refund','payment_adjustment')), 0),
    COALESCE(SUM(amount) FILTER (WHERE category IN ('tip','other')), 0)
  INTO v_discounts, v_shipping, v_voucher_credit, v_refunds_fin, v_other_charges
  FROM sales_order_financial_lines
  WHERE sales_order_id = p_order_id;

  SELECT COALESCE(SUM(refund_amount), 0) INTO v_refunds_returns
  FROM   shopify_returns
  WHERE  sales_order_id = p_order_id;

  FOR c IN SELECT sku, qty FROM explode_order_components(p_order_id) LOOP
    IF c.qty IS NULL OR c.qty = 0 THEN CONTINUE; END IF;
    SELECT cost_avg INTO v_cost FROM products WHERE sku = c.sku LIMIT 1;
    IF v_cost IS NULL THEN
      IF NOT (c.sku = ANY(v_missing_cost)) THEN v_missing_cost := v_missing_cost || c.sku; END IF;
      CONTINUE;
    END IF;
    v_product_cogs := v_product_cogs + (c.qty * v_cost);
  END LOOP;

  SELECT COALESCE(SUM(amount), 0) INTO v_added_costs
  FROM   sales_order_costs
  WHERE  sales_order_id = p_order_id;

  -- Added-cost breakdown by type (packaging / courier_actual / handling / ...).
  SELECT json_agg(json_build_object('cost_type', cost_type, 'amount', round(s, 2))
                  ORDER BY s DESC)
  INTO v_breakdown
  FROM (
    SELECT cost_type, SUM(amount) AS s
    FROM sales_order_costs WHERE sales_order_id = p_order_id
    GROUP BY cost_type
  ) t;

  v_net := v_product_revenue
         - v_discounts + v_shipping
         - v_voucher_credit - v_refunds_fin - v_refunds_returns
         - v_product_cogs - v_added_costs;

  RETURN json_build_object(
    'order_id',            p_order_id,
    'product_revenue',     round(v_product_revenue, 2),
    'discounts',           round(v_discounts, 2),
    'shipping_charged',    round(v_shipping, 2),
    'voucher_store_credit',round(v_voucher_credit, 2),
    'refunds_financial',   round(v_refunds_fin, 2),
    'refunds_returns',     round(v_refunds_returns, 2),
    'other_charges',       round(v_other_charges, 2),
    'product_cogs',        round(v_product_cogs, 2),
    'added_order_costs',   round(v_added_costs, 2),
    'added_costs_breakdown', COALESCE(v_breakdown, '[]'::json),
    'net_profit',          round(v_net, 2),
    'missing_cost_skus',   v_missing_cost,
    'missing_boms',        v_missing_boms
  );
END;
$$;

GRANT EXECUTE ON FUNCTION snapshot_order_fulfilment_costs(text) TO service_role, authenticated;

-- 4. Backfill: snapshot already-fulfilled orders (uses current rates).
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT id FROM sales_orders WHERE stock_deducted = true LOOP
    BEGIN PERFORM snapshot_order_fulfilment_costs(r.id);
    EXCEPTION WHEN OTHERS THEN NULL; END;
  END LOOP;
END $$;
