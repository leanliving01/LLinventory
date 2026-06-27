-- ---------------------------------------------------------------------------
-- 085 — Fix sales_weekly_by_type() statement timeout (inventory dashboard 500)
--
-- The original definition (migration 081, §4b) joined the ENTIRE sales_orders
-- history with no date filter and matched weeks via
--   date_trunc('week', order_date) = week_start
-- a function-wrapped predicate that cannot use an index. As order history grew
-- the full-table scan crossed the statement timeout, so the dashboard's
-- "Weekly Sales" / "This Week by Category" panels started returning HTTP 500
-- (canceling statement due to statement timeout).
--
-- Fix:
--   1. Pre-filter sales_orders to the requested window with a SARGABLE bound
--      (so.order_date >= window start), fetching one extra week of slack to
--      avoid any timezone-boundary loss — extra rows simply don't match a week
--      in the series and are dropped by the LEFT JOIN.
--   2. Add a supporting index on sales_orders(order_date).
--
-- Output semantics are unchanged: every week in the series still yields at
-- least one anchor row (type NULL, units 0) so the chart's week axis stays
-- continuous; weeks with sales yield one row per product type.
-- ---------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_sales_orders_order_date ON sales_orders (order_date);
CREATE INDEX IF NOT EXISTS idx_sales_order_lines_order_id ON sales_order_lines (sales_order_id);

CREATE OR REPLACE FUNCTION sales_weekly_by_type(
  p_weeks integer DEFAULT 13
)
RETURNS TABLE (
  week_start date,
  type       text,
  units      numeric
)
LANGUAGE sql
STABLE
AS $$
  WITH weeks AS (
    SELECT generate_series(
             date_trunc('week', (now() AT TIME ZONE 'Africa/Johannesburg'))::date - make_interval(weeks => p_weeks - 1)::interval,
             date_trunc('week', (now() AT TIME ZONE 'Africa/Johannesburg'))::date,
             interval '1 week'
           )::date AS week_start
  ),
  recent AS (
    -- Indexed range scan instead of a full-history scan. Over-fetch by one week
    -- (p_weeks, not p_weeks - 1) so a Johannesburg/UTC offset never drops an
    -- order at the very start of the earliest displayed week; rows outside the
    -- series fall away in the LEFT JOIN below.
    SELECT
      date_trunc('week', (so.order_date AT TIME ZONE 'Africa/Johannesburg'))::date AS week_start,
      p.type,
      sol.qty
    FROM sales_orders so
    JOIN sales_order_lines sol
      ON sol.sales_order_id = so.id
     AND sol.is_package_parent = false
     AND sol.status = 'active'
    LEFT JOIN products p ON p.sku = sol.sku
    WHERE so.order_date >= (
            date_trunc('week', (now() AT TIME ZONE 'Africa/Johannesburg'))::date
              - make_interval(weeks => p_weeks)::interval
          )
  )
  SELECT
    w.week_start,
    r.type,
    COALESCE(SUM(r.qty), 0) AS units
  FROM weeks w
  LEFT JOIN recent r ON r.week_start = w.week_start
  GROUP BY w.week_start, r.type
  ORDER BY w.week_start;
$$;
