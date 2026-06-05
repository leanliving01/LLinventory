-- ============================================================================
-- 041_sales_financial_lines
-- Order-level NON-INVENTORY lines + manual additional costs.
--
-- A Shopify order is one complete record. Inventory product lines live in
-- sales_order_lines (the ONLY stock-affecting lines). Everything else —
-- shipping, discounts, vouchers, store credit, standalone/shipping refunds,
-- payment adjustments, tips — lives here as a financial line: linked to the
-- order for reporting & profitability, but with NO product master record and
-- NO stock impact.
--
-- sales_order_costs holds MANUAL added costs (actual courier, packaging,
-- re-send, write-off, handling, etc.). Kept separate from financial lines so
-- operating costs never mix with Shopify-imported lines or product COGS.
--
-- Convention note: like sales_resends (038), order references are plain text
-- columns (no hard FK) to match the rest of the schema and avoid insert-order
-- coupling. The order sync owns delete-and-replace of source='shopify' rows.
-- ============================================================================

-- 1. Order-level non-inventory financial lines ------------------------------
CREATE TABLE IF NOT EXISTS sales_order_financial_lines (
  id            text PRIMARY KEY,
  created_date  timestamptz NOT NULL DEFAULT now(),
  updated_date  timestamptz NOT NULL DEFAULT now(),
  created_by    text,

  sales_order_id   text NOT NULL,
  shopify_order_id text,
  order_number     text,

  category text NOT NULL CHECK (category IN (
    'shipping','discount','voucher','store_credit',
    'refund','payment_adjustment','tip','other')),
  label    text NOT NULL,

  -- amount is always the absolute value; sign captures direction:
  --   +1 = charge / adds to what the customer pays (e.g. shipping charged)
  --   -1 = reduces revenue (discount, voucher, store credit, refund)
  amount   numeric NOT NULL DEFAULT 0,
  sign     smallint NOT NULL DEFAULT 1 CHECK (sign IN (-1, 1)),
  tax_amount numeric NOT NULL DEFAULT 0,

  source   text NOT NULL DEFAULT 'shopify' CHECK (source IN ('shopify','manual','migration')),
  external_ref    text,        -- Shopify line/shipping/discount id where available
  matched_rule_id text,        -- sales_line_classification_rules.id when classified by a rule
  raw_payload     jsonb,

  notes    text
);

-- Idempotent delete-and-replace for synced rows: a given (order, source,
-- category, external_ref) appears at most once. external_ref may be null for
-- aggregate lines (e.g. total_discounts) — coalesce so the unique key holds.
CREATE UNIQUE INDEX IF NOT EXISTS uq_sofl_order_source_cat_ref
  ON sales_order_financial_lines (sales_order_id, source, category, COALESCE(external_ref, ''));
CREATE INDEX IF NOT EXISTS idx_sofl_sales_order_id ON sales_order_financial_lines(sales_order_id);
CREATE INDEX IF NOT EXISTS idx_sofl_category       ON sales_order_financial_lines(category);

DROP TRIGGER IF EXISTS trg_sofl_updated_date ON sales_order_financial_lines;
CREATE TRIGGER trg_sofl_updated_date
  BEFORE UPDATE ON sales_order_financial_lines FOR EACH ROW EXECUTE FUNCTION set_updated_date();

-- 2. Manual additional order-level costs ------------------------------------
CREATE TABLE IF NOT EXISTS sales_order_costs (
  id            text PRIMARY KEY,
  created_date  timestamptz NOT NULL DEFAULT now(),
  updated_date  timestamptz NOT NULL DEFAULT now(),
  created_by    text,

  sales_order_id   text NOT NULL,
  shopify_order_id text,
  order_number     text,

  cost_type   text NOT NULL,           -- courier_actual | packaging | resend | write_off | handling | other
  description text,
  reference   text,
  amount      numeric NOT NULL DEFAULT 0,
  cost_date   date NOT NULL DEFAULT CURRENT_DATE,
  notes       text
);
CREATE INDEX IF NOT EXISTS idx_soc_sales_order_id ON sales_order_costs(sales_order_id);
CREATE INDEX IF NOT EXISTS idx_soc_cost_type      ON sales_order_costs(cost_type);

DROP TRIGGER IF EXISTS trg_soc_updated_date ON sales_order_costs;
CREATE TRIGGER trg_soc_updated_date
  BEFORE UPDATE ON sales_order_costs FOR EACH ROW EXECUTE FUNCTION set_updated_date();

-- 3. RLS off (matches existing convention — see migration 022) ---------------
ALTER TABLE sales_order_financial_lines DISABLE ROW LEVEL SECURITY;
ALTER TABLE sales_order_costs           DISABLE ROW LEVEL SECURITY;
