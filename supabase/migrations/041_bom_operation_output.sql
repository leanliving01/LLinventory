-- 041_bom_operation_output.sql
-- Capture the output that flows out of each production step (e.g. peel 1.2kg
-- potato -> 1kg into cook). Shown per step in the BOM detail; the layer's
-- final output remains the BOM yield. Floor task generation is unaffected.

ALTER TABLE bom_operations
  ADD COLUMN IF NOT EXISTS output_qty numeric;

ALTER TABLE bom_operations
  ADD COLUMN IF NOT EXISTS output_uom text;

-- Allow 'pack' as a step station (new steps default to their BOM's layer,
-- so pack-layer BOMs need it). Recreate the column CHECK to include it.
ALTER TABLE bom_operations DROP CONSTRAINT IF EXISTS bom_operations_station_check;
ALTER TABLE bom_operations
  ADD CONSTRAINT bom_operations_station_check
  CHECK (station IN ('prep','cook','portion','pack'));
