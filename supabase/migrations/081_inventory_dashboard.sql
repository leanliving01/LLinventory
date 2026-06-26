-- ============================================================================
-- 081_inventory_dashboard
-- Foundation for the Inventory Dashboard ("Inventory Command Center").
--
-- Adds the background-math layer that powers the dashboard:
--   1. inventory_daily_snapshot   — daily history of stock + velocity + value,
--                                    so we can chart trends and days-of-cover
--                                    over time (accumulates from first cron run).
--   2. snapshot_inventory_daily() — idempotent upsert of "today's" snapshot.
--   3. inventory_trends()         — THIS WEEK vs a 90-day baseline average per
--                                    product → forecast-grade momentum + suggested
--                                    par bump. This is the "protein water is going
--                                    up → bump stock" engine.
--   4. product_sales_weekly()     — weekly unit buckets for the per-product trend
--                                    chart. 4b. sales_weekly_by_type() — weekly
--                                    buckets per category for the dashboard charts.
--   5. inventory_alerts           — in-app notification feed (bell + toasts).
--   6. generate_inventory_alerts()— writes low-stock / reorder / trending / low-
--                                    cover alerts, de-duped, never for packages.
--   7. pg_cron                    — nightly: snapshot + generate alerts.
--
-- Reuses the proven sales-velocity approach from 079_packaging_par_recommendations
-- (sales_order_lines × sales_orders.order_date, is_package_parent=false).
--
-- ⚠️  Run in the Supabase SQL Editor before/with the deploy.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Daily snapshot table (history)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS inventory_daily_snapshot (
  snapshot_date   date    NOT NULL DEFAULT current_date,
  product_id      text    NOT NULL,
  sku             text,
  type            text,
  subcategory     text,
  qty_on_hand     numeric NOT NULL DEFAULT 0,
  qty_committed   numeric NOT NULL DEFAULT 0,
  qty_available   numeric NOT NULL DEFAULT 0,
  par_level       numeric NOT NULL DEFAULT 0,
  units_sold_7d   numeric NOT NULL DEFAULT 0,
  units_sold_28d  numeric NOT NULL DEFAULT 0,
  fifo_value      numeric NOT NULL DEFAULT 0,
  created_date    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (snapshot_date, product_id)
);

CREATE INDEX IF NOT EXISTS idx_inv_snapshot_product_date
  ON inventory_daily_snapshot (product_id, snapshot_date DESC);

-- ---------------------------------------------------------------------------
-- 2. snapshot_inventory_daily() — upsert today's row per active product
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION snapshot_inventory_daily()
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
  rows_written integer;
BEGIN
  INSERT INTO inventory_daily_snapshot AS s (
    snapshot_date, product_id, sku, type, subcategory,
    qty_on_hand, qty_committed, qty_available, par_level,
    units_sold_7d, units_sold_28d, fifo_value
  )
  SELECT
    current_date,
    p.id, p.sku, p.type, p.subcategory,
    COALESCE(soh.on_hand, 0),
    COALESCE(soh.committed, 0),
    COALESCE(soh.available, 0),
    COALESCE(p.par_level, 0),
    COALESCE(s7.units, 0),
    COALESCE(s28.units, 0),
    COALESCE(fv.val, 0)
  FROM products p
  LEFT JOIN (
    SELECT product_id,
           SUM(qty_on_hand)   AS on_hand,
           SUM(qty_committed) AS committed,
           SUM(qty_available) AS available
    FROM stock_on_hand GROUP BY product_id
  ) soh ON soh.product_id = p.id
  LEFT JOIN (
    SELECT sol.sku, SUM(sol.qty) AS units
    FROM sales_order_lines sol
    JOIN sales_orders so ON so.id = sol.sales_order_id
    WHERE sol.is_package_parent = false
      AND sol.status = 'active'
      AND so.order_date >= now() - interval '7 days'
    GROUP BY sol.sku
  ) s7 ON s7.sku = p.sku
  LEFT JOIN (
    SELECT sol.sku, SUM(sol.qty) AS units
    FROM sales_order_lines sol
    JOIN sales_orders so ON so.id = sol.sales_order_id
    WHERE sol.is_package_parent = false
      AND sol.status = 'active'
      AND so.order_date >= now() - interval '28 days'
    GROUP BY sol.sku
  ) s28 ON s28.sku = p.sku
  LEFT JOIN (
    SELECT product_id, SUM(qty_remaining * cost_per_stock_uom) AS val
    FROM cost_layers
    WHERE COALESCE(is_depleted, false) = false
    GROUP BY product_id
  ) fv ON fv.product_id = p.id
  WHERE COALESCE(p.status, 'active') = 'active'
  ON CONFLICT (snapshot_date, product_id) DO UPDATE SET
    sku            = EXCLUDED.sku,
    type           = EXCLUDED.type,
    subcategory    = EXCLUDED.subcategory,
    qty_on_hand    = EXCLUDED.qty_on_hand,
    qty_committed  = EXCLUDED.qty_committed,
    qty_available  = EXCLUDED.qty_available,
    par_level      = EXCLUDED.par_level,
    units_sold_7d  = EXCLUDED.units_sold_7d,
    units_sold_28d = EXCLUDED.units_sold_28d,
    fifo_value     = EXCLUDED.fifo_value;

  GET DIAGNOSTICS rows_written = ROW_COUNT;
  RETURN rows_written;
END;
$$;

-- ---------------------------------------------------------------------------
-- 3. inventory_trends() — forecast-grade momentum + suggested par bump.
--    Compares THIS WEEK (last 7d) against a baseline weekly average, where the
--    baseline is normalised by ACTIVE SELLING WEEKS (not a fixed 90/7) so that
--    recently-launched SKUs and company-wide empty weeks don't distort the
--    signal. The baseline window also EXCLUDES the current week.
--      weekly_baseline = baseline units / (# distinct weeks with sales)   [over the
--                        90 days ENDING one week ago]
--      momentum_pct    = this-week vs weekly_baseline (the trend signal)
--      weekly_rate     = GREATEST(baseline, this week)  (surge-aware → cover/alerts)
--      days_of_cover   = available / (weekly_rate / 7)
--      suggested_par   = smoothed rate (last 28d ÷ active weeks) × cover_weeks ×
--                        (1 + safety) — spike-resistant, so one big week doesn't
--                        balloon the par target.
--    Week buckets use Africa/Johannesburg (SAST) so day/week boundaries align.
-- ---------------------------------------------------------------------------
-- Drop first: an earlier build defined inventory_trends with the same arg
-- signature but a different return shape; CREATE OR REPLACE can't change that.
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
  suggested_par   numeric
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
  prev AS (      -- the week before, for raw week-over-week context
    SELECT sol.sku, SUM(sol.qty) AS units
    FROM sales_order_lines sol
    JOIN sales_orders so ON so.id = sol.sales_order_id
    WHERE sol.is_package_parent = false AND sol.status = 'active'
      AND so.order_date >= now() - interval '14 days'
      AND so.order_date <  now() - interval '7 days'
    GROUP BY sol.sku
  ),
  base AS (      -- 90 days ENDING one week ago; weekly = total ÷ active selling weeks
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
  smooth AS (    -- last 28 days ÷ active weeks → spike-resistant par-sizing rate
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
      AND p.type NOT IN ('package', 'bundle')   -- assembled on demand, no own stock
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
    ROUND(GREATEST(j.weekly_baseline, j.units_week), 1)  AS weekly_rate,   -- surge → cover/alerts
    CASE WHEN GREATEST(j.weekly_baseline, j.units_week) <= 0 THEN NULL
         ELSE ROUND(j.available / (GREATEST(j.weekly_baseline, j.units_week) / 7.0), 1)
    END                                      AS days_of_cover,
    CEIL(j.smoothed_weekly * p_cover_weeks * (1 + p_safety)) AS suggested_par   -- smoothed → par
  FROM joined j
  ORDER BY j.units_week DESC;
$$;

-- ---------------------------------------------------------------------------
-- 4. product_sales_weekly() — weekly unit buckets for the trend chart
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION product_sales_weekly(
  p_sku   text,
  p_weeks integer DEFAULT 12
)
RETURNS TABLE (
  week_start date,
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
  )
  SELECT
    w.week_start,
    COALESCE(SUM(sol.qty), 0) AS units
  FROM weeks w
  LEFT JOIN sales_orders so
    ON date_trunc('week', (so.order_date AT TIME ZONE 'Africa/Johannesburg'))::date = w.week_start
  LEFT JOIN sales_order_lines sol
    ON sol.sales_order_id = so.id
   AND sol.sku = p_sku
   AND sol.is_package_parent = false
   AND sol.status = 'active'
  GROUP BY w.week_start
  ORDER BY w.week_start;
$$;

-- ---------------------------------------------------------------------------
-- 4b. sales_weekly_by_type() — weekly unit buckets per product TYPE, for the
--     dashboard's category trend chart + this-week category split.
-- ---------------------------------------------------------------------------
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
  )
  SELECT
    w.week_start,
    p.type,
    COALESCE(SUM(sol.qty), 0) AS units
  FROM weeks w
  LEFT JOIN sales_orders so
    ON date_trunc('week', (so.order_date AT TIME ZONE 'Africa/Johannesburg'))::date = w.week_start
  LEFT JOIN sales_order_lines sol
    ON sol.sales_order_id = so.id
   AND sol.is_package_parent = false
   AND sol.status = 'active'
  LEFT JOIN products p ON p.sku = sol.sku
  -- Keep one anchor row (type NULL, 0) for weeks with no sales so the chart's
  -- week axis stays continuous; the frontend ignores NULL-type rows for lines.
  GROUP BY w.week_start, p.type
  ORDER BY w.week_start;
$$;

-- ---------------------------------------------------------------------------
-- 5. inventory_alerts — in-app notification feed
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS inventory_alerts (
  id           text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  created_date timestamptz NOT NULL DEFAULT now(),
  product_id   text,
  sku          text,
  alert_type   text NOT NULL,        -- below_par|out_of_stock|reorder|trending_up|low_cover|dead_stock
  severity     text NOT NULL,        -- critical|warn|info
  message      text NOT NULL,
  payload      jsonb,
  status       text NOT NULL DEFAULT 'unread'   -- unread|read|dismissed
);

CREATE INDEX IF NOT EXISTS idx_inv_alerts_status  ON inventory_alerts (status, created_date DESC);
CREATE INDEX IF NOT EXISTS idx_inv_alerts_product ON inventory_alerts (product_id, alert_type);

-- ---------------------------------------------------------------------------
-- 6. generate_inventory_alerts() — create new alerts, de-duped, no packages
--    De-dupe: skip if an open (unread/read) alert of the same (product,type)
--    already exists within the last p_dedupe_days.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION generate_inventory_alerts(
  p_dedupe_days integer DEFAULT 3,
  p_trend_pct   numeric DEFAULT 30,
  p_cover_days  numeric DEFAULT 7
)
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
  inserted integer := 0;
  n integer;
BEGIN
  -- 6a. Stock-level alerts (out_of_stock / reorder / below_par)
  WITH agg AS (
    SELECT
      p.id, p.sku, p.name, p.type,
      COALESCE(p.par_level, 0)         AS par_level,
      COALESCE(p.min_before_reorder,0) AS reorder_point,
      COALESCE(soh.on_hand, 0)         AS on_hand,
      COALESCE(soh.available, 0)       AS available
    FROM products p
    LEFT JOIN (
      SELECT product_id, SUM(qty_on_hand) AS on_hand, SUM(qty_available) AS available
      FROM stock_on_hand GROUP BY product_id
    ) soh ON soh.product_id = p.id
    WHERE COALESCE(p.status, 'active') = 'active'
      AND p.type NOT IN ('package', 'bundle')
  ),
  candidates AS (
    SELECT id, sku, name,
      CASE
        WHEN reorder_point > 0 AND on_hand <= 0 THEN 'out_of_stock'
        WHEN reorder_point > 0 AND on_hand < reorder_point THEN 'reorder'
        WHEN par_level > 0 AND available < par_level THEN 'below_par'
      END AS alert_type,
      CASE
        WHEN reorder_point > 0 AND on_hand <= 0 THEN 'critical'
        WHEN reorder_point > 0 AND on_hand < reorder_point AND on_hand::numeric / NULLIF(reorder_point,0) < 0.5 THEN 'warn'
        ELSE 'info'
      END AS severity,
      on_hand, available, par_level, reorder_point
    FROM agg
  ),
  fresh AS (
    SELECT c.* FROM candidates c
    WHERE c.alert_type IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM inventory_alerts a
        WHERE a.product_id = c.id
          AND a.alert_type = c.alert_type
          AND a.status IN ('unread', 'read')
          AND a.created_date >= now() - make_interval(days => p_dedupe_days)
      )
  )
  INSERT INTO inventory_alerts (product_id, sku, alert_type, severity, message, payload)
  SELECT
    f.id, f.sku, f.alert_type, f.severity,
    CASE f.alert_type
      WHEN 'out_of_stock' THEN f.name || ' is out of stock'
      WHEN 'reorder'      THEN f.name || ' is below reorder point (' || f.on_hand || ' / ' || f.reorder_point || ')'
      WHEN 'below_par'    THEN f.name || ' is below par (' || f.available || ' / ' || f.par_level || ')'
    END,
    jsonb_build_object('on_hand', f.on_hand, 'available', f.available,
                       'par_level', f.par_level, 'reorder_point', f.reorder_point)
  FROM fresh f;
  GET DIAGNOSTICS n = ROW_COUNT; inserted := inserted + n;

  -- 6b. Velocity alerts (trending_up / low_cover) from inventory_trends()
  --     Uses the 90-day baseline trend (momentum_pct = this week vs baseline).
  WITH t AS (
    SELECT * FROM inventory_trends()
  ),
  candidates AS (
    SELECT product_id, sku, name,
      CASE
        WHEN momentum_pct >= p_trend_pct AND weekly_rate > 0 THEN 'trending_up'
        WHEN days_of_cover IS NOT NULL AND days_of_cover < p_cover_days THEN 'low_cover'
      END AS alert_type,
      CASE
        WHEN days_of_cover IS NOT NULL AND days_of_cover < p_cover_days THEN 'warn'
        ELSE 'info'
      END AS severity,
      momentum_pct, weekly_rate, days_of_cover, suggested_par, par_level
    FROM t
  ),
  fresh AS (
    SELECT c.* FROM candidates c
    WHERE c.alert_type IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM inventory_alerts a
        WHERE a.product_id = c.product_id
          AND a.alert_type = c.alert_type
          AND a.status IN ('unread', 'read')
          AND a.created_date >= now() - make_interval(days => p_dedupe_days)
      )
  )
  INSERT INTO inventory_alerts (product_id, sku, alert_type, severity, message, payload)
  SELECT
    f.product_id, f.sku, f.alert_type, f.severity,
    CASE f.alert_type
      WHEN 'trending_up' THEN f.name || ' sales up ' || f.momentum_pct || '% this week — consider bumping par to ' || f.suggested_par
      WHEN 'low_cover'   THEN f.name || ' has only ' || f.days_of_cover || ' days of cover left'
    END,
    jsonb_build_object('momentum_pct', f.momentum_pct, 'weekly_rate', f.weekly_rate,
                       'days_of_cover', f.days_of_cover, 'suggested_par', f.suggested_par,
                       'par_level', f.par_level)
  FROM fresh f;
  GET DIAGNOSTICS n = ROW_COUNT; inserted := inserted + n;

  RETURN inserted;
END;
$$;

-- ---------------------------------------------------------------------------
-- 7. Nightly cron — snapshot then generate alerts (02:00 daily)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION inventory_nightly()
RETURNS void
LANGUAGE sql
AS $$
  SELECT snapshot_inventory_daily();
  SELECT generate_inventory_alerts();
$$;

-- pg_cron is provided by Supabase. Enable + (re)schedule the nightly job.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'pg_cron') THEN
    CREATE EXTENSION IF NOT EXISTS pg_cron;
    -- Remove any prior schedule with the same name, then (re)create it.
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'inventory-nightly') THEN
      PERFORM cron.unschedule('inventory-nightly');
    END IF;
    PERFORM cron.schedule('inventory-nightly', '0 2 * * *', 'SELECT inventory_nightly();');
  END IF;
END;
$$;

-- Seed the first snapshot + alerts immediately so the dashboard has data now.
SELECT snapshot_inventory_daily();
SELECT generate_inventory_alerts();
