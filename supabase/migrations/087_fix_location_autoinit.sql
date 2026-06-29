-- ============================================================================
-- 087_fix_location_autoinit_and_box_bins.sql
--
-- BUG (mirror of 066): the auto-init trigger that fires when a NEW LOCATION is
-- added (migration 006, trg_auto_init_stock_on_hand_for_location) still selects
-- the renamed/removed column `p.uom`. products.uom was renamed to stock_uom, so
-- EVERY location insert now fails with: column p.uom does not exist. This breaks
-- Settings → Warehouse "Add Warehouse / Add Zone" and any programmatic location
-- creation. (066 fixed the sibling product-insert trigger but not this one.)
--
-- FIX: correct the function the same way 066 did — use COALESCE(p.stock_uom,'pcs'),
-- a hex id like the rest of the app, and skip assemble-on-demand / non-stock types.
-- ============================================================================

CREATE OR REPLACE FUNCTION auto_init_stock_on_hand_for_location()
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
    p.id, p.sku, p.name,
    NEW.id, NEW.name,
    0, 0, 0,
    COALESCE(p.stock_uom, 'pcs'), 'system'
  FROM products p
  WHERE p.status = 'active'
    AND COALESCE(p.inventory_tracked, true) = true
    AND p.type NOT IN ('package', 'bundle', 'service')
  ON CONFLICT (product_id, location_id) DO NOTHING;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER trg_auto_init_stock_on_hand_for_location
  AFTER INSERT ON locations
  FOR EACH ROW
  EXECUTE FUNCTION auto_init_stock_on_hand_for_location();
