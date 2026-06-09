-- ============================================================================
-- 049_review_queue_uom_locations
-- Product Review Queue + supplier-product + locations improvements:
--   1. Purchase UOM is driven by the units_of_measure table (app-validated),
--      not a fixed 8-value list — so any UOM can be added & selected per
--      supplier product.
--   2. Review-queue lines can be permanently "ignored" so they stop reappearing.
--   3. Locations can be bins / shelves / storage areas (under a warehouse/zone),
--      not only the original ambient/chilled/frozen/… zone types.
--   4. Seed the common purchase units so the picker is populated out of the box.
-- ============================================================================

-- 1. Drop the hard CHECK on supplier_products.purchase_uom. The app now
--    validates against units_of_measure and allows user-added units.
ALTER TABLE supplier_products
  DROP CONSTRAINT IF EXISTS supplier_products_purchase_uom_check;

-- 2. Allow reviewers to permanently ignore an unmatched line.
ALTER TABLE purchase_invoice_lines
  DROP CONSTRAINT IF EXISTS purchase_invoice_lines_match_status_check;
ALTER TABLE purchase_invoice_lines
  ADD CONSTRAINT purchase_invoice_lines_match_status_check
  CHECK (match_status IN (
    'auto_matched','manually_matched','unmatched','non_stock_item','ignored'));

-- 3. Bin / Shelf / Storage area location types (still 2-level: these live under
--    a warehouse as more granular storage settings).
ALTER TABLE locations
  DROP CONSTRAINT IF EXISTS locations_type_check;
ALTER TABLE locations
  ADD CONSTRAINT locations_type_check
  CHECK (type IN (
    'ambient','chilled','frozen','production','packing','dispatch',
    'bin','shelf','storage'));

-- 4. Allow invoices captured via the PDF/photo scanner (scan-invoice fn).
ALTER TABLE purchase_invoices
  DROP CONSTRAINT IF EXISTS purchase_invoices_source_check;
ALTER TABLE purchase_invoices
  ADD CONSTRAINT purchase_invoices_source_check
  CHECK (source IN ('manual','xero_sync','scan'));

-- 5. Seed common purchase units (idempotent, case-insensitive on code).
INSERT INTO units_of_measure (id, code, name, category, is_default)
SELECT gen_random_uuid()::text, v.code, v.name, 'count', false
FROM (VALUES
  ('case','Case'), ('bag','Bag'), ('drum','Drum'), ('pallet','Pallet'),
  ('box','Box'), ('each','Each')
) AS v(code, name)
WHERE NOT EXISTS (
  SELECT 1 FROM units_of_measure u WHERE lower(u.code) = lower(v.code)
);
