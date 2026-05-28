-- Trigger: auto-create stock_on_hand rows when a new product is inserted.
-- Creates one row per active location so inventory numbers can be tracked
-- immediately, without any manual backend work.

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
    gen_random_uuid()::text,
    NEW.id,
    NEW.sku,
    NEW.name,
    l.id,
    l.name,
    0, 0, 0,
    NEW.uom,
    'system'
  FROM locations l
  WHERE l.active = true
  ON CONFLICT (product_id, location_id) DO NOTHING;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER trg_auto_init_stock_on_hand
  AFTER INSERT ON products
  FOR EACH ROW
  EXECUTE FUNCTION auto_init_stock_on_hand();
