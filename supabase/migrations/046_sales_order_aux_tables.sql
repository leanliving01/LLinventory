-- ============================================================================
-- 046_sales_order_aux_tables
-- Per-order Notes, Audit-history Events, and Documents/References.
--
-- These power three tabs on the one-stop order detail view and apply equally to
-- Shopify and manual orders. Following the 041 convention: text PK, created_/
-- updated_date, created_by, plain-text order references (no hard FK), RLS off.
-- ============================================================================

-- 1. Structured, timestamped internal notes ---------------------------------
CREATE TABLE IF NOT EXISTS sales_order_notes (
  id            text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  created_date  timestamptz NOT NULL DEFAULT now(),
  updated_date  timestamptz NOT NULL DEFAULT now(),
  created_by    text,

  sales_order_id   text NOT NULL,
  shopify_order_id text,
  order_number     text,

  note      text NOT NULL,
  category  text NOT NULL DEFAULT 'general' CHECK (category IN (
    'general','customer_service','warehouse','finance','management')),
  author    text
);
CREATE INDEX IF NOT EXISTS idx_son_sales_order_id ON sales_order_notes(sales_order_id);

DROP TRIGGER IF EXISTS trg_son_updated_date ON sales_order_notes;
CREATE TRIGGER trg_son_updated_date
  BEFORE UPDATE ON sales_order_notes FOR EACH ROW EXECUTE FUNCTION set_updated_date();

-- 2. Audit-history timeline events ------------------------------------------
CREATE TABLE IF NOT EXISTS sales_order_events (
  id            text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  created_date  timestamptz NOT NULL DEFAULT now(),
  updated_date  timestamptz NOT NULL DEFAULT now(),
  created_by    text,

  sales_order_id   text NOT NULL,
  shopify_order_id text,
  order_number     text,

  -- created | imported | edited | payment_updated | fulfilled | cancelled |
  -- refunded | return_created | resend_created | cost_added | note_added |
  -- document_added | status_changed
  event_type  text NOT NULL,
  description text,
  actor       text,
  metadata    jsonb
);
CREATE INDEX IF NOT EXISTS idx_soe_sales_order_id ON sales_order_events(sales_order_id);
CREATE INDEX IF NOT EXISTS idx_soe_event_type     ON sales_order_events(event_type);
CREATE INDEX IF NOT EXISTS idx_soe_created_date    ON sales_order_events(created_date);

DROP TRIGGER IF EXISTS trg_soe_updated_date ON sales_order_events;
CREATE TRIGGER trg_soe_updated_date
  BEFORE UPDATE ON sales_order_events FOR EACH ROW EXECUTE FUNCTION set_updated_date();

-- 3. Documents / external references ----------------------------------------
CREATE TABLE IF NOT EXISTS sales_order_documents (
  id            text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  created_date  timestamptz NOT NULL DEFAULT now(),
  updated_date  timestamptz NOT NULL DEFAULT now(),
  created_by    text,

  sales_order_id   text NOT NULL,
  shopify_order_id text,
  order_number     text,

  -- shopify_ref | payment_ref | fulfilment_ref | courier_ref | return_ref |
  -- resend_ref | refund_ref | attachment | other
  doc_type   text NOT NULL DEFAULT 'other',
  label      text NOT NULL,
  url        text,
  reference  text,
  notes      text
);
CREATE INDEX IF NOT EXISTS idx_sod_sales_order_id ON sales_order_documents(sales_order_id);

DROP TRIGGER IF EXISTS trg_sod_updated_date ON sales_order_documents;
CREATE TRIGGER trg_sod_updated_date
  BEFORE UPDATE ON sales_order_documents FOR EACH ROW EXECUTE FUNCTION set_updated_date();

-- RLS off (matches existing sales tables — see 041 / 022).
ALTER TABLE sales_order_notes     DISABLE ROW LEVEL SECURITY;
ALTER TABLE sales_order_events    DISABLE ROW LEVEL SECURITY;
ALTER TABLE sales_order_documents DISABLE ROW LEVEL SECURITY;
