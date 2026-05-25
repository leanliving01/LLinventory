-- Function: sync par_level from par_levels table → products.par_level
-- Simple direct join: skus.sku_code now equals products.sku for all package types
CREATE OR REPLACE FUNCTION sync_par_level_to_product()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE products
  SET par_level = NEW.par_level,
      updated_date = NOW()
  FROM skus s
  WHERE s.id = NEW.sku_id
    AND products.sku = s.sku_code
    AND products.type = 'finished_meal';
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Drop and recreate trigger
DROP TRIGGER IF EXISTS trg_sync_par_level ON par_levels;

CREATE TRIGGER trg_sync_par_level
AFTER INSERT OR UPDATE ON par_levels
FOR EACH ROW EXECUTE FUNCTION sync_par_level_to_product();

-- Backfill: sync all existing par_levels → products
UPDATE products
SET par_level = pl.par_level,
    updated_date = NOW()
FROM par_levels pl
JOIN skus s ON s.id = pl.sku_id
WHERE products.sku = s.sku_code
  AND products.type = 'finished_meal'
  AND pl.par_level > 0;

-- Verify
SELECT
  COUNT(*) FILTER (WHERE par_level > 0) AS products_with_par,
  COUNT(*) AS total_finished_meals
FROM products
WHERE type = 'finished_meal';
