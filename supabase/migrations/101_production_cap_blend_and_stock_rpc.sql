-- ===========================================================================
-- 101_production_cap_blend_and_stock_rpc.sql
--
-- Two production-planning correctness fixes verified by the 3-brain review
-- (Claude live-DB reconciliation + Codex logic + Gemini code-path), 2026-06-30.
--
--   1. H1 — stock truncation. ProductionPlanning loaded stock via
--      StockOnHand.list('-updated_date', 1000), but stock_on_hand has >1700
--      (product × location) rows. The 1000 most-recently-touched rows won, so
--      any meal not touched recently read 0 on-hand → the engine recommended a
--      full par-level batch of stock already held. Fix: a server-side aggregate
--      RPC that sums on-hand/committed/available per product (one row per
--      product → well under any PostgREST cap).
--
--   2. SPIKE CAP — the engine's 6-day forward-cover cap was fed weekly_rate =
--      GREATEST(90d-baseline, this-week), so a single hot week could authorise an
--      oversized cook of perishable meals (par-sizing already used the 28-day
--      smooth; the cap did not — an asymmetry Codex flagged). Fix: expose a
--      spike-DAMPENED cap_rate = GREATEST(smoothed_weekly, 0.5 × this-week).
--      Never below the 28-day smooth; a surge contributes at half weight.
--      weekly_rate is unchanged (alerts / days-of-cover still see the full surge);
--      only the production cap uses cap_rate.
--
-- NOT changed here (deliberate): the velocity SKU→product_id join (M2) — unsafe
-- until sales_order_lines.our_product_id is backfilled (it is frequently null);
-- the 7-day rolling window (M1) — a rolling timestamptz comparison is tz-agnostic
-- and correct; recalc-demand transactionality (M3) — separate edge-function change.
--
-- Wrapped in a single transaction (Codex review): the DROP+CREATE of
-- inventory_trends must be atomic, so a failed CREATE never leaves prod without
-- the RPC that generate_inventory_alerts and the dashboard depend on.
-- ===========================================================================
BEGIN;

-- ---------------------------------------------------------------------------
-- 1. production_stock_levels() — per-product stock summed across ALL locations.
--    Returns one row per product → never truncated by the 1000-row REST cap.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS production_stock_levels();

CREATE OR REPLACE FUNCTION production_stock_levels()
RETURNS TABLE (
  product_id    text,
  qty_on_hand   numeric,
  qty_committed numeric,
  qty_available numeric
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    product_id::text,
    SUM(COALESCE(qty_on_hand, 0))   AS qty_on_hand,
    SUM(COALESCE(qty_committed, 0)) AS qty_committed,
    SUM(COALESCE(qty_available, 0)) AS qty_available
  FROM stock_on_hand
  WHERE product_id IS NOT NULL
  GROUP BY product_id;
$$;

GRANT EXECUTE ON FUNCTION production_stock_levels() TO anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. inventory_trends() — add a spike-dampened cap_rate column for the
--    production forward-cover cap. Everything else is byte-for-byte the prior
--    definition (081) so existing callers (generate_inventory_alerts, the
--    dashboard) are unaffected — cap_rate is purely additive at the tail.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS inventory_trends(integer, numeric, numeric);

CREATE OR REPLACE FUNCTION inventory_trends(
  p_baseline_days integer DEFAULT 90,
  p_cover_weeks   numeric DEFAULT 4,
  p_safety        numeric DEFAULT 0.15
)
RETURNS TABLE (
  product_id      text,
  sku             text,
  name            text,
  type            text,
  subcategory     text,
  qty_available   numeric,
  par_level       numeric,
  units_week      numeric,
  units_prev_week numeric,
  weekly_baseline numeric,
  momentum_pct    numeric,
  wow_pct         numeric,
  weekly_rate     numeric,
  days_of_cover   numeric,
  suggested_par   numeric,
  cap_rate        numeric          -- NEW: spike-dampened rate for the production cover cap
)
LANGUAGE sql
STABLE
AS $$
  WITH wk AS (   -- this week = trailing 7 complete days
    SELECT sol.sku, SUM(sol.qty) AS units
    FROM sales_order_lines sol
    JOIN sales_orders so ON so.id = sol.sales_order_id
    WHERE sol.is_package_parent = false AND sol.status = 'active'
      AND so.order_date >= now() - interval '7 days'
    GROUP BY sol.sku
  ),
  prev AS (
    SELECT sol.sku, SUM(sol.qty) AS units
    FROM sales_order_lines sol
    JOIN sales_orders so ON so.id = sol.sales_order_id
    WHERE sol.is_package_parent = false AND sol.status = 'active'
      AND so.order_date >= now() - interval '14 days'
      AND so.order_date <  now() - interval '7 days'
    GROUP BY sol.sku
  ),
  base AS (
    SELECT sol.sku,
           SUM(sol.qty) AS units,
           COUNT(DISTINCT date_trunc('week', (so.order_date AT TIME ZONE 'Africa/Johannesburg'))) AS active_weeks
    FROM sales_order_lines sol
    JOIN sales_orders so ON so.id = sol.sales_order_id
    WHERE sol.is_package_parent = false AND sol.status = 'active'
      AND so.order_date >= now() - make_interval(days => p_baseline_days + 7)
      AND so.order_date <  now() - interval '7 days'
    GROUP BY sol.sku
  ),
  smooth AS (    -- last 28 days ÷ active weeks → spike-resistant rate
    SELECT sol.sku,
           SUM(sol.qty) AS units,
           COUNT(DISTINCT date_trunc('week', (so.order_date AT TIME ZONE 'Africa/Johannesburg'))) AS active_weeks
    FROM sales_order_lines sol
    JOIN sales_orders so ON so.id = sol.sales_order_id
    WHERE sol.is_package_parent = false AND sol.status = 'active'
      AND so.order_date >= now() - interval '28 days'
    GROUP BY sol.sku
  ),
  soh AS (
    SELECT product_id, SUM(qty_available) AS available
    FROM stock_on_hand GROUP BY product_id
  ),
  joined AS (
    SELECT
      p.id, p.sku, p.name, p.type, p.subcategory,
      COALESCE(soh.available, 0)                                          AS available,
      COALESCE(p.par_level, 0)                                            AS par_level,
      COALESCE(w.units, 0)                                                AS units_week,
      COALESCE(pv.units, 0)                                               AS units_prev_week,
      COALESCE(b.units, 0) / GREATEST(COALESCE(b.active_weeks, 0), 1)     AS weekly_baseline,
      COALESCE(s.units, 0) / GREATEST(COALESCE(s.active_weeks, 0), 1)     AS smoothed_weekly
    FROM products p
    LEFT JOIN wk     w  ON w.sku  = p.sku
    LEFT JOIN prev   pv ON pv.sku = p.sku
    LEFT JOIN base   b  ON b.sku  = p.sku
    LEFT JOIN smooth s  ON s.sku  = p.sku
    LEFT JOIN soh       ON soh.product_id = p.id
    WHERE COALESCE(p.status, 'active') = 'active'
      AND p.type NOT IN ('package', 'bundle')
      AND COALESCE(b.units, 0) + COALESCE(w.units, 0) + COALESCE(s.units, 0) > 0
  )
  SELECT
    j.id, j.sku, j.name, j.type, j.subcategory,
    j.available                              AS qty_available,
    j.par_level,
    j.units_week,
    j.units_prev_week,
    ROUND(j.weekly_baseline, 1)              AS weekly_baseline,
    CASE WHEN j.weekly_baseline = 0 THEN NULL
         ELSE ROUND((j.units_week - j.weekly_baseline) / j.weekly_baseline * 100, 0)
    END                                      AS momentum_pct,
    CASE WHEN j.units_prev_week = 0 THEN NULL
         ELSE ROUND((j.units_week - j.units_prev_week) / j.units_prev_week * 100, 0)
    END                                      AS wow_pct,
    ROUND(GREATEST(j.weekly_baseline, j.units_week), 1)  AS weekly_rate,
    CASE WHEN GREATEST(j.weekly_baseline, j.units_week) <= 0 THEN NULL
         ELSE ROUND(j.available / (GREATEST(j.weekly_baseline, j.units_week) / 7.0), 1)
    END                                      AS days_of_cover,
    CEIL(j.smoothed_weekly * p_cover_weeks * (1 + p_safety)) AS suggested_par,
    -- Spike-dampened cap rate: never below the 28-day smooth; a surge counts at
    -- half weight so one hot week can't authorise a giant perishable cook.
    ROUND(GREATEST(j.smoothed_weekly, 0.5 * j.units_week), 1) AS cap_rate
  FROM joined j
  ORDER BY j.units_week DESC;
$$;

GRANT EXECUTE ON FUNCTION inventory_trends(integer, numeric, numeric) TO anon, authenticated, service_role;

COMMIT;
