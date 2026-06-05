-- 040_bom_component_station.sql
-- Let an ingredient be assigned directly to a production layer/phase
-- (prep / cook / portion / pack), independent of a specific step.
-- The BOM detail page exposes this as a "Layer" dropdown per ingredient.
-- Floor task generation is unaffected (it reads operations, not this column).

ALTER TABLE bom_components
  ADD COLUMN IF NOT EXISTS station text
  CHECK (station IS NULL OR station IN ('prep','cook','portion','pack'));

-- Backfill: where an ingredient is already pinned to a step, inherit that
-- step's station so existing data shows the correct layer immediately.
UPDATE bom_components c
SET station = o.station
FROM bom_operations o
WHERE o.bom_id = c.bom_id
  AND o.step_no = c.step_no
  AND c.step_no IS NOT NULL
  AND c.station IS NULL;
