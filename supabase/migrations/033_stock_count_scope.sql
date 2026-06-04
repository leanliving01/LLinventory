-- 033_stock_count_scope.sql
-- Lets a stock count be scoped three ways:
--   location           — one location, all categories
--   location_category  — one location, one category
--   category           — one category across ALL locations
-- To support the category scope, the header location becomes optional and each
-- count LINE carries its own location (stock-on-hand is per product+location).
--
-- Idempotent — safe to run more than once.

ALTER TABLE new_stock_takes ALTER COLUMN location_id DROP NOT NULL;
ALTER TABLE new_stock_takes ADD COLUMN IF NOT EXISTS scope text;  -- location | location_category | category

ALTER TABLE stock_take_lines ADD COLUMN IF NOT EXISTS location_id   text;
ALTER TABLE stock_take_lines ADD COLUMN IF NOT EXISTS location_name text;

CREATE INDEX IF NOT EXISTS idx_stock_take_lines_location ON stock_take_lines(location_id);
