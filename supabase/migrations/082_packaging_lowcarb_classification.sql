-- ============================================================================
-- 082_packaging_lowcarb_classification
-- Classify packaging (and the Low Carb meals) so the Par Levels / catalog stop
-- dumping everything into "Other Packaging" / "Other Meals".
--
-- Packaging `subcategory` was all NULL (auto-detected at runtime). We now also
-- write the column so the catalog, the packaging par RPC (079) and the Par Levels
-- grouping all agree:
--   * Goal sleeves  → the 4 range sleeve subcategories (MWL/MLM/WLM/WWL)
--   * WWR stickers + Soup Pouch → 'Winter Warmer Packaging'
--   * Remaining named meal sleeves (CAEPL/CZA/LHCCG/PBBS/ZUB - Sleeve) → 'Low Carb Packaging'
--   * Everything else (plates, boxes, inserts, skin-vacuum, dry ice…) stays 'Other Packaging'
--
-- Also fixes the Low Carb MEALS: they have no goal/WWR SKU prefix, carry NULL
-- subcategory and DON'T say "low carb" in the name, so 078's Low Carb clause
-- matched ZERO of them — they were stranded in "Other Meals" at par 200. Set
-- subcategory='Low Carb Meals' + par_level=150 (the value asked for).
--
-- Guards only touch NULL/blank/'Other …' rows, so manual classifications stand.
-- Idempotent.
--
-- ⚠️  Run in the Supabase SQL Editor (or already applied via Management API).
-- ============================================================================

-- ── Goal-range sleeves ──────────────────────────────────────────────────────
UPDATE products SET subcategory = 'Men''s Weight Loss / BYO Sleeves (MWL)', updated_date = now()
 WHERE type = 'packaging' AND upper(sku) ~ '^MWL[0-9]'
   AND (subcategory IS NULL OR btrim(subcategory) = '' OR subcategory ILIKE 'Other%');

UPDATE products SET subcategory = 'Men''s Lean Muscle Sleeves (MLM)', updated_date = now()
 WHERE type = 'packaging' AND upper(sku) ~ '^MLM[0-9]'
   AND (subcategory IS NULL OR btrim(subcategory) = '' OR subcategory ILIKE 'Other%');

UPDATE products SET subcategory = 'Women''s Lean Muscle Sleeves (WLM)', updated_date = now()
 WHERE type = 'packaging' AND upper(sku) ~ '^WLM[0-9]'
   AND (subcategory IS NULL OR btrim(subcategory) = '' OR subcategory ILIKE 'Other%');

UPDATE products SET subcategory = 'Women''s Weight Loss Sleeves (WWL)', updated_date = now()
 WHERE type = 'packaging' AND upper(sku) ~ '^WWL[0-9]'
   AND (subcategory IS NULL OR btrim(subcategory) = '' OR subcategory ILIKE 'Other%');

-- ── Winter Warmer packaging (WWR stickers + soup pouch) ─────────────────────
UPDATE products SET subcategory = 'Winter Warmer Packaging', updated_date = now()
 WHERE type = 'packaging'
   AND (upper(sku) LIKE 'WWR%' OR upper(sku) = 'SPOUCH'
        OR name ILIKE '%winter warmer%' OR name ILIKE '%soup pouch%')
   AND (subcategory IS NULL OR btrim(subcategory) = '' OR subcategory ILIKE 'Other%');

-- ── Low Carb packaging (named meal sleeves, not goal/WWR coded) ──────────────
UPDATE products SET subcategory = 'Low Carb Packaging', updated_date = now()
 WHERE type = 'packaging'
   AND (name ILIKE '%sleeve%' OR upper(sku) LIKE '%SLEEVE%')
   AND upper(sku) !~ '^(MWL|MLM|WLM|WWL)[0-9]'
   AND upper(sku) NOT LIKE 'WWR%'
   AND (subcategory IS NULL OR btrim(subcategory) = '' OR subcategory ILIKE 'Other%');

-- ── Low Carb meals — classify + correct par to 150 ──────────────────────────
-- The non-goal, non-WWR finished meals are the Low Carb 330 g range.
UPDATE products
   SET subcategory = 'Low Carb Meals',
       par_level   = 150,
       updated_date = now()
 WHERE type = 'finished_meal' AND COALESCE(status,'active') = 'active'
   AND upper(sku) !~ '^(MWL|MLM|WLM|WWL)[0-9]'
   AND upper(sku) !~ '^WWR[0-9]';
