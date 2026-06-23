-- Per-subcategory display colour, used to colour-code "packages" across the app
-- (Production Planning cards/sections, catalog group headers, stock-count headers).
-- Stored as a hex string like '#3b82f6'. NULL → the app falls back to
-- DEFAULT_SUBCATEGORY_COLORS in src/lib/productClassification.js.
--
-- ⚠️ Run this in the Supabase SQL Editor BEFORE deploying the frontend: the data
-- layer (src/api/supabaseClient.js) auto-strips unknown columns on write, so any
-- ProductSubcategory.update({ color }) silently no-ops until this column exists.
ALTER TABLE product_subcategories ADD COLUMN IF NOT EXISTS color text;
