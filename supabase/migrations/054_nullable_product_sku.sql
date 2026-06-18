-- Allow products to be created without a SKU (e.g. imported from Shopify before
-- a SKU has been assigned). The user can assign the SKU from the inventory UI.
ALTER TABLE products ALTER COLUMN sku DROP NOT NULL;
