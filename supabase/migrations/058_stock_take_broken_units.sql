-- 058_stock_take_broken_units.sql
-- Stock count: track "broken / loose" stock alongside the counted UOM.
--
-- A line is now counted as:
--   converted_qty = (counted_qty * conversion_factor) + broken_units
-- where counted_qty is the number of whole count-UOM units (e.g. 110 x 2kg
-- packets) and broken_units is any loose remainder measured directly in the
-- item's MAIN STOCK UOM (e.g. 0.3 kg from an open packet/bucket).
--
-- Idempotent — safe to run more than once.

ALTER TABLE stock_take_lines
  ADD COLUMN IF NOT EXISTS broken_units numeric NOT NULL DEFAULT 0;
