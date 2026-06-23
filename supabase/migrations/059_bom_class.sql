-- ============================================================================
-- 059_bom_class.sql
-- Top-level BOM classification: Production vs Packing.
--
--   production  -> physically made (stages prep / cook / portion):
--                  raw materials are cooked, processed and portioned.
--   packing     -> finished goods assembled & packed into a box for
--                  distribution (stage pack): finished meals -> box.
--
-- `bom_class` is the user-facing top-level type; `bom_type` stays as the stage
-- WITHIN a class. Additive + backfilled so nothing existing breaks.
-- ============================================================================

ALTER TABLE boms ADD COLUMN IF NOT EXISTS bom_class text NOT NULL DEFAULT 'production'
  CHECK (bom_class IN ('production','packing'));

-- Classify every existing BOM: pack stage -> packing, everything else -> production.
UPDATE boms SET bom_class = 'packing'    WHERE bom_type = 'pack';
UPDATE boms SET bom_class = 'production' WHERE bom_type IN ('prep','cook','portion');

CREATE INDEX IF NOT EXISTS idx_boms_bom_class ON boms(bom_class);
