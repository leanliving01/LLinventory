-- Add is_dynamic_bundle flag to products.
-- Dynamic bundles are "build-your-own" products where the customer picks
-- flavour/component combinations at order time (e.g. supplement bundles).
-- The system stores ONE record per bundle type, not one per flavour combo.
ALTER TABLE products ADD COLUMN IF NOT EXISTS is_dynamic_bundle boolean NOT NULL DEFAULT false;

-- Mark existing supplement bundles as dynamic
UPDATE products SET is_dynamic_bundle = true
WHERE shopify_product_id IN (
  '10347640553751',  -- Weight Loss Supplement Bundle
  '10347653792023',  -- Wellness Supplement Bundle
  '10347661656343'   -- Protein Supplement Bundle
);

-- Delete the flavour-combo explosion records (SHOPIFY-placeholder SKUs on dynamic bundles)
DELETE FROM products
WHERE sku LIKE 'SHOPIFY-%'
  AND shopify_product_id IN (
    '10347640553751',
    '10347653792023',
    '10347661656343'
  );

-- Strip variant suffix from dynamic bundle names (reset to clean product names)
UPDATE products SET name = 'Weight Loss Supplement Bundle'  WHERE shopify_product_id = '10347640553751';
UPDATE products SET name = 'Wellness Supplement Bundle'     WHERE shopify_product_id = '10347653792023';
UPDATE products SET name = 'Protein Supplement Bundle'      WHERE shopify_product_id = '10347661656343';
