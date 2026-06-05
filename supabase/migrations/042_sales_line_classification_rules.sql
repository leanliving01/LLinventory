-- ============================================================================
-- 042_sales_line_classification_rules
-- Editable rules that decide whether an imported Shopify line / catalog item is
-- a real inventory product or a non-inventory order-level entry (shipping,
-- discount, voucher, store credit, refund, etc).
--
-- Structural Shopify signals are evaluated FIRST in code (shipping_lines[],
-- line_item.gift_card, refunds[], discount fields). These rules cover catalog
-- line items / products that only differ by title / SKU / product_type — e.g.
-- "Local pickup", "Free shipping", "Door-to-door", gift vouchers. Ops can tune
-- the table without a code change.
--
-- Matching: case-insensitive, lowest priority first; first match wins. A line
-- that matches no rule (and is not caught by a structural signal) defaults to
-- inventory_product when it has a SKU, else 'other'.
-- ============================================================================

CREATE TABLE IF NOT EXISTS sales_line_classification_rules (
  id            text PRIMARY KEY,
  created_date  timestamptz NOT NULL DEFAULT now(),
  updated_date  timestamptz NOT NULL DEFAULT now(),
  created_by    text,

  match_type text NOT NULL CHECK (match_type IN (
    'product_type','sku_exact','sku_prefix','title_keyword','title_regex')),
  pattern    text NOT NULL,
  classified_as text NOT NULL CHECK (classified_as IN (
    'inventory_product','shipping','discount','voucher','store_credit',
    'refund','payment_adjustment','tip','other')),
  priority   int  NOT NULL DEFAULT 100,
  active     boolean NOT NULL DEFAULT true,
  notes      text
);
CREATE INDEX IF NOT EXISTS idx_slcr_active_priority
  ON sales_line_classification_rules(active, priority);

DROP TRIGGER IF EXISTS trg_slcr_updated_date ON sales_line_classification_rules;
CREATE TRIGGER trg_slcr_updated_date
  BEFORE UPDATE ON sales_line_classification_rules FOR EACH ROW EXECUTE FUNCTION set_updated_date();

ALTER TABLE sales_line_classification_rules DISABLE ROW LEVEL SECURITY;

-- Seed default rules (idempotent: only insert when the table is empty) --------
INSERT INTO sales_line_classification_rules (id, match_type, pattern, classified_as, priority, notes)
SELECT * FROM (VALUES
  -- Shipping / delivery
  (gen_random_uuid()::text, 'product_type',  'shipping',      'shipping',     10, 'Shopify product_type = Shipping'),
  (gen_random_uuid()::text, 'title_keyword', 'door to door',  'shipping',     20, 'Door-to-door delivery'),
  (gen_random_uuid()::text, 'title_keyword', 'door-to-door',  'shipping',     20, 'Door-to-door delivery'),
  (gen_random_uuid()::text, 'title_keyword', 'local pickup',  'shipping',     20, 'Local pickup / collection'),
  (gen_random_uuid()::text, 'title_keyword', 'free shipping', 'shipping',     20, 'Free shipping (record at R0)'),
  (gen_random_uuid()::text, 'title_keyword', 'courier',       'shipping',     30, 'Courier charge'),
  (gen_random_uuid()::text, 'title_keyword', 'delivery',      'shipping',     40, 'Generic delivery charge'),
  -- Vouchers / gift cards
  (gen_random_uuid()::text, 'title_keyword', 'gift voucher',  'voucher',      20, 'Gift voucher'),
  (gen_random_uuid()::text, 'title_keyword', 'gift card',     'voucher',      20, 'Gift card'),
  (gen_random_uuid()::text, 'title_keyword', 'e-gift',        'voucher',      20, 'e-Gift card'),
  -- Store credit
  (gen_random_uuid()::text, 'title_keyword', 'store credit',  'store_credit', 20, 'Store credit'),
  -- Discounts
  (gen_random_uuid()::text, 'title_keyword', 'discount',      'discount',     50, 'Discount adjustment line'),
  -- Refunds
  (gen_random_uuid()::text, 'title_keyword', 'refund',        'refund',       50, 'Standalone refund line')
) AS v
WHERE NOT EXISTS (SELECT 1 FROM sales_line_classification_rules);
