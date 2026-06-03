-- =============================================================================
-- ONE-OFF DATA FIX — Convert "Box/Case of N" duplicate products into purchasing
-- units (supplier_products) on the single-unit products.
-- Lean Living ERP — June 2026
-- =============================================================================
-- Context:
--   Supplements are duplicated — a single-unit product (e.g. SKU "PPVB") AND a
--   box/case product (e.g. "PPVB-Box12"). The box should not be a separate
--   product; it's how we BUY from the supplier (Alpha Sport).
--
-- This script is driven off the box/case PRODUCTS (any SKU ending in
-- -Box<N> / -Case<N> that has a matching single-unit base product). For each:
--   A) (safe)    Add a "Box of N"/"Case of N" purchasing unit to the base
--                product (supplier = Alpha Sport, cost = 0 to fill in later),
--                and delete any 'pack' BOM that produced the box product.
--   B) (safe)    ARCHIVE the duplicate box/case product (status='archived').
--                Chosen over hard-delete because the box SKUs carry real stock
--                movements + open PO lines; archiving keeps all history intact.
--
-- SKU parse: "PPVB-Box12" -> base "PPVB", unit "box", factor 12.
--
-- ⚠️ RUN ORDER:
--   1. PART 1 (PREVIEW) — read-only; verify the mapping + impact.
--   2. PART 2 (APPLY CORE) — adds UOMs + deletes pack BOMs. Idempotent.
--   3. PART 3 (ARCHIVE) — archives the duplicate box/case products.
-- =============================================================================


-- =============================================================================
-- PART 1 — PREVIEW (read-only)
-- =============================================================================

-- 1a. Every box/case product -> base product + the purchasing unit to create.
SELECT
  bx.sku                                                           AS box_sku,
  bx.name                                                          AS box_name,
  bx.subcategory,
  regexp_replace(bx.sku, '-(box|case)[0-9]+$', '', 'i')            AS base_sku,
  (initcap(lower((regexp_match(bx.sku,'-(box|case)[0-9]+$','i'))[1]))
     || ' of ' || ((regexp_match(bx.sku,'([0-9]+)$'))[1]))         AS purchase_unit_label,
  ((regexp_match(bx.sku, '([0-9]+)$'))[1])::int                    AS conversion_factor,
  (bp.id IS NOT NULL)                                              AS base_product_found,
  bp.id                                                            AS base_product_id,
  bp.stock_uom
FROM products bx
LEFT JOIN products bp ON bp.sku = regexp_replace(bx.sku, '-(box|case)[0-9]+$', '', 'i')
WHERE bx.sku ~* '-(box|case)[0-9]+$'
ORDER BY bx.sku;

-- 1b. Does the Alpha Sport supplier exist? (PART 2 auto-creates it if not.)
SELECT id, name, status FROM suppliers WHERE name ILIKE 'alpha sport%';

-- 1c. Reference impact for the box products (why we archive instead of delete).
WITH box_products AS (
  SELECT p.id, p.sku
  FROM products p
  WHERE p.sku ~* '-(box|case)[0-9]+$'
    AND EXISTS (SELECT 1 FROM products bp
                WHERE bp.sku = regexp_replace(p.sku, '-(box|case)[0-9]+$', '', 'i'))
)
SELECT
  bx.sku AS box_sku,
  (SELECT count(*) FROM stock_on_hand        s WHERE s.product_id     = bx.id) AS stock_rows,
  (SELECT coalesce(sum(s.qty_on_hand),0) FROM stock_on_hand s WHERE s.product_id = bx.id) AS qty_on_hand,
  (SELECT count(*) FROM stock_movements      s WHERE s.product_id     = bx.id) AS movements,
  (SELECT count(*) FROM sales_order_lines    s WHERE s.our_product_id = bx.id) AS sales_lines,
  (SELECT count(*) FROM purchase_order_lines s WHERE s.product_id     = bx.id) AS po_lines,
  (SELECT count(*) FROM grn_lines            s WHERE s.product_id     = bx.id) AS grn_lines,
  (SELECT count(*) FROM bom_components       s WHERE s.input_product_id = bx.id) AS used_as_input,
  (SELECT count(*) FROM supplier_products    s WHERE s.product_id     = bx.id) AS supplier_products
FROM box_products bx
ORDER BY bx.sku;


-- =============================================================================
-- PART 2 — APPLY CORE (safe, idempotent): add purchasing units + delete pack BOMs.
-- Driven off the box/case PRODUCTS, so it also covers boxes that had no BOM.
-- A DO block runs atomically — if anything fails, the whole part rolls back.
-- =============================================================================
DO $$
DECLARE
  v_supplier_id text;
  v_label       text;
  r             record;
  v_unmatched   text;
BEGIN
  -- Ensure the Alpha Sport supplier exists.
  SELECT id INTO v_supplier_id
  FROM suppliers WHERE name ILIKE 'alpha sport%' ORDER BY created_date LIMIT 1;
  IF v_supplier_id IS NULL THEN
    v_supplier_id := gen_random_uuid()::text;
    INSERT INTO suppliers (id, name, status) VALUES (v_supplier_id, 'Alpha Sport', 'active');
    RAISE NOTICE 'Created supplier "Alpha Sport" (%).', v_supplier_id;
  ELSE
    RAISE NOTICE 'Using existing supplier "Alpha Sport" (%).', v_supplier_id;
  END IF;

  -- Warn about box products whose base single-unit product does not exist.
  SELECT string_agg(sku, ', ') INTO v_unmatched
  FROM products p
  WHERE p.sku ~* '-(box|case)[0-9]+$'
    AND NOT EXISTS (SELECT 1 FROM products bp
                    WHERE bp.sku = regexp_replace(p.sku, '-(box|case)[0-9]+$', '', 'i'));
  IF v_unmatched IS NOT NULL THEN
    RAISE WARNING 'No matching base product for: %. Left untouched — fix the SKU and re-run.', v_unmatched;
  END IF;

  -- Process every box/case product that maps to a real base product.
  FOR r IN
    SELECT
      bx.id                                                            AS box_product_id,
      bx.sku                                                           AS box_sku,
      regexp_replace(bx.sku, '-(box|case)[0-9]+$', '', 'i')            AS base_sku,
      lower((regexp_match(bx.sku, '-(box|case)[0-9]+$', 'i'))[1])      AS uom_type,
      ((regexp_match(bx.sku, '([0-9]+)$'))[1])::int                    AS factor,
      bp.id                                                            AS base_product_id,
      bp.name                                                          AS base_product_name
    FROM products bx
    JOIN products bp ON bp.sku = regexp_replace(bx.sku, '-(box|case)[0-9]+$', '', 'i')
    WHERE bx.sku ~* '-(box|case)[0-9]+$'
  LOOP
    v_label := initcap(r.uom_type) || ' of ' || r.factor;   -- e.g. "Box of 12"

    -- Upsert the purchasing unit. The table is UNIQUE(product_id, supplier_id),
    -- so if the base product already has an Alpha Sport row we update it in place
    -- (keeping any real last_purchase_price already on it).
    INSERT INTO supplier_products (
      id, supplier_id, supplier_name, product_id, product_name, product_sku,
      purchase_uom, purchase_uom_qty, purchase_uom_label,
      conversion_factor, yield_factor, effective_internal_qty,
      last_purchase_price, currency, is_default_supplier, active
    ) VALUES (
      gen_random_uuid()::text, v_supplier_id, 'Alpha Sport',
      r.base_product_id, r.base_product_name, r.base_sku,
      r.uom_type, 1, v_label,
      r.factor, 1, r.factor,
      0, 'ZAR', false, true
    )
    ON CONFLICT (product_id, supplier_id) DO UPDATE SET
      supplier_name          = EXCLUDED.supplier_name,
      product_name           = EXCLUDED.product_name,
      product_sku            = EXCLUDED.product_sku,
      purchase_uom           = EXCLUDED.purchase_uom,
      purchase_uom_qty       = EXCLUDED.purchase_uom_qty,
      purchase_uom_label     = EXCLUDED.purchase_uom_label,
      conversion_factor      = EXCLUDED.conversion_factor,
      yield_factor           = EXCLUDED.yield_factor,
      effective_internal_qty = EXCLUDED.effective_internal_qty,
      active                 = true,
      updated_date           = now();
    RAISE NOTICE 'Upserted "%" on % (%).', v_label, r.base_sku, r.base_product_id;

    -- Delete any 'pack' BOM that produced this box product (by id or sku), + children.
    DELETE FROM bom_components WHERE bom_id IN (
      SELECT id FROM boms WHERE bom_type = 'pack'
        AND (product_id = r.box_product_id OR product_sku = r.box_sku));
    DELETE FROM bom_operations WHERE bom_id IN (
      SELECT id FROM boms WHERE bom_type = 'pack'
        AND (product_id = r.box_product_id OR product_sku = r.box_sku));
    DELETE FROM boms WHERE bom_type = 'pack'
        AND (product_id = r.box_product_id OR product_sku = r.box_sku);
  END LOOP;
END $$;


-- =============================================================================
-- PART 3 — ARCHIVE the duplicate box/case products (safe; keeps history).
-- =============================================================================
UPDATE products
  SET status = 'archived', updated_date = now()
WHERE sku ~* '-(box|case)[0-9]+$'
  AND EXISTS (SELECT 1 FROM products bp
              WHERE bp.sku = regexp_replace(products.sku, '-(box|case)[0-9]+$', '', 'i'));
