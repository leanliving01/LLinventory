-- 053_stock_count_name
-- Add an optional user-defined name to stock counts for easier identification.
ALTER TABLE new_stock_takes ADD COLUMN IF NOT EXISTS count_name text;
