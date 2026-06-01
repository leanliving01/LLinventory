-- 023_dispatch_kpis.sql
-- Dispatch (packing) performance KPIs.
-- (1) Per-order packed snapshot on sales_orders, written by FloorPack at Finish, so each
--     packed order carries what was packed (line items, meals, supplements) and the active
--     packing seconds — frozen at pack time and fast to aggregate in the report.
-- (2) packing_event_logs: one row per packing lifecycle event (started/paused/resumed/
--     completed), mirroring production_task_logs, for attribution + time-series KPIs.
-- Idempotent. RLS is disabled project-wide (see 022); we disable it on the new table too.

-- (1) Snapshot columns on sales_orders (default 0 so existing rows are unaffected)
ALTER TABLE sales_orders ADD COLUMN IF NOT EXISTS packed_items          numeric NOT NULL DEFAULT 0;
ALTER TABLE sales_orders ADD COLUMN IF NOT EXISTS packed_line_count     numeric NOT NULL DEFAULT 0;
ALTER TABLE sales_orders ADD COLUMN IF NOT EXISTS packed_meals          numeric NOT NULL DEFAULT 0;
ALTER TABLE sales_orders ADD COLUMN IF NOT EXISTS packed_package_meals  numeric NOT NULL DEFAULT 0;
ALTER TABLE sales_orders ADD COLUMN IF NOT EXISTS packed_byo_meals      numeric NOT NULL DEFAULT 0;
ALTER TABLE sales_orders ADD COLUMN IF NOT EXISTS packed_supplements    numeric NOT NULL DEFAULT 0;
-- Canonical active seconds at finish (excludes paused time). Keep legacy packing_duration_seconds.
ALTER TABLE sales_orders ADD COLUMN IF NOT EXISTS packing_active_seconds numeric NOT NULL DEFAULT 0;

-- (2) Packing event log
CREATE TABLE IF NOT EXISTS packing_event_logs (
  id                    text PRIMARY KEY,
  created_date          timestamptz NOT NULL DEFAULT now(),
  updated_date          timestamptz NOT NULL DEFAULT now(),
  created_by            text,
  sales_order_id        text NOT NULL,
  order_number          text,
  event_type            text NOT NULL CHECK (event_type IN ('started','paused','resumed','completed','cancelled')),
  member_id             text,
  member_name           text,
  packed_items          numeric,
  packed_line_count     numeric,
  packed_meals          numeric,
  packed_package_meals  numeric,
  packed_byo_meals      numeric,
  packed_supplements    numeric,
  active_seconds        numeric,
  timestamp             timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_packing_event_logs_order  ON packing_event_logs (sales_order_id);
CREATE INDEX IF NOT EXISTS idx_packing_event_logs_member ON packing_event_logs (member_id);
CREATE INDEX IF NOT EXISTS idx_packing_event_logs_time   ON packing_event_logs (timestamp);

ALTER TABLE packing_event_logs DISABLE ROW LEVEL SECURITY;

-- Keep created_date immutable / updated_date fresh, consistent with 021.
DROP TRIGGER IF EXISTS trg_guard_timestamps ON packing_event_logs;
CREATE TRIGGER trg_guard_timestamps BEFORE INSERT OR UPDATE ON packing_event_logs
  FOR EACH ROW EXECUTE FUNCTION public.guard_row_timestamps();
