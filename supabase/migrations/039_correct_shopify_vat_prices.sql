-- 039_correct_shopify_vat_prices.sql
-- Shopify-imported product prices were stored VAT-INCLUSIVE, but the catalog UI
-- labels and uses them as "Selling Price (excl. VAT)". This corrects the existing
-- data to VAT-exclusive (price / (1 + vat_rate)) for Shopify-sourced sellable
-- products, EXCLUDING packages and supplements (whose prices are set manually and
-- are already correct).
--
-- Idempotent: a one-shot guard column (price_vat_corrected) ensures the division
-- is only ever applied once per row, even if this migration is re-run.

-- 1. Guard column so the correction can never be applied twice.
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS price_vat_corrected boolean NOT NULL DEFAULT false;

-- 2. Resolve the default VAT rate (decimal, e.g. 0.15); fall back to 0.15.
DO $$
DECLARE
  v_rate numeric;
BEGIN
  SELECT rate INTO v_rate
  FROM tax_rates
  WHERE is_default = true AND active = true
  ORDER BY rate DESC
  LIMIT 1;

  IF v_rate IS NULL OR v_rate <= 0 THEN
    v_rate := 0.15;
  END IF;

  UPDATE products p
  SET
    selling_price = CASE
      WHEN p.selling_price IS NOT NULL AND p.selling_price > 0
        THEN ROUND(p.selling_price / (1 + v_rate), 2)
      ELSE p.selling_price
    END,
    price = CASE
      WHEN p.price IS NOT NULL AND p.price > 0
        THEN ROUND(p.price / (1 + v_rate), 2)
      ELSE p.price
    END,
    price_vat_corrected = true,
    updated_date = now()
  WHERE p.shopify_product_id IS NOT NULL
    AND COALESCE(p.type, '') NOT IN ('package', 'supplement')
    AND p.price_vat_corrected = false
    AND (
      (p.selling_price IS NOT NULL AND p.selling_price > 0)
      OR (p.price IS NOT NULL AND p.price > 0)
    );
END $$;
