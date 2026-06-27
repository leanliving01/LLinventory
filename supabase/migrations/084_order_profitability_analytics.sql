-- ============================================================================
-- 084_order_profitability_analytics
-- Eagle's-eye order profitability analytics for the Order Profitability
-- dashboard. Two set-based functions over a date window:
--
--   order_profit_lines(from, to)   -> ONE ROW PER package/standalone line,
--       tagged with pack size (meal count), meal package family, province and
--       fulfillment type. Feeds "which pack size / which meal package is most
--       profitable" breakdowns (product-level contribution margin).
--
--   order_profit_orders(from, to)  -> ONE ROW PER order, full net profit incl.
--       shipping charged, discounts, vouchers, refunds and manual added costs.
--       Feeds the headline KPIs, province + fulfillment breakdowns, profit
--       trend and the drill-down orders table.
--
-- COGS reuses the SAME pack_boms explosion that stock deduction +
-- order_profitability() use (033 / 043), costed at products.cost_avg, so this
-- analytics layer cannot drift from the per-order detail card. The known
-- cost_avg-vs-FIFO gap is inherited intentionally for consistency.
--
--   gross_profit = product_revenue - product_cogs
--   net_profit   = gross_profit - discounts + shipping_charged
--                  - voucher_store_credit - refunds_financial
--                  - refunds_returns - added_costs
-- ============================================================================

-- 1. Line-grain profitability ------------------------------------------------
CREATE OR REPLACE FUNCTION order_profit_lines(p_from timestamptz, p_to timestamptz)
RETURNS TABLE(
  order_id          text,
  order_number      text,
  order_date        timestamptz,
  shipping_province text,
  fulfillment_type  text,
  line_id           text,
  sku               text,
  name              text,
  line_type         text,
  is_package_parent boolean,
  pack_family       text,
  pack_size         numeric,
  qty               numeric,
  revenue           numeric,
  cogs              numeric
)
LANGUAGE sql
STABLE
AS $$
  WITH ship AS (
    -- One fulfillment classification per order, parsed from the shipping
    -- financial line label (same source the profitability card uses).
    SELECT
      sales_order_id,
      CASE
        WHEN bool_or(label ILIKE '%pickup%' OR label ILIKE '%collect%') THEN 'Local Pickup'
        WHEN bool_or(label ILIKE '%door%')                              THEN 'Door-to-Door'
        ELSE 'Courier'
      END AS fulfillment_type
    FROM sales_order_financial_lines
    WHERE category = 'shipping'
    GROUP BY sales_order_id
  )
  SELECT
    so.id,
    so.order_number,
    so.order_date,
    NULLIF(TRIM(so.shipping_province), '')                        AS shipping_province,
    COALESCE(ship.fulfillment_type, 'Unspecified')               AS fulfillment_type,
    sol.id,
    sol.sku,
    sol.name,
    sol.line_type,
    sol.is_package_parent,
    COALESCE(pp.package_family,
             CASE WHEN sol.is_package_parent THEN 'OTHER' ELSE 'STANDALONE' END) AS pack_family,
    COALESCE(pp.pack_size, pb.multiplier)                         AS pack_size,
    sol.qty,
    COALESCE(sol.line_total, 0)                                   AS revenue,
    CASE
      WHEN sol.is_package_parent AND pb.package_sku IS NOT NULL
        THEN COALESCE(comp.cogs, 0)
      ELSE COALESCE(sp.cost_avg, 0) * sol.qty
    END                                                          AS cogs
  FROM sales_orders so
  JOIN sales_order_lines sol ON sol.sales_order_id = so.id
  LEFT JOIN ship ON ship.sales_order_id = so.id
  -- One active packing BOM per package sku (LIMIT 1 mirrors explode_order_components).
  LEFT JOIN LATERAL (
    SELECT * FROM pack_boms b
    WHERE b.package_sku = sol.sku AND b.active = true
    LIMIT 1
  ) pb ON true
  -- Pack metadata (meal count + family) for the package sku.
  LEFT JOIN LATERAL (
    SELECT * FROM package_products x
    WHERE x.shopify_sku = sol.sku AND x.is_active
    LIMIT 1
  ) pp ON true
  -- Direct cost for standalone / unexploded lines.
  LEFT JOIN products sp ON sp.sku = sol.sku
  -- Exploded component COGS for package lines (respects overrides + disabled).
  LEFT JOIN LATERAL (
    SELECT SUM(
      COALESCE(
        (CASE WHEN pb.sku_overrides ~ '^\s*\{'
              THEN pb.sku_overrides::jsonb ELSE '{}'::jsonb END ->> cs.comp_sku)::numeric,
        pb.multiplier::numeric
      ) * sol.qty * COALESCE(cp.cost_avg, 0)
    ) AS cogs
    FROM unnest(COALESCE(pb.component_skus, '{}')) AS cs(comp_sku)
    LEFT JOIN products cp ON cp.sku = cs.comp_sku
    WHERE pb.disabled_skus IS NULL OR NOT (cs.comp_sku = ANY(pb.disabled_skus))
  ) comp ON true
  WHERE so.order_date >= p_from
    AND so.order_date <= p_to
    AND so.lifecycle_state NOT IN ('cancelled', 'pending_payment')
    AND sol.status = 'active'
    AND sol.is_package_component = false
    AND COALESCE(sol.line_type, '') NOT IN ('bundle', 'bundle_child');
$$;

-- 2. Order-grain profitability (full net profit) -----------------------------
CREATE OR REPLACE FUNCTION order_profit_orders(p_from timestamptz, p_to timestamptz)
RETURNS TABLE(
  order_id             text,
  order_number         text,
  order_date           timestamptz,
  shipping_province    text,
  fulfillment_type     text,
  product_revenue      numeric,
  product_cogs         numeric,
  gross_profit         numeric,
  discounts            numeric,
  shipping_charged     numeric,
  voucher_store_credit numeric,
  refunds_financial    numeric,
  refunds_returns      numeric,
  added_costs          numeric,
  net_profit           numeric,
  net_margin           numeric,
  item_units           numeric
)
LANGUAGE sql
STABLE
AS $$
  WITH base AS (
    SELECT * FROM order_profit_lines(p_from, p_to)
  ),
  ctx AS (
    SELECT DISTINCT order_id, order_number, order_date, shipping_province, fulfillment_type
    FROM base
  ),
  agg AS (
    SELECT order_id,
      SUM(revenue) AS product_revenue,
      SUM(cogs)    AS product_cogs,
      SUM(qty)     AS item_units
    FROM base GROUP BY order_id
  ),
  fin AS (
    SELECT sales_order_id,
      COALESCE(SUM(amount) FILTER (WHERE category = 'discount'), 0)                      AS discounts,
      COALESCE(SUM(amount) FILTER (WHERE category = 'shipping'), 0)                      AS shipping_charged,
      COALESCE(SUM(amount) FILTER (WHERE category IN ('voucher','store_credit')), 0)     AS voucher_store_credit,
      COALESCE(SUM(amount) FILTER (WHERE category IN ('refund','payment_adjustment')),0) AS refunds_financial
    FROM sales_order_financial_lines GROUP BY sales_order_id
  ),
  ret AS (
    SELECT sales_order_id, COALESCE(SUM(refund_amount), 0) AS refunds_returns
    FROM shopify_returns GROUP BY sales_order_id
  ),
  cst AS (
    SELECT sales_order_id, COALESCE(SUM(amount), 0) AS added_costs
    FROM sales_order_costs GROUP BY sales_order_id
  )
  SELECT
    c.order_id, c.order_number, c.order_date, c.shipping_province, c.fulfillment_type,
    round(a.product_revenue, 2),
    round(a.product_cogs, 2),
    round(a.product_revenue - a.product_cogs, 2),
    round(COALESCE(f.discounts, 0), 2),
    round(COALESCE(f.shipping_charged, 0), 2),
    round(COALESCE(f.voucher_store_credit, 0), 2),
    round(COALESCE(f.refunds_financial, 0), 2),
    round(COALESCE(r.refunds_returns, 0), 2),
    round(COALESCE(cst.added_costs, 0), 2),
    round(net.net_profit, 2),
    CASE WHEN a.product_revenue > 0
      THEN round(100.0 * net.net_profit / a.product_revenue, 1) ELSE 0 END,
    a.item_units
  FROM agg a
  JOIN ctx c ON c.order_id = a.order_id
  LEFT JOIN fin f   ON f.sales_order_id   = a.order_id
  LEFT JOIN ret r   ON r.sales_order_id   = a.order_id
  LEFT JOIN cst cst ON cst.sales_order_id = a.order_id
  CROSS JOIN LATERAL (
    SELECT (a.product_revenue - a.product_cogs)
           - COALESCE(f.discounts, 0) + COALESCE(f.shipping_charged, 0)
           - COALESCE(f.voucher_store_credit, 0) - COALESCE(f.refunds_financial, 0)
           - COALESCE(r.refunds_returns, 0) - COALESCE(cst.added_costs, 0) AS net_profit
  ) net;
$$;

GRANT EXECUTE ON FUNCTION order_profit_lines(timestamptz, timestamptz)  TO service_role, authenticated;
GRANT EXECUTE ON FUNCTION order_profit_orders(timestamptz, timestamptz) TO service_role, authenticated;
