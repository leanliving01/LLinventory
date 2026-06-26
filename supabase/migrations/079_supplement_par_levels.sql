-- ============================================================================
-- 079_supplement_par_levels
-- One-time par-level set for the single-serve supplement range, written straight
-- to the single source of truth products.par_level (Production Planning + Par
-- Levels both read this; the legacy par_levels mirror was dropped in 071 — see
-- 078_meal_par_levels for the meal equivalent).
--
-- Values supplied by Thys from the Shopify stock report (2026-06-26). Matched by
-- exact SKU, case-insensitive, against active products. Idempotent — safe to
-- re-run.
--
--   Protein Water     PWM 300, PWW 300, PWRPT 365
--   Protein Porridge  PPPB 111, PPCM 84, PPVB 85
--   Protein Pudding   MTPP 106, TCPP 58, CBPP 128
--   Slim Shake        DCSS 84, VICSS 46, PBSS 24
--   Everyday Energy   LLDE 52, PICE 13
--   Super Greens      SupGB 44, SUPGP 30
--   Pure Collagen     PurCol300 47
--   Hydro Boost       HBL 33, HBMB 41
--   Lean Collagen     LeanC 52
--
-- ⚠️  Run in the Supabase SQL Editor before/with the deploy.
-- ============================================================================

UPDATE products p
   SET par_level = v.par,
       updated_date = now()
  FROM (VALUES
        ('PWM',       300),
        ('PWW',       300),
        ('PWRPT',     365),
        ('PPPB',      111),
        ('PPCM',       84),
        ('PPVB',       85),
        ('MTPP',      106),
        ('TCPP',       58),
        ('CBPP',      128),
        ('DCSS',       84),
        ('VICSS',      46),
        ('PBSS',       24),
        ('LLDE',       52),
        ('PICE',       13),
        ('SupGB',      44),
        ('SUPGP',      30),
        ('PurCol300',  47),
        ('HBL',        33),
        ('HBMB',       41),
        ('LeanC',      52)
       ) AS v(sku, par)
 WHERE lower(p.sku) = lower(v.sku)
   AND p.status = 'active';

-- Sanity check (optional — run after the UPDATE to confirm all 20 matched):
--   SELECT sku, name, par_level FROM products
--    WHERE lower(sku) IN ('pwm','pww','pwrpt','pppb','ppcm','ppvb','mtpp','tcpp',
--                         'cbpp','dcss','vicss','pbss','llde','pice','supgb',
--                         'supgp','purcol300','hbl','hbmb','leanc')
--    ORDER BY sku;
