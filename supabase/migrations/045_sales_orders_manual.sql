-- ============================================================================
-- 045_sales_orders_manual
-- Enable MANUAL (non-Shopify) sales orders on the shared sales_orders model.
--
-- The sales order becomes the one-stop record for every channel. Shopify orders
-- keep shopify_order_id + order_number (Shopify's number) as before. Manual
-- orders carry order_source != 'shopify', an internal SO- number, and have NO
-- shopify_order_id. external_id stays NOT NULL + UNIQUE: manual orders get a
-- synthetic 'manual:<uuid>' value from create_manual_sales_order (047) so the
-- unique key keeps holding without dropping the constraint.
--
-- All additive / idempotent. Nothing is dropped. Existing Shopify rows are
-- backfilled to order_source='shopify'.
-- ============================================================================

-- Shopify orders always have a shopify_order_id; manual orders do not.
ALTER TABLE sales_orders ALTER COLUMN shopify_order_id DROP NOT NULL;

-- Order source / sales channel. Existing rows default to 'shopify'.
ALTER TABLE sales_orders
  ADD COLUMN IF NOT EXISTS order_source text NOT NULL DEFAULT 'shopify';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'sales_orders_order_source_check'
  ) THEN
    ALTER TABLE sales_orders
      ADD CONSTRAINT sales_orders_order_source_check
      CHECK (order_source IN ('shopify','manual','retail','internal','wholesale'));
  END IF;
END $$;

-- Internal SO- number (manual orders only; Shopify orders leave this null).
ALTER TABLE sales_orders ADD COLUMN IF NOT EXISTS internal_order_number text;
CREATE UNIQUE INDEX IF NOT EXISTS uq_sales_orders_internal_order_number
  ON sales_orders (internal_order_number)
  WHERE internal_order_number IS NOT NULL;

-- Manual payment / invoice capture (Shopify payment still derives from sync).
ALTER TABLE sales_orders ADD COLUMN IF NOT EXISTS payment_method    text;
ALTER TABLE sales_orders ADD COLUMN IF NOT EXISTS payment_reference text;
ALTER TABLE sales_orders ADD COLUMN IF NOT EXISTS payment_date      timestamptz;
ALTER TABLE sales_orders ADD COLUMN IF NOT EXISTS amount_paid       numeric NOT NULL DEFAULT 0;

-- Fulfilment metadata (Shopify sync will populate tracking_url; manual via fulfill RPC).
ALTER TABLE sales_orders ADD COLUMN IF NOT EXISTS tracking_url text;

-- Cancellation detail (cancelled_at already exists in the base schema).
ALTER TABLE sales_orders ADD COLUMN IF NOT EXISTS cancelled_reason text;
ALTER TABLE sales_orders ADD COLUMN IF NOT EXISTS cancelled_by     text;

-- Billing address (shipping_* already exist; manual orders may have both).
ALTER TABLE sales_orders ADD COLUMN IF NOT EXISTS billing_address text;

CREATE INDEX IF NOT EXISTS idx_sales_orders_order_source ON sales_orders(order_source);

-- Backfill safety (default already covers existing rows, but explicit + idempotent).
UPDATE sales_orders SET order_source = 'shopify' WHERE order_source IS NULL;

-- The old order sync never populated sales_orders.payment_status /
-- fulfillment_status (only lifecycle_state). Derive sensible values from the
-- already-correct lifecycle_state so the new separate status badges are right
-- immediately — even before the enriched sync redeploys and re-pulls. Only
-- touches rows still sitting at the column defaults so we never clobber data
-- the new sync has already written.
UPDATE sales_orders SET
  payment_status = CASE lifecycle_state
    WHEN 'fulfilled'        THEN 'paid'
    WHEN 'paid_unfulfilled' THEN 'paid'
    WHEN 'refunded'         THEN 'refunded'
    ELSE 'pending' END,
  fulfillment_status = CASE lifecycle_state
    WHEN 'fulfilled' THEN 'fulfilled'
    ELSE 'unfulfilled' END
WHERE order_source = 'shopify'
  AND payment_status = 'pending'
  AND fulfillment_status = 'unfulfilled';

-- Mirror amount_paid for already-paid orders so "outstanding" shows 0, not full.
UPDATE sales_orders SET amount_paid = total_amount
WHERE order_source = 'shopify' AND payment_status IN ('paid') AND amount_paid = 0;
