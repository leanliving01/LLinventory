-- =============================================================================
-- Migration 015 — Credit-note line items + document totals
-- Turns the supplier credit note into a proper document with line items, per-line
-- VAT, and a captured-vs-recalculated total variance. Reuses supplier_credit_notes
-- (header) and supplier_credit_note_matches (links to shortages/returns).
-- =============================================================================

-- Header: link to the PO + capture the supplier's stated total and the variance
ALTER TABLE supplier_credit_notes
  ADD COLUMN IF NOT EXISTS purchase_order_id text,
  ADD COLUMN IF NOT EXISTS captured_total    numeric,
  ADD COLUMN IF NOT EXISTS total_variance    numeric;

-- Line items
CREATE TABLE IF NOT EXISTS supplier_credit_note_lines (
  id              text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  created_date    timestamptz NOT NULL DEFAULT now(),
  updated_date    timestamptz NOT NULL DEFAULT now(),
  created_by      text,
  credit_note_id  text NOT NULL,
  shortage_id     text,            -- link to the central shortage being credited (nullable)
  return_id       text,            -- link to the supplier return being credited (nullable)
  product_id      text,
  product_name    text,
  product_sku     text,
  credit_qty      numeric NOT NULL DEFAULT 0,
  unit_cost_excl  numeric NOT NULL DEFAULT 0,   -- entered & displayed EXCL VAT
  tax_rate_id     text,
  tax_rule        text,
  tax_rate        numeric NOT NULL DEFAULT 0,   -- decimal, e.g. 0.15
  line_total_excl numeric NOT NULL DEFAULT 0,
  line_total_incl numeric NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_scn_lines_credit_note_id ON supplier_credit_note_lines(credit_note_id);

DROP TRIGGER IF EXISTS trg_scn_lines_updated_date ON supplier_credit_note_lines;
CREATE TRIGGER trg_scn_lines_updated_date
  BEFORE UPDATE ON supplier_credit_note_lines
  FOR EACH ROW EXECUTE FUNCTION set_updated_date();
