-- 032_stock_count_uoms.sql
-- Build 2: per-product Stock Count UOM setup. Lets an item be counted in a
-- practical unit (kg, box, bag, case, crate...) that converts back to the item's
-- main stock UOM. If no count UOM is defined, counting defaults to the main
-- stock UOM with a conversion factor of 1.
--
-- Idempotent — safe to run more than once.

CREATE TABLE IF NOT EXISTS stock_count_uoms (
  id text PRIMARY KEY,
  created_date timestamptz NOT NULL DEFAULT now(),
  updated_date timestamptz NOT NULL DEFAULT now(),
  created_by text,
  product_id text NOT NULL,
  count_uom text NOT NULL,                       -- the count unit (e.g. kg, box, bag)
  count_uom_label text,                          -- friendly name / description (e.g. "25kg Bag")
  unit_type text,                                -- weight | volume | count | pack (optional)
  conversion_factor numeric NOT NULL DEFAULT 1,  -- 1 count_uom = N main stock UOM
  is_default boolean NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS idx_stock_count_uoms_product ON stock_count_uoms(product_id);

DROP TRIGGER IF EXISTS trg_stock_count_uoms_updated_date ON stock_count_uoms;
CREATE TRIGGER trg_stock_count_uoms_updated_date
  BEFORE UPDATE ON stock_count_uoms
  FOR EACH ROW EXECUTE FUNCTION set_updated_date();
