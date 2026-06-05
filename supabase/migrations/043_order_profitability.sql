-- ============================================================================
-- 043_order_profitability
-- Per-order profitability that combines inventory product revenue/COGS with the
-- order-level financial lines (shipping, discounts, vouchers, refunds) and the
-- manual added costs. Product inventory COGS is kept STRICTLY separate from the
-- manual added order-level costs.
--
--   net_profit = product_revenue
--              - discounts + shipping_charged
--              - voucher_store_credit - refunds_returns
--              - product_cogs - added_order_costs
--
-- COGS reuses the exact pack_boms explosion that stock deduction uses
-- (033_deduct_fulfilled_stock.sql:75-129), costed at products.cost_avg.
-- ============================================================================

-- 1. Shared BOM explosion: order's active product lines -> component sku/qty ---
--    Same logic as deduct_fulfilled_stock Step 1; factored out so profitability
--    and stock deduction cannot drift apart.
CREATE OR REPLACE FUNCTION explode_order_components(p_order_id text)
RETURNS TABLE(sku text, qty numeric)
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  r          RECORD;
  bom_rec    RECORD;
  v_committed jsonb := '{}'::jsonb;
  comp_sku   text;
  meal_qty   numeric;
  overrides  jsonb;
  bom_found  boolean;
BEGIN
  FOR r IN
    SELECT sol.sku, sol.qty, sol.is_package_parent
    FROM   sales_order_lines sol
    WHERE  sol.sales_order_id       = p_order_id
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
          THEN '{}'::jsonb ELSE bom_rec.sku_overrides::jsonb END;
        FOREACH comp_sku IN ARRAY COALESCE(bom_rec.component_skus, '{}') LOOP
          IF bom_rec.disabled_skus IS NOT NULL AND comp_sku = ANY(bom_rec.disabled_skus) THEN
            CONTINUE;
          END IF;
          meal_qty := COALESCE((overrides ->> comp_sku)::numeric, bom_rec.multiplier::numeric) * r.qty;
          v_committed := jsonb_set(v_committed, ARRAY[comp_sku],
            to_jsonb(COALESCE((v_committed ->> comp_sku)::numeric, 0) + meal_qty), true);
        END LOOP;
      END LOOP;
      IF NOT bom_found THEN
        -- Unexploded package: count the package sku itself so the caller can flag it.
        v_committed := jsonb_set(v_committed, ARRAY[r.sku],
          to_jsonb(COALESCE((v_committed ->> r.sku)::numeric, 0) + r.qty), true);
      END IF;
    ELSE
      v_committed := jsonb_set(v_committed, ARRAY[r.sku],
        to_jsonb(COALESCE((v_committed ->> r.sku)::numeric, 0) + r.qty), true);
    END IF;
  END LOOP;

  RETURN QUERY SELECT key, value::numeric FROM jsonb_each_text(v_committed);
END;
$$;

-- 2. Full profitability breakdown for one order (for the detail UI) ----------
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
  c                 RECORD;
  v_cost            numeric;
  v_net             numeric;
BEGIN
  -- Product revenue: active inventory lines only.
  SELECT COALESCE(SUM(line_total), 0) INTO v_product_revenue
  FROM   sales_order_lines
  WHERE  sales_order_id = p_order_id AND status = 'active';

  -- Order-level financial lines, grouped by category (amount is absolute).
  SELECT
    COALESCE(SUM(amount) FILTER (WHERE category = 'discount'), 0),
    COALESCE(SUM(amount) FILTER (WHERE category = 'shipping'), 0),
    COALESCE(SUM(amount) FILTER (WHERE category IN ('voucher','store_credit')), 0),
    COALESCE(SUM(amount) FILTER (WHERE category IN ('refund','payment_adjustment')), 0),
    COALESCE(SUM(amount) FILTER (WHERE category IN ('tip','other')), 0)
  INTO v_discounts, v_shipping, v_voucher_credit, v_refunds_fin, v_other_charges
  FROM sales_order_financial_lines
  WHERE sales_order_id = p_order_id;

  -- Refunds recorded on linked returns (financial-only; don't double count
  -- line-item refunds already captured as return value).
  SELECT COALESCE(SUM(refund_amount), 0) INTO v_refunds_returns
  FROM   shopify_returns
  WHERE  sales_order_id = p_order_id;

  -- Product COGS: explode to components, cost each at products.cost_avg.
  FOR c IN SELECT sku, qty FROM explode_order_components(p_order_id) LOOP
    IF c.qty IS NULL OR c.qty = 0 THEN CONTINUE; END IF;
    SELECT cost_avg INTO v_cost FROM products WHERE sku = c.sku LIMIT 1;
    IF v_cost IS NULL THEN
      IF NOT (c.sku = ANY(v_missing_cost)) THEN v_missing_cost := v_missing_cost || c.sku; END IF;
      CONTINUE;
    END IF;
    v_product_cogs := v_product_cogs + (c.qty * v_cost);
  END LOOP;

  -- Manual added order-level costs (kept separate from product COGS).
  SELECT COALESCE(SUM(amount), 0) INTO v_added_costs
  FROM   sales_order_costs
  WHERE  sales_order_id = p_order_id;

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
    'net_profit',          round(v_net, 2),
    'missing_cost_skus',   v_missing_cost,
    'missing_boms',        v_missing_boms
  );
END;
$$;

-- 3. Summary view: one row per order for lists / KPIs ------------------------
--    Revenue + financial lines only (cheap). COGS is omitted here because the
--    BOM explosion is per-order procedural; use order_profitability() for the
--    full picture incl. COGS in the detail view.
CREATE OR REPLACE VIEW v_order_profitability AS
SELECT
  so.id                              AS order_id,
  so.order_number,
  so.order_date,
  so.lifecycle_state,
  COALESCE(rev.product_revenue, 0)   AS product_revenue,
  COALESCE(fin.discounts, 0)         AS discounts,
  COALESCE(fin.shipping_charged, 0)  AS shipping_charged,
  COALESCE(fin.voucher_store_credit, 0) AS voucher_store_credit,
  COALESCE(fin.refunds_financial, 0) AS refunds_financial,
  COALESCE(ret.refunds_returns, 0)   AS refunds_returns,
  COALESCE(cost.added_order_costs, 0) AS added_order_costs
FROM sales_orders so
LEFT JOIN (
  SELECT sales_order_id, SUM(line_total) AS product_revenue
  FROM sales_order_lines WHERE status = 'active' GROUP BY sales_order_id
) rev ON rev.sales_order_id = so.id
LEFT JOIN (
  SELECT sales_order_id,
    SUM(amount) FILTER (WHERE category = 'discount') AS discounts,
    SUM(amount) FILTER (WHERE category = 'shipping') AS shipping_charged,
    SUM(amount) FILTER (WHERE category IN ('voucher','store_credit')) AS voucher_store_credit,
    SUM(amount) FILTER (WHERE category IN ('refund','payment_adjustment')) AS refunds_financial
  FROM sales_order_financial_lines GROUP BY sales_order_id
) fin ON fin.sales_order_id = so.id
LEFT JOIN (
  SELECT sales_order_id, SUM(refund_amount) AS refunds_returns
  FROM shopify_returns GROUP BY sales_order_id
) ret ON ret.sales_order_id = so.id
LEFT JOIN (
  SELECT sales_order_id, SUM(amount) AS added_order_costs
  FROM sales_order_costs GROUP BY sales_order_id
) cost ON cost.sales_order_id = so.id;

GRANT EXECUTE ON FUNCTION explode_order_components(text) TO service_role, authenticated;
GRANT EXECUTE ON FUNCTION order_profitability(text)      TO service_role, authenticated;
GRANT SELECT  ON v_order_profitability                   TO service_role, authenticated;
