-- 024_packing_sections_and_pin.sql
-- Packing upgrades:
--   (1) team_members.pin  — 4-digit packing identity PIN (manager-set in Settings) so a
--       packer can't pack under someone else's name and skew KPIs.
--   (2) packing_event_logs.section — 'supplements' | 'meals' (null for legacy single-flow
--       completions) so split-packed orders attribute supplements vs meals to the correct
--       packer. (sales_orders.packed_sections JSON already exists for per-section state.)
-- Idempotent. RLS disabled project-wide.

ALTER TABLE team_members      ADD COLUMN IF NOT EXISTS pin     text;
ALTER TABLE packing_event_logs ADD COLUMN IF NOT EXISTS section text;

-- Per-section packing state on sales_orders. Each section ('sup' = supplements,
-- 'mea' = meals) has its OWN columns so two packers (e.g. outside + freezer) can pack the
-- same order at the same time, each updating only their own section's columns — no JSON
-- read-modify-write race. The existing order-level packed_* / packing_* columns become the
-- rollup, written once every present section is done.
ALTER TABLE sales_orders ADD COLUMN IF NOT EXISTS sup_status         text;          -- null | 'in_progress' | 'done'
ALTER TABLE sales_orders ADD COLUMN IF NOT EXISTS sup_packer_id      text;
ALTER TABLE sales_orders ADD COLUMN IF NOT EXISTS sup_packer_name    text;
ALTER TABLE sales_orders ADD COLUMN IF NOT EXISTS sup_active_seconds numeric NOT NULL DEFAULT 0;
ALTER TABLE sales_orders ADD COLUMN IF NOT EXISTS sup_segment_started_at timestamptz;  -- running since (null when paused/done)
ALTER TABLE sales_orders ADD COLUMN IF NOT EXISTS sup_scanned_map    text;
ALTER TABLE sales_orders ADD COLUMN IF NOT EXISTS sup_packed_at      timestamptz;

ALTER TABLE sales_orders ADD COLUMN IF NOT EXISTS mea_status         text;
ALTER TABLE sales_orders ADD COLUMN IF NOT EXISTS mea_packer_id      text;
ALTER TABLE sales_orders ADD COLUMN IF NOT EXISTS mea_packer_name    text;
ALTER TABLE sales_orders ADD COLUMN IF NOT EXISTS mea_active_seconds numeric NOT NULL DEFAULT 0;
ALTER TABLE sales_orders ADD COLUMN IF NOT EXISTS mea_segment_started_at timestamptz;
ALTER TABLE sales_orders ADD COLUMN IF NOT EXISTS mea_scanned_map    text;
ALTER TABLE sales_orders ADD COLUMN IF NOT EXISTS mea_packed_at      timestamptz;
