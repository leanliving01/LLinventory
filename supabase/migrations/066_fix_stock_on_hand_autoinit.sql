-- ============================================================================
-- 066_fix_stock_on_hand_autoinit.sql
--
-- BUG: the auto_init_stock_on_hand trigger (migration 005) creates a stock_on_hand
-- row per location when a product is inserted, but it referenced columns that no
-- longer exist:
--   • NEW.uom        → the products column was renamed to stock_uom
--   • l.active = true → the locations table has no `active` column
-- So the trigger has been failing/skipped, and every product created since the
-- rename (61 active inventory items incl. all WWR meals) has NO stock_on_hand row.
-- Consequence: those items can't be stock-counted, and a sale can't deduct them
-- (deduct_fulfilled_stock logs them in missing_skus and the order never settles).
--
-- FIX: correct the trigger function + backfill the missing rows (0 qty) so the
-- affected products become immediately trackable and deductible. Excludes
-- assemble-on-demand packages/bundles and non-stock services.
-- ============================================================================

CREATE OR REPLACE FUNCTION auto_init_stock_on_hand()
RETURNS trigger AS $$
BEGIN
  INSERT INTO stock_on_hand (
    id, product_id, product_sku, product_name,
    location_id, location_name,
    qty_on_hand, qty_committed, qty_available,
    uom, created_by
  )
  SELECT
    encode(gen_random_bytes(12), 'hex'),
    NEW.id, NEW.sku, NEW.name,
    l.id, l.name,
    0, 0, 0,
    NEW.stock_uom, 'system'
  FROM locations l
  -- Packages/bundles are assembled on demand (no own stock); services aren't stock.
  WHERE NEW.type NOT IN ('package', 'bundle', 'service')
    AND COALESCE(NEW.inventory_tracked, true) = true
  ON CONFLICT (product_id, location_id) DO NOTHING;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_auto_init_stock_on_hand ON products;
CREATE TRIGGER trg_auto_init_stock_on_hand
  AFTER INSERT ON products
  FOR EACH ROW
  EXECUTE FUNCTION auto_init_stock_on_hand();

-- ── Backfill: products that currently have NO stock_on_hand row at all ──────
-- One 0-qty row per location, mirroring the trigger. Existing products that
-- already have rows are left untouched (their location footprint is unchanged).
INSERT INTO stock_on_hand (
  id, product_id, product_sku, product_name,
  location_id, location_name,
  qty_on_hand, qty_committed, qty_available,
  uom, created_by, created_date, updated_date
)
SELECT
  encode(gen_random_bytes(12), 'hex'),
  p.id, p.sku, p.name, l.id, l.name,
  0, 0, 0, p.stock_uom, 'system-backfill', now(), now()
FROM   products p
CROSS  JOIN locations l
WHERE  p.status = 'active'
  AND  COALESCE(p.inventory_tracked, true) = true
  AND  p.type NOT IN ('package', 'bundle', 'service')
  AND  NOT EXISTS (SELECT 1 FROM stock_on_hand s WHERE s.product_id = p.id)
ON CONFLICT (product_id, location_id) DO NOTHING;
