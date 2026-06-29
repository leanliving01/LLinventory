-- 089_product_roles.sql
-- ─────────────────────────────────────────────────────────────────────────────
-- Three independent product ROLES become first-class, explicit booleans:
--   sellable    → sold to customers (sales orders / Shopify)
--   purchasable → bought from suppliers (POs / supplier invoices / GRN)
--   produced    → made in-house (carries a BOM / recipe)   ← NEW column
--
-- Until now "produced" was *derived* in the UI from type + purchasable, and
-- `purchasable` defaulted to true for EVERY product (so finished meals,
-- packages, etc. looked buyable). This migration adds the stored `produced`
-- flag and corrects the seeded roles from each product's category. It is
-- intentionally conservative: it NEVER changes `sellable` (that flag is already
-- maintained per-product), and it only tightens `purchasable` for categories
-- that are never bought from a supplier.
--
-- Mirrors src/lib/productRoles.js — keep the two type lists in sync.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. New column ---------------------------------------------------------------
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS produced boolean NOT NULL DEFAULT false;

-- 2. Backfill `produced` for everything made in-house --------------------------
--    (production BOM types + packing BOM types + solo serves). Also honour the
--    legacy convention where purchasable=false meant "produced in-house".
UPDATE products
   SET produced = true,
       updated_date = now()
 WHERE produced = false
   AND (
        type IN ('wip_bulk', 'finished_meal', 'sauce', 'solo_serve', 'package', 'bundle')
        OR purchasable = false
   );

-- 3. Tighten `purchasable` for pure-produced categories ------------------------
--    These are never bought from a supplier, so they must not surface on a
--    purchase order or supplier invoice. (sauce + supplement stay purchasable —
--    a sauce can be bought OR made; supplements are resale items.)
UPDATE products
   SET purchasable = false,
       updated_date = now()
 WHERE purchasable = true
   AND type IN ('wip_bulk', 'finished_meal', 'package', 'bundle', 'solo_serve');

-- 4. Sanity: nothing should be left with no role at all ------------------------
--    (informational — flags any orphans so they can be reviewed in Catalog).
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n
    FROM products
   WHERE status = 'active'
     AND sellable = false
     AND purchasable = false
     AND produced = false;
  IF n > 0 THEN
    RAISE NOTICE '% active product(s) have no role (not sellable/purchasable/produced) — review in Catalog.', n;
  END IF;
END $$;

COMMENT ON COLUMN products.produced IS
  'Role flag: made in-house (carries a production/packing BOM). Independent of sellable/purchasable. See src/lib/productRoles.js.';
