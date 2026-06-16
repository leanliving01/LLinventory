-- 2026-06-05_split_bbtrin_prep_layer.sql
-- ONE-OFF DATA FIX (not an auto-applied migration). Run once in the Supabase SQL Editor.
--
-- Bulk Beef Trinchado (SKU BBTRIN) currently has a single "Cook" layer (BOM)
-- that contains a step tagged "Prep" ("Preparing Meat"). A step's station tag
-- and the layer it lives in are independent in this app: a step belongs to a
-- layer only because of its bom_id, NOT because of its station. To make the
-- product flow Prep -> Cook, we split out a real Prep layer (a second BOM) and
-- move the prep-station step(s) into it.
--
-- What this does, scoped to BBTRIN only:
--   1. Creates a new active Prep BOM whose output feeds the Cook layer.
--   2. Moves every prep-station step from the Cook BOM into the Prep BOM
--      (renumbered 1..N).
--   3. Renumbers the remaining Cook steps 1..N.
--
-- Ingredients are NOT moved: all 6 are currently unpinned (no step/station), so
-- they stay in the Cook layer. After running this you can drag any ingredient
-- (e.g. Rump Steak) into the new Prep layer using the ingredient "Layer"
-- dropdown in the recipe UI.
--
-- Idempotent: if a Prep BOM already exists for this product, it does nothing.

DO $$
DECLARE
  v_product_id text;
  v_cook_id    text;
  v_prep_id    text;
  v_yield_qty  numeric;
  v_yield_uom  text;
  v_pname      text;
  v_psku       text;
  v_subcat     text;
  v_prep_count int;
BEGIN
  -- 1. Locate the product by SKU.
  SELECT id INTO v_product_id FROM products WHERE upper(sku) = 'BBTRIN' LIMIT 1;
  IF v_product_id IS NULL THEN
    RAISE EXCEPTION 'Product with SKU BBTRIN not found';
  END IF;

  -- 2. Locate its active Cook BOM.
  SELECT id, product_name, product_sku, subcategory, yield_qty, yield_uom
    INTO v_cook_id, v_pname, v_psku, v_subcat, v_yield_qty, v_yield_uom
    FROM boms
   WHERE product_id = v_product_id
     AND bom_type = 'cook'
     AND COALESCE(is_active, true) = true
   ORDER BY version DESC
   LIMIT 1;
  IF v_cook_id IS NULL THEN
    RAISE EXCEPTION 'No active Cook BOM found for BBTRIN';
  END IF;

  -- Idempotency guard.
  IF EXISTS (SELECT 1 FROM boms WHERE product_id = v_product_id AND bom_type = 'prep') THEN
    RAISE NOTICE 'A Prep BOM already exists for BBTRIN - nothing to do.';
    RETURN;
  END IF;

  -- Sanity: there must be at least one prep-station step to move.
  SELECT count(*) INTO v_prep_count
    FROM bom_operations WHERE bom_id = v_cook_id AND station = 'prep';
  IF v_prep_count = 0 THEN
    RAISE EXCEPTION 'No prep-station steps found in the Cook BOM - nothing to split out.';
  END IF;

  -- 3. Create the new Prep layer. Its yield (output) defaults to the Cook
  --    layer's yield; adjust in the UI if the prepped-meat quantity differs.
  v_prep_id := gen_random_uuid()::text;
  INSERT INTO boms (
    id, product_id, product_name, product_sku, bom_type, subcategory,
    yield_qty, yield_uom, version, is_active, notes, created_date, updated_date
  ) VALUES (
    v_prep_id, v_product_id, v_pname, v_psku, 'prep', v_subcat,
    v_yield_qty, v_yield_uom, 1, true, 'Prep layer split from Cook layer', now(), now()
  );

  -- 4. Move the prep-station step(s) into the Prep BOM, renumbered 1..N.
  WITH prep_ops AS (
    SELECT id, ROW_NUMBER() OVER (ORDER BY step_no, name) AS new_no
      FROM bom_operations
     WHERE bom_id = v_cook_id AND station = 'prep'
  )
  UPDATE bom_operations o
     SET bom_id = v_prep_id, step_no = p.new_no, updated_date = now()
    FROM prep_ops p
   WHERE o.id = p.id;

  -- 5. Renumber the remaining Cook steps 1..N.
  WITH cook_ops AS (
    SELECT id, ROW_NUMBER() OVER (ORDER BY step_no, name) AS new_no
      FROM bom_operations
     WHERE bom_id = v_cook_id
  )
  UPDATE bom_operations o
     SET step_no = c.new_no, updated_date = now()
    FROM cook_ops c
   WHERE o.id = c.id;

  RAISE NOTICE 'Split complete: created Prep BOM % and moved % prep step(s).', v_prep_id, v_prep_count;
END $$;
