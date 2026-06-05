-- 039_correct_shopify_vat_prices.sql
-- Shopify-imported product prices were stored VAT-INCLUSIVE, but the catalog UI
-- labels and uses them as "Selling Price (excl. VAT)". This corrects the existing
-- data to VAT-exclusive (price / (1 + vat_rate)) for Shopify-sourced sellable
-- products, EXCLUDING packages and supplements (whose prices are set manually and
-- are already correct).
--
-- The live products table has `price`; `selling_price` may or may not exist
-- (migration 001 adds it, but is not applied everywhere) so we handle it
-- defensively via dynamic SQL.
--
-- Idempotent: a one-shot guard column (price_vat_corrected) ensures the division
-- is only ever applied once per row, even if this migration is re-run.

-- 1. Guard column so the correction can never be applied twice.
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS price_vat_corrected boolean NOT NULL DEFAULT false;

-- 2. Resolve the default VAT rate, then correct whichever price columns exist.
DO $$
DECLARE
  v_rate numeric;
  has_selling_price boolean;
  set_clause text;
  where_clause text;
BEGIN
  SELECT rate INTO v_rate
  FROM tax_rates
  WHERE is_default = true AND active = true
  ORDER BY rate DESC
  LIMIT 1;

  IF v_rate IS NULL OR v_rate <= 0 THEN
    v_rate := 0.15;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'products' AND column_name = 'selling_price'
  ) INTO has_selling_price;

  -- Always correct `price`; correct `selling_price` too when it exists.
  set_clause := 'price = CASE WHEN price IS NOT NULL AND price > 0 '
             || 'THEN ROUND(price / (1 + ' || v_rate || '), 2) ELSE price END';
  where_clause := '(price IS NOT NULL AND price > 0)';

  IF has_selling_price THEN
    set_clause := set_clause
      || ', selling_price = CASE WHEN selling_price IS NOT NULL AND selling_price > 0 '
      || 'THEN ROUND(selling_price / (1 + ' || v_rate || '), 2) ELSE selling_price END';
    where_clause := where_clause || ' OR (selling_price IS NOT NULL AND selling_price > 0)';
  END IF;

  EXECUTE
    'UPDATE products SET ' || set_clause || ', price_vat_corrected = true, updated_date = now() '
    || 'WHERE shopify_product_id IS NOT NULL '
    || 'AND COALESCE(type, '''') NOT IN (''package'', ''supplement'') '
    || 'AND price_vat_corrected = false '
    || 'AND (' || where_clause || ')';
END $$;
