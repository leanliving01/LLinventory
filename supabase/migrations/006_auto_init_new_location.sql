-- Trigger: when a new location is added, create stock_on_hand rows
-- for all existing active products so stock can be tracked immediately.

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
    gen_random_uuid()::text,
    p.id,
    p.sku,
    p.name,
    NEW.id,
    NEW.name,
    0, 0, 0,
    p.uom,
    'system'
  FROM products p
  WHERE p.status = 'active'
  ON CONFLICT (product_id, location_id) DO NOTHING;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER trg_auto_init_stock_on_hand_for_location
  AFTER INSERT ON locations
  FOR EACH ROW
  EXECUTE FUNCTION auto_init_stock_on_hand_for_location();
