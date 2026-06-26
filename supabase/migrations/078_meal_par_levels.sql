-- ============================================================================
-- 078_meal_par_levels
-- One-time par-level set for the finished-meal ranges, written straight to the
-- single source of truth products.par_level (Production Planning + Par Levels
-- both read this; the legacy par_levels mirror was dropped in 071).
--
--   Men's Weight Loss  (MWL#)  → 75
--   Men's Lean Muscle  (MLM#)  → 75
--   Women's Lean Muscle(WLM#)  → 40
--   Women's Weight Loss(WWL#)  → 80
--   Low Carb                   → 150
--   Winter Warmer (WWR#)       → 130 if the meal appears ONCE in the WWR15
--                                15-pack, 260 if it appears more than once.
--                                (WWR1/5/7 = ×1 → 130; WWR2/3/4/6/8/9 = ×2 → 260,
--                                 per the WWR15 packing BOM seeded in 056/063.)
--
-- Goal ranges match by clean numbered SKU prefix (MWL1–MWL15 etc., the same
-- token detectVariant() reads). Low Carb matches the predefined subcategory or a
-- low/smart-carb name. Idempotent — safe to re-run.
--
-- ⚠️  Run in the Supabase SQL Editor before/with the deploy.
-- ============================================================================

-- Men's Weight Loss / BYO ----------------------------------------------------
UPDATE products
   SET par_level = 75, updated_date = now()
 WHERE type = 'finished_meal' AND status = 'active'
   AND sku ~ '^MWL[0-9]+$';

-- Men's Lean Muscle ----------------------------------------------------------
UPDATE products
   SET par_level = 75, updated_date = now()
 WHERE type = 'finished_meal' AND status = 'active'
   AND sku ~ '^MLM[0-9]+$';

-- Women's Lean Muscle --------------------------------------------------------
UPDATE products
   SET par_level = 40, updated_date = now()
 WHERE type = 'finished_meal' AND status = 'active'
   AND sku ~ '^WLM[0-9]+$';

-- Women's Weight Loss --------------------------------------------------------
UPDATE products
   SET par_level = 80, updated_date = now()
 WHERE type = 'finished_meal' AND status = 'active'
   AND sku ~ '^WWL[0-9]+$';

-- Low Carb -------------------------------------------------------------------
UPDATE products
   SET par_level = 150, updated_date = now()
 WHERE type = 'finished_meal' AND status = 'active'
   AND (
        subcategory ILIKE '%low carb%'
     OR subcategory ILIKE '%smart carb%'
     OR name        ILIKE '%low carb%'
     OR name        ILIKE '%smart carb%'
   );

-- Winter Warmer Range --------------------------------------------------------
-- Derive 130 / 260 from the actual WWR15 packing BOM: qty 1 → 130, qty > 1 → 260.
-- Falls through to nothing if the BOM is absent; the explicit fallback below then
-- guarantees the known split is applied.
WITH wwr15 AS (
  SELECT bc.input_product_id AS pid, bc.qty
  FROM   boms b
  JOIN   bom_components bc ON bc.bom_id = b.id
  JOIN   products pkg      ON pkg.id = b.product_id
  WHERE  pkg.sku = 'WWR15'
    AND  b.bom_class = 'packing'
    AND  COALESCE(b.is_active, true)
)
UPDATE products p
   SET par_level = CASE WHEN w.qty > 1 THEN 260 ELSE 130 END,
       updated_date = now()
  FROM wwr15 w
 WHERE p.id = w.pid
   AND p.type = 'finished_meal';

-- Fallback for any WWR meal not covered above (e.g. WWR15 BOM missing in this
-- environment) — uses the fixed, confirmed composition. Only sets meals still
-- unset by the BOM-derived pass so it never overrides a derived value.
UPDATE products
   SET par_level = 130, updated_date = now()
 WHERE type = 'finished_meal' AND status = 'active'
   AND sku IN ('WWR1','WWR5','WWR7')
   AND COALESCE(par_level, 0) NOT IN (130, 260);

UPDATE products
   SET par_level = 260, updated_date = now()
 WHERE type = 'finished_meal' AND status = 'active'
   AND sku IN ('WWR2','WWR3','WWR4','WWR6','WWR8','WWR9')
   AND COALESCE(par_level, 0) NOT IN (130, 260);
