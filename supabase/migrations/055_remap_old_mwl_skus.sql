-- ============================================================================
-- 055_remap_old_mwl_skus
--
-- Historical orders imported from Shopify contain old Men's Weight Loss (MWL)
-- meal SKU names (e.g. BeeandBea-2, BeeTri, ChiCur) that were later renamed
-- to the MLM1–MLM15 format. Those products no longer exist in the products
-- table under the old names, so deduct_fulfilled_stock cannot resolve them
-- and marks the orders as having missing_skus.
--
-- Fix: update sales_order_lines to use the current SKU names. The mapping
-- was derived by matching the old SKU abbreviations to the product names of
-- the current MLM1–MLM15 catalogue.
-- ============================================================================

-- Rename old SKUs to current MLM equivalents
UPDATE sales_order_lines SET sku = 'MLM1'  WHERE sku = 'BeeandBea-2';
UPDATE sales_order_lines SET sku = 'MLM2'  WHERE sku = 'BeeTri';
UPDATE sales_order_lines SET sku = 'MLM3'  WHERE sku = 'ChiBreSwePotandMixVeg';
UPDATE sales_order_lines SET sku = 'MLM4'  WHERE sku = 'ChiBreButandStialowitaSweandSouSau';
UPDATE sales_order_lines SET sku = 'MLM5'  WHERE sku = 'ChiBreCouandMixVeg';
UPDATE sales_order_lines SET sku = 'MLM7'  WHERE sku = 'ChiCur';
UPDATE sales_order_lines SET sku = 'MLM10' WHERE sku = 'LeaMinPasSheandCor';
UPDATE sales_order_lines SET sku = 'MLM11' WHERE sku = 'LeaMinWhiBasRicandBro';
UPDATE sales_order_lines SET sku = 'MLM12' WHERE sku = 'LeaMinWhiBasRicandGreBea';
UPDATE sales_order_lines SET sku = 'MLM13' WHERE sku = 'SteBroRicandCar';
UPDATE sales_order_lines SET sku = 'MLM14' WHERE sku = 'SteSwePotandBro';
UPDATE sales_order_lines SET sku = 'MLM15' WHERE sku = 'SweChiChi';

-- Reset stock_deducted=false for any fulfilled orders that still have
-- undeducted old-SKU lines (so the cron picks them up on the next run).
-- Orders already marked deducted (and already processed) are left alone.
UPDATE sales_orders
   SET stock_deducted    = false,
       stock_deducted_at = null
 WHERE stock_deducted  = false
   AND lifecycle_state = 'fulfilled'
   AND id IN (
     SELECT DISTINCT sales_order_id
     FROM   sales_order_lines
     WHERE  sku IN ('MLM1','MLM2','MLM3','MLM4','MLM5','MLM7',
                    'MLM10','MLM11','MLM12','MLM13','MLM14','MLM15')
   );
