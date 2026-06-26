-- ============================================================================
-- 077_purchasing_unit_pack_size
-- Simplify purchasing-unit capture. Instead of a free-text "Purchase Unit Label"
-- (the error magnet — e.g. someone typed "red pepper per kg") + a UoM code + a
-- duplicate name, a purchasing unit is now:
--   * purchase_uom  — a single clean NAME you pick or add (Case, Bag, Pocket, kg…)
--   * pack_size + pack_size_uom — the size of ONE item/packet (e.g. 500 g)
--   * pack_qty      — packs per purchase unit (e.g. 24 per case; 1 for a bag)
-- and the conversion_factor is AUTO-derived:
--   conversion_factor = convert(pack_size -> stock_uom) × pack_qty
--   (e.g. 500 g -> 0.5 kg × 24 = 12).
--
-- New-only: existing supplier links keep their current conversion_factor; these
-- columns just back the new capture form going forward. purchase_uom_label /
-- purchase_uom_name are kept (now mirror the clean purchase_uom) for back-compat
-- with PO/table displays that still read them.
--
-- Run in the SQL Editor before deploying.
-- ============================================================================

-- Pack-size model on the supplier link --------------------------------------
ALTER TABLE supplier_products
  ADD COLUMN IF NOT EXISTS pack_size     numeric,
  ADD COLUMN IF NOT EXISTS pack_size_uom text,
  ADD COLUMN IF NOT EXISTS pack_qty      numeric DEFAULT 1;

-- Same on the AI proposals, so the Review Queue can pre-fill the pack fields. --
ALTER TABLE review_queue_proposals
  ADD COLUMN IF NOT EXISTS pack_size     numeric,
  ADD COLUMN IF NOT EXISTS pack_size_uom text,
  ADD COLUMN IF NOT EXISTS pack_qty      numeric;

-- Allow a 'pack' category so packaging units (Case/Bag/Pocket…) are separable
-- from measurement units in the picker. -------------------------------------
ALTER TABLE units_of_measure DROP CONSTRAINT IF EXISTS units_of_measure_category_check;
ALTER TABLE units_of_measure
  ADD CONSTRAINT units_of_measure_category_check
  CHECK (category IN ('weight','volume','length','count','other','pack'));

-- Seed common packaging units (name-only; code = name). Idempotent. ----------
INSERT INTO units_of_measure (id, code, name, category, is_default)
SELECT gen_random_uuid()::text, v.name, v.name, 'pack', false
FROM (VALUES
  ('Each'),('Case'),('Box'),('Bag'),('Pocket'),('Punnet'),('Tray'),
  ('Tub'),('Bottle'),('Bunch'),('Packet'),('Crate'),('Bale'),('Carton'),('Drum')
) AS v(name)
ON CONFLICT (code) DO NOTHING;
