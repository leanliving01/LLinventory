-- ============================================================================
-- 063_wwr_packing_boms_and_tidy.sql   (run AFTER 061 so the auto-sync trigger exists)
--
-- 1. Tidy the Winter Warmer box subcategory casing so the 3 boxes group under
--    the predefined "Winter Warmer Packages" group on the Package tab (they were
--    stored as the all-caps 'WINTER WARMER RANGE', a stray group).
-- 2. Seed the Winter Warmer packing BOMs (the MASTER composition) for WWR15/30/60
--    so the user has the one-place-to-edit packing BOM, and the 061 trigger
--    auto-(re)builds the pack_boms explosion rows from them. Composition matches
--    migration 056 exactly (per-box meal counts), so deduction is unchanged.
--
-- Idempotent: skips a package if it already has a packing BOM.
-- ============================================================================

-- 1) Subcategory tidy (boxes stay type='package').
UPDATE products
   SET subcategory  = 'Winter Warmer Packages',
       updated_date = now()
 WHERE sku IN ('WWR15', 'WWR30', 'WWR60')
   AND type = 'package';

-- 2) Seed packing BOMs + components. The 15-pack per-meal counts (×1 multiplier
-- for the 30/60 packs which are ×2 / ×4 of the 15).
DO $$
DECLARE
  packages jsonb := '[{"sku":"WWR15","mult":1},{"sku":"WWR30","mult":2},{"sku":"WWR60","mult":4}]'::jsonb;
  base     jsonb := '{"WWR1":1,"WWR2":2,"WWR3":2,"WWR4":2,"WWR5":1,"WWR6":2,"WWR7":1,"WWR8":2,"WWR9":2}'::jsonb;
  pkgrec   jsonb;
  v_pkg_id text;
  v_bom_id text;
  v_meal_id text;
  v_meal_name text;
  msku     text;
  mqty     numeric;
  v_mult   numeric;
BEGIN
  FOR pkgrec IN SELECT * FROM jsonb_array_elements(packages) LOOP
    SELECT id INTO v_pkg_id FROM products WHERE sku = (pkgrec->>'sku');
    IF v_pkg_id IS NULL THEN
      RAISE NOTICE 'package % not found — skipping', pkgrec->>'sku';
      CONTINUE;
    END IF;

    IF EXISTS (SELECT 1 FROM boms WHERE product_id = v_pkg_id AND bom_class = 'packing') THEN
      RAISE NOTICE 'packing BOM already exists for % — skipping', pkgrec->>'sku';
      CONTINUE;
    END IF;

    v_mult   := (pkgrec->>'mult')::numeric;
    v_bom_id := encode(gen_random_bytes(12), 'hex');

    INSERT INTO boms (id, created_date, updated_date, product_id, product_name, product_sku,
                      bom_type, bom_class, subcategory, yield_qty, yield_uom, version, is_active, notes)
    SELECT v_bom_id, now(), now(), v_pkg_id, p.name, p.sku,
           'pack', 'packing', 'Winter Warmer Packages', 1, 'box', 1, true,
           'Packing BOM: finished Winter Warmer meals packed into the ' || (pkgrec->>'sku')
             || ' box. This is the master — the stock-deduction map (pack_boms) auto-syncs from it.'
    FROM products p WHERE p.id = v_pkg_id;

    FOR msku, mqty IN SELECT key, value::numeric FROM jsonb_each_text(base) LOOP
      SELECT id, name INTO v_meal_id, v_meal_name FROM products WHERE sku = msku;
      IF v_meal_id IS NULL THEN
        RAISE NOTICE 'meal % not found for % — skipping component', msku, pkgrec->>'sku';
        CONTINUE;
      END IF;
      INSERT INTO bom_components (id, created_date, updated_date, bom_id, input_product_id,
                                  input_product_name, input_product_sku, qty, uom, is_consumable,
                                  step_no, station, make_day)
      VALUES (encode(gen_random_bytes(12), 'hex'), now(), now(), v_bom_id, v_meal_id,
              v_meal_name, msku, mqty * v_mult, 'pcs', false, 1, 'pack', 'cook_day');
    END LOOP;

    RAISE NOTICE 'seeded packing BOM for % (% components)', pkgrec->>'sku', (SELECT count(*) FROM jsonb_object_keys(base));
  END LOOP;
END $$;
