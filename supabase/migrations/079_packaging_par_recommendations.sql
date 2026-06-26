-- ============================================================================
-- 079_packaging_par_recommendations
-- Sales-driven par recommendations for PACKAGING, derived from each meal's own
-- recipe/BOM so every packaging item (sleeve, sticker, plate, vacuum bag, pouch,
-- film…) is mapped correctly with no hand-guessing.
--
-- How it works:
--   1. meal_sales — weekly units sold per finished_meal, from sales_order_lines
--      (component meals exploded out of packages + standalone meal lines), over
--      a trailing 6- and 12-month window, joined to sales_orders.order_date.
--   2. For each meal, read its active BOM's packaging components (input product
--      type='packaging') and normalise to a per-meal qty (component.qty / yield).
--   3. Packaging consumption = Σ (meal units sold × per-meal packaging qty).
--   4. Suggested par = max(6-mo, 12-mo) weekly rate × cover weeks × (1 + safety).
--
-- Read-only: returns rows for review; the app writes products.par_level on
-- Apply (same as the meal recommendations). Idempotent — CREATE OR REPLACE.
--
-- ⚠️  Run in the Supabase SQL Editor before/with the deploy.
-- ============================================================================

CREATE OR REPLACE FUNCTION packaging_par_recommendations(
  p_cover_weeks numeric DEFAULT 4,
  p_safety      numeric DEFAULT 0.15
)
RETURNS TABLE (
  packaging_product_id text,
  packaging_sku        text,
  packaging_name       text,
  subcategory          text,
  current_par          numeric,
  weekly_6mo           numeric,
  weekly_12mo          numeric,
  driver_meals         integer,
  suggested_par        numeric
)
LANGUAGE sql
STABLE
AS $$
  WITH meal_sales AS (
    -- Units of each finished meal actually sold (component + standalone lines).
    SELECT
      m.id AS meal_id,
      SUM(sol.qty) FILTER (WHERE so.order_date >= now() - interval '6 months')  AS sold_6,
      SUM(sol.qty) FILTER (WHERE so.order_date >= now() - interval '12 months') AS sold_12
    FROM sales_order_lines sol
    JOIN sales_orders so ON so.id = sol.sales_order_id
    JOIN products m      ON m.sku = sol.sku AND m.type = 'finished_meal'
    WHERE sol.status = 'active'
      AND sol.is_package_parent = false
      AND so.order_date >= now() - interval '12 months'
    GROUP BY m.id
  ),
  weeks AS (
    SELECT
      GREATEST(COUNT(DISTINCT date_trunc('week', so.order_date))
               FILTER (WHERE so.order_date >= now() - interval '6 months'), 1)  AS weeks_6,
      GREATEST(COUNT(DISTINCT date_trunc('week', so.order_date))
               FILTER (WHERE so.order_date >= now() - interval '12 months'), 1) AS weeks_12
    FROM sales_orders so
    WHERE so.order_date >= now() - interval '12 months'
  ),
  pkg_consumption AS (
    -- Explode meal sales through the meal BOM's packaging components.
    SELECT
      comp.input_product_id AS pkg_id,
      COUNT(DISTINCT b.product_id)::int AS driver_meals,
      SUM(COALESCE(ms.sold_6, 0)  * comp.qty / COALESCE(NULLIF(b.yield_qty, 0), 1)) AS used_6,
      SUM(COALESCE(ms.sold_12, 0) * comp.qty / COALESCE(NULLIF(b.yield_qty, 0), 1)) AS used_12
    FROM boms b
    JOIN bom_components comp ON comp.bom_id = b.id
    JOIN products pkg        ON pkg.id = comp.input_product_id AND pkg.type = 'packaging'
    JOIN meal_sales ms       ON ms.meal_id = b.product_id
    WHERE b.is_active = true
    GROUP BY comp.input_product_id
  )
  SELECT
    pkg.id,
    pkg.sku,
    pkg.name,
    pkg.subcategory,
    COALESCE(pkg.par_level, 0)                              AS current_par,
    ROUND(pc.used_6  / w.weeks_6, 1)                        AS weekly_6mo,
    ROUND(pc.used_12 / w.weeks_12, 1)                       AS weekly_12mo,
    pc.driver_meals,
    CEIL(GREATEST(pc.used_6 / w.weeks_6, pc.used_12 / w.weeks_12)
         * p_cover_weeks * (1 + p_safety))                  AS suggested_par
  FROM pkg_consumption pc
  JOIN products pkg ON pkg.id = pc.pkg_id
  CROSS JOIN weeks w
  WHERE COALESCE(pkg.status, 'active') = 'active'
  ORDER BY suggested_par DESC NULLS LAST;
$$;
