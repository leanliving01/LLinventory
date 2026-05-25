-- =============================================================================
-- Migration 001 — Phase 1 Schema: New Tables, New Columns, FIFO Seed
-- Lean Living ERP — May 2026
-- =============================================================================

-- ---------------------------------------------------------------------------
-- suppliers — add is_production_supplier + structured payment terms
-- ---------------------------------------------------------------------------
ALTER TABLE suppliers
  ADD COLUMN IF NOT EXISTS is_production_supplier boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS payment_terms_basis text CHECK (
    payment_terms_basis IS NULL OR
    payment_terms_basis IN ('invoice_date','end_of_month_of_invoice','specific_day_of_month')
  ),
  ADD COLUMN IF NOT EXISTS payment_terms_days integer,
  ADD COLUMN IF NOT EXISTS payment_terms_cutoff_day integer,
  ADD COLUMN IF NOT EXISTS payment_terms_label text;
-- Note: old payment_terms (free text) column is kept for legacy data; UI hides it.

-- ---------------------------------------------------------------------------
-- product_purchase_uoms — add new purchasing unit fields + conversion_factor alias
-- ---------------------------------------------------------------------------
ALTER TABLE product_purchase_uoms
  ADD COLUMN IF NOT EXISTS purchase_uom_name text,
  ADD COLUMN IF NOT EXISTS conversion_factor numeric,
  ADD COLUMN IF NOT EXISTS price_per_purchase_uom numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS supplier_sku text,
  ADD COLUMN IF NOT EXISTS supplier_barcode text,
  ADD COLUMN IF NOT EXISTS supplier_description text;

-- Backfill conversion_factor from purchase_to_stock_factor
UPDATE product_purchase_uoms
SET conversion_factor = purchase_to_stock_factor
WHERE conversion_factor IS NULL AND purchase_to_stock_factor IS NOT NULL;

-- Backfill purchase_uom_name from label where missing
UPDATE product_purchase_uoms
SET purchase_uom_name = label
WHERE purchase_uom_name IS NULL AND label IS NOT NULL;

-- ---------------------------------------------------------------------------
-- products — add costing_method + selling_price
-- ---------------------------------------------------------------------------
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS costing_method text NOT NULL DEFAULT 'weighted_average'
      CHECK (costing_method IN ('fifo','weighted_average')),
  ADD COLUMN IF NOT EXISTS selling_price numeric NOT NULL DEFAULT 0;

-- Backfill selling_price from price
UPDATE products
SET selling_price = price
WHERE selling_price = 0 AND price IS NOT NULL AND price > 0;

-- ---------------------------------------------------------------------------
-- cost_layers — new table for FIFO cost layer tracking
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cost_layers (
  id              text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  created_date    timestamptz NOT NULL DEFAULT now(),
  updated_date    timestamptz NOT NULL DEFAULT now(),
  created_by      text,
  product_id      text NOT NULL,
  grn_line_id     text,               -- FK → grn_lines; null for opening seed layers
  received_date   date NOT NULL,
  qty_received    numeric NOT NULL,
  qty_remaining   numeric NOT NULL,
  cost_per_stock_uom numeric NOT NULL,
  is_depleted     boolean NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS idx_cost_layers_product
  ON cost_layers(product_id);

-- Partial index — the hot path: find oldest undepleted layers fast
CREATE INDEX IF NOT EXISTS idx_cost_layers_fifo_depletion
  ON cost_layers(product_id, received_date ASC)
  WHERE is_depleted = false;

CREATE TRIGGER trg_cost_layers_updated_date
  BEFORE UPDATE ON cost_layers
  FOR EACH ROW EXECUTE FUNCTION set_updated_date();

-- ---------------------------------------------------------------------------
-- FIFO seed: one opening layer per product at current SOH × cost_avg
-- All products switch to FIFO per confirmed decision.
-- ---------------------------------------------------------------------------
INSERT INTO cost_layers (
  id, product_id, received_date,
  qty_received, qty_remaining, cost_per_stock_uom, is_depleted
)
SELECT
  gen_random_uuid()::text,
  soh.product_id,
  CURRENT_DATE,
  GREATEST(soh.qty_on_hand, 0),
  GREATEST(soh.qty_on_hand, 0),
  COALESCE(p.cost_avg, 0),
  false
FROM (
  -- Aggregate SOH across all locations for each product
  SELECT product_id, SUM(qty_on_hand) AS qty_on_hand
  FROM stock_on_hand
  GROUP BY product_id
  HAVING SUM(qty_on_hand) > 0
) soh
JOIN products p ON p.id = soh.product_id
WHERE COALESCE(p.cost_avg, 0) > 0
ON CONFLICT DO NOTHING;

-- Switch all products to FIFO
UPDATE products SET costing_method = 'fifo';

-- ---------------------------------------------------------------------------
-- sync_logs — structured sync operation history
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sync_logs (
  id              text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  created_date    timestamptz NOT NULL DEFAULT now(),
  updated_date    timestamptz NOT NULL DEFAULT now(),
  source          text NOT NULL,
    -- 'shopify_orders' | 'shopify_products' | 'xero_invoices' | 'xero_purchase_orders'
  trigger_type    text NOT NULL CHECK (trigger_type IN ('scheduled','manual','webhook','reconciliation')),
  started_at      timestamptz NOT NULL DEFAULT now(),
  finished_at     timestamptz,
  status          text NOT NULL DEFAULT 'running'
    CHECK (status IN ('running','completed','partial','failed')),
  records_fetched integer NOT NULL DEFAULT 0,
  records_created integer NOT NULL DEFAULT 0,
  records_updated integer NOT NULL DEFAULT 0,
  errors_count    integer NOT NULL DEFAULT 0,
  error_detail    text
);

CREATE INDEX IF NOT EXISTS idx_sync_logs_source
  ON sync_logs(source);
CREATE INDEX IF NOT EXISTS idx_sync_logs_started_at
  ON sync_logs(started_at DESC);

CREATE TRIGGER trg_sync_logs_updated_date
  BEFORE UPDATE ON sync_logs
  FOR EACH ROW EXECUTE FUNCTION set_updated_date();

-- ---------------------------------------------------------------------------
-- unmatched_sku_alerts — Shopify orders with SKUs not in our product catalog
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS unmatched_sku_alerts (
  id              text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  created_date    timestamptz NOT NULL DEFAULT now(),
  updated_date    timestamptz NOT NULL DEFAULT now(),
  sku             text NOT NULL,
  first_seen_at   timestamptz NOT NULL DEFAULT now(),
  last_seen_at    timestamptz NOT NULL DEFAULT now(),
  order_count     integer NOT NULL DEFAULT 1,
  status          text NOT NULL DEFAULT 'open'
    CHECK (status IN ('open','resolved','ignored')),
  resolved_product_id text,
  notes           text
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_unmatched_sku_alerts_sku
  ON unmatched_sku_alerts(sku);

CREATE TRIGGER trg_unmatched_sku_alerts_updated_date
  BEFORE UPDATE ON unmatched_sku_alerts
  FOR EACH ROW EXECUTE FUNCTION set_updated_date();

-- ---------------------------------------------------------------------------
-- purchase_invoices — add credit note support
-- ---------------------------------------------------------------------------
ALTER TABLE purchase_invoices
  ADD COLUMN IF NOT EXISTS is_credit_note boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS linked_invoice_id text,
  ADD COLUMN IF NOT EXISTS credited_amount numeric NOT NULL DEFAULT 0;

-- Expand payment_status CHECK constraint to include 'credit_applied'
-- (Inline CHECK constraints get auto-named as {table}_{column}_check)
ALTER TABLE purchase_invoices
  DROP CONSTRAINT IF EXISTS purchase_invoices_payment_status_check;
ALTER TABLE purchase_invoices
  ADD CONSTRAINT purchase_invoices_payment_status_check
  CHECK (payment_status IN ('unpaid','partially_paid','paid','overdue','credit_applied'));

-- ---------------------------------------------------------------------------
-- xero_unmatched_contacts — Xero contacts that don't map to our suppliers
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS xero_unmatched_contacts (
  id              text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  created_date    timestamptz NOT NULL DEFAULT now(),
  updated_date    timestamptz NOT NULL DEFAULT now(),
  xero_contact_id text NOT NULL,
  xero_name       text NOT NULL,
  last_seen_at    timestamptz NOT NULL DEFAULT now(),
  invoice_count   integer NOT NULL DEFAULT 1,
  status          text NOT NULL DEFAULT 'unresolved'
    CHECK (status IN ('unresolved','resolved','ignored'))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_xero_unmatched_contacts_xero_id
  ON xero_unmatched_contacts(xero_contact_id);

CREATE TRIGGER trg_xero_unmatched_contacts_updated_date
  BEFORE UPDATE ON xero_unmatched_contacts
  FOR EACH ROW EXECUTE FUNCTION set_updated_date();

-- ---------------------------------------------------------------------------
-- settings — add 'sync' group
-- ---------------------------------------------------------------------------
ALTER TABLE settings
  DROP CONSTRAINT IF EXISTS settings_group_check;
ALTER TABLE settings
  ADD CONSTRAINT settings_group_check
  CHECK ("group" IN ('org','tax','shopify','cin7','production','alerts','xero','sync'));

-- Seed default sync settings
INSERT INTO settings (id, key, value, "group", label)
VALUES
  (gen_random_uuid()::text, 'shopify_poll_interval_minutes', '5',   'sync', 'Shopify polling interval (minutes)'),
  (gen_random_uuid()::text, 'xero_sync_interval_hours',     '4',   'sync', 'Xero sync interval (hours)'),
  (gen_random_uuid()::text, 'shopify_webhooks_enabled',     'true','sync', 'Shopify webhooks enabled'),
  (gen_random_uuid()::text, 'reconciliation_sweep_enabled', 'true','sync', 'Daily reconciliation sweep'),
  (gen_random_uuid()::text, 'sync_failure_alert_email',     '',    'sync', 'Email for sync failure alerts')
ON CONFLICT (key) DO NOTHING;

-- ---------------------------------------------------------------------------
-- sync_states — add retry backoff columns for Shopify polling
-- ---------------------------------------------------------------------------
ALTER TABLE sync_states
  ADD COLUMN IF NOT EXISTS retry_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS next_retry_at timestamptz;
