-- =============================================================================
-- Migration 002 — Purchasing System Upgrade (Prompt 11)
-- Lean Living ERP — May 2026
-- =============================================================================

-- ---------------------------------------------------------------------------
-- tax_rates — configurable tax rate registry (Section 8)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tax_rates (
  id              text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  created_date    timestamptz NOT NULL DEFAULT now(),
  updated_date    timestamptz NOT NULL DEFAULT now(),
  created_by      text,
  name            text NOT NULL,
  rate            numeric NOT NULL DEFAULT 0,
  is_default      boolean NOT NULL DEFAULT false,
  applies_to_vat  boolean NOT NULL DEFAULT true,
  active          boolean NOT NULL DEFAULT true
);

CREATE TRIGGER trg_tax_rates_updated_date
  BEFORE UPDATE ON tax_rates FOR EACH ROW EXECUTE FUNCTION set_updated_date();

-- Seed four standard rates (idempotent — skip if already seeded)
INSERT INTO tax_rates (name, rate, is_default, applies_to_vat, active)
SELECT name, rate, is_default, applies_to_vat, true
FROM (VALUES
  ('Standard VAT (15%)', 0.15, true,  true),
  ('Zero-Rated (0%)',    0.00, false, true),
  ('VAT Exempt',         0.00, false, false),
  ('No VAT / Non-Vatable', 0.00, false, false)
) AS t(name, rate, is_default, applies_to_vat)
WHERE NOT EXISTS (SELECT 1 FROM tax_rates LIMIT 1);

-- ---------------------------------------------------------------------------
-- doc_number_sequences — atomic daily sequence for document numbering (Sections 4, 9)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS doc_number_sequences (
  id          text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  prefix      text NOT NULL,
  seq_date    date NOT NULL,
  last_seq    integer NOT NULL DEFAULT 0,
  UNIQUE(prefix, seq_date)
);

CREATE INDEX IF NOT EXISTS idx_doc_sequences_prefix_date ON doc_number_sequences(prefix, seq_date);

-- Atomic sequence increment function — returns formatted document number
CREATE OR REPLACE FUNCTION next_doc_number(p_prefix text, p_date date DEFAULT CURRENT_DATE)
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
  v_seq integer;
BEGIN
  INSERT INTO doc_number_sequences (prefix, seq_date, last_seq)
  VALUES (p_prefix, p_date, 1)
  ON CONFLICT (prefix, seq_date)
  DO UPDATE SET last_seq = doc_number_sequences.last_seq + 1
  RETURNING last_seq INTO v_seq;

  RETURN p_prefix || '-' || to_char(p_date, 'YYYYMMDD') || '-' || lpad(v_seq::text, 3, '0');
END;
$$;

-- ---------------------------------------------------------------------------
-- supplier_credit_notes — standalone credit note entity (Section 4)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS supplier_credit_notes (
  id                          text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  created_date                timestamptz NOT NULL DEFAULT now(),
  updated_date                timestamptz NOT NULL DEFAULT now(),
  created_by                  text,
  scn_number                  text NOT NULL UNIQUE,
  supplier_credit_note_number text,
  supplier_id                 text NOT NULL,
  supplier_name               text,
  credit_note_date            date NOT NULL,
  subtotal                    numeric NOT NULL DEFAULT 0,
  vat_amount                  numeric NOT NULL DEFAULT 0,
  total                       numeric NOT NULL DEFAULT 0,
  status                      text NOT NULL DEFAULT 'open' CHECK (status IN (
                                'open', 'partially_matched', 'fully_matched')),
  notes                       text,
  attachment_url              text
);

CREATE INDEX IF NOT EXISTS idx_scn_supplier_id ON supplier_credit_notes(supplier_id);
CREATE INDEX IF NOT EXISTS idx_scn_status ON supplier_credit_notes(status);
CREATE TRIGGER trg_scn_updated_date
  BEFORE UPDATE ON supplier_credit_notes FOR EACH ROW EXECUTE FUNCTION set_updated_date();

-- ---------------------------------------------------------------------------
-- supplier_credit_note_matches — links credit notes to shortages/returns (Section 4)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS supplier_credit_note_matches (
  id              text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  created_date    timestamptz NOT NULL DEFAULT now(),
  updated_date    timestamptz NOT NULL DEFAULT now(),
  created_by      text,
  credit_note_id  text NOT NULL REFERENCES supplier_credit_notes(id),
  shortage_id     text,
  return_id       text,
  matched_amount  numeric NOT NULL,
  match_date      date NOT NULL DEFAULT CURRENT_DATE,
  matched_by      text,
  notes           text,
  CONSTRAINT scnm_shortage_or_return CHECK (shortage_id IS NOT NULL OR return_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_scnm_credit_note_id ON supplier_credit_note_matches(credit_note_id);
CREATE INDEX IF NOT EXISTS idx_scnm_shortage_id ON supplier_credit_note_matches(shortage_id);
CREATE INDEX IF NOT EXISTS idx_scnm_return_id ON supplier_credit_note_matches(return_id);
CREATE TRIGGER trg_scnm_updated_date
  BEFORE UPDATE ON supplier_credit_note_matches FOR EACH ROW EXECUTE FUNCTION set_updated_date();

-- ---------------------------------------------------------------------------
-- invoice_po_match_suggestions — stores invoice-to-PO match proposals (Section 11)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS invoice_po_match_suggestions (
  id              text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  created_date    timestamptz NOT NULL DEFAULT now(),
  updated_date    timestamptz NOT NULL DEFAULT now(),
  invoice_id      text NOT NULL,
  po_id           text NOT NULL,
  confidence      integer NOT NULL DEFAULT 0,
  reasons         jsonb NOT NULL DEFAULT '[]',
  dismissed       boolean NOT NULL DEFAULT false,
  dismissed_by    text,
  dismissed_at    timestamptz,
  UNIQUE(invoice_id, po_id)
);

CREATE INDEX IF NOT EXISTS idx_match_suggestions_invoice_id ON invoice_po_match_suggestions(invoice_id);
CREATE INDEX IF NOT EXISTS idx_match_suggestions_dismissed ON invoice_po_match_suggestions(dismissed) WHERE dismissed = false;
CREATE TRIGGER trg_match_suggestions_updated_date
  BEFORE UPDATE ON invoice_po_match_suggestions FOR EACH ROW EXECUTE FUNCTION set_updated_date();

-- ---------------------------------------------------------------------------
-- suppliers — add structured payment terms + tax rate FK (Section 1)
-- ---------------------------------------------------------------------------
ALTER TABLE suppliers
  ADD COLUMN IF NOT EXISTS payment_term_type text CHECK (
    payment_term_type IS NULL OR payment_term_type IN (
      'immediate', 'days_after_invoice', 'day_of_invoice_month', 'day_of_following_month'
    )
  ),
  ADD COLUMN IF NOT EXISTS payment_term_value integer,
  ADD COLUMN IF NOT EXISTS default_tax_rate_id text;

-- Backfill new columns from old structured payment terms where set
UPDATE suppliers SET
  payment_term_type = CASE payment_terms_basis
    WHEN 'invoice_date'              THEN
      CASE WHEN COALESCE(payment_terms_days, 0) = 0 THEN 'immediate' ELSE 'days_after_invoice' END
    WHEN 'end_of_month_of_invoice'   THEN 'day_of_invoice_month'
    WHEN 'specific_day_of_month'     THEN 'day_of_following_month'
    ELSE NULL
  END,
  payment_term_value = CASE payment_terms_basis
    WHEN 'invoice_date'            THEN payment_terms_days
    WHEN 'end_of_month_of_invoice' THEN payment_terms_cutoff_day
    WHEN 'specific_day_of_month'   THEN payment_terms_cutoff_day
    ELSE NULL
  END
WHERE payment_terms_basis IS NOT NULL
  AND payment_term_type IS NULL;

-- ---------------------------------------------------------------------------
-- supplier_products — add URL field + tax rate FK (Sections 6, 8)
-- ---------------------------------------------------------------------------
ALTER TABLE supplier_products
  ADD COLUMN IF NOT EXISTS supplier_product_url text,
  ADD COLUMN IF NOT EXISTS default_tax_rate_id text;

-- ---------------------------------------------------------------------------
-- purchase_orders — add due date tracking fields (Section 1)
-- ---------------------------------------------------------------------------
ALTER TABLE purchase_orders
  ADD COLUMN IF NOT EXISTS due_date date,
  ADD COLUMN IF NOT EXISTS due_date_calculated date,
  ADD COLUMN IF NOT EXISTS due_date_overridden boolean NOT NULL DEFAULT false;

-- ---------------------------------------------------------------------------
-- purchase_invoices — add due date override tracking fields (Section 1)
-- ---------------------------------------------------------------------------
ALTER TABLE purchase_invoices
  ADD COLUMN IF NOT EXISTS due_date_calculated date,
  ADD COLUMN IF NOT EXISTS due_date_overridden boolean NOT NULL DEFAULT false;

-- ---------------------------------------------------------------------------
-- purchase_order_lines — add tax rate FK (Section 8)
-- ---------------------------------------------------------------------------
ALTER TABLE purchase_order_lines
  ADD COLUMN IF NOT EXISTS tax_rate_id text;

-- ---------------------------------------------------------------------------
-- purchase_invoice_lines — add tax rate FK (Section 8)
-- ---------------------------------------------------------------------------
ALTER TABLE purchase_invoice_lines
  ADD COLUMN IF NOT EXISTS tax_rate_id text;

-- ---------------------------------------------------------------------------
-- grn_lines — add tax rate FK (Section 8)
-- ---------------------------------------------------------------------------
ALTER TABLE grn_lines
  ADD COLUMN IF NOT EXISTS tax_rate_id text;

-- ---------------------------------------------------------------------------
-- Expand settings group CHECK to include 'purchasing' (Section 8)
-- ---------------------------------------------------------------------------
ALTER TABLE settings
  DROP CONSTRAINT IF EXISTS settings_group_check;
ALTER TABLE settings
  ADD CONSTRAINT settings_group_check
  CHECK ("group" IN ('org','tax','shopify','cin7','production','alerts','xero','sync','purchasing'));
