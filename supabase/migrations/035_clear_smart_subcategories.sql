-- 035_clear_smart_subcategories.sql
-- Follow-up to 034. For product types that have smart SKU/name-based subcategory
-- auto-detection (see src/lib/productSubcategories.js), clear the generic legacy
-- subcategory that 034 backfilled, so the app derives granular groups
-- (meal lines by SKU prefix, Meats/Vegetables/Starches for raw via pick_category,
-- supplement families, package lines, etc.).
--
-- Manual classification (drag-to-reclassify / bulk edit) writes a stored
-- subcategory which still takes priority over auto-detect, so this does not
-- prevent overrides — it only restores the smart default grouping.
--
-- Legacy subcategories are intentionally KEPT for types without auto-detection
-- (sauce, solo_serve, bundle, service).
--
-- Non-destructive aside from clearing the just-backfilled column; idempotent.

UPDATE products
SET    subcategory = NULL
WHERE  type IN ('raw', 'packaging', 'finished_meal', 'wip_bulk', 'supplement', 'package');
