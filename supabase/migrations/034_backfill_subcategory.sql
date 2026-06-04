-- 034_backfill_subcategory.sql
-- Classification cleanup: the product `type` column is now the canonical
-- Category, and `subcategory` is the canonical Subcategory. The legacy
-- free-text `category` column is no longer shown in the UI.
--
-- This migration is additive / backfill-only:
--   * Copies the legacy `category` value into `subcategory` for any product
--     that does not already have a subcategory set.
--   * Normalises known legacy values (e.g. "Smart Carb" -> "Low Carb Meals").
--   * The `category` column is KEPT (not dropped) so historical data is
--     preserved and the change is reversible.
--
-- Nothing here touches `type`, stock_on_hand, stock_movements, purchase orders,
-- production usage, or Shopify sync references.
--
-- Idempotent — safe to run more than once.

-- 1) Backfill subcategory from the legacy category text where empty.
UPDATE products
SET    subcategory = NULLIF(btrim(category), '')
WHERE  (subcategory IS NULL OR btrim(subcategory) = '')
  AND  NULLIF(btrim(category), '') IS NOT NULL;

-- 2) Normalise known legacy subcategory values onto the predefined list.
UPDATE products
SET    subcategory = 'Low Carb Meals'
WHERE  type = 'finished_meal'
  AND  lower(btrim(subcategory)) IN ('smart carb', 'low carb');

UPDATE products
SET    subcategory = 'Low Carb Packages'
WHERE  type = 'package'
  AND  lower(btrim(subcategory)) IN ('smart carb', 'low carb');
