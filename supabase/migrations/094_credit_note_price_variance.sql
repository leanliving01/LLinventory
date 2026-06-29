-- 094_credit_note_price_variance.sql
-- ─────────────────────────────────────────────────────────────────────────────
-- Let a supplier credit note credit a PER-INVOICE-LINE price variance (the
-- supplier billed a unit cost above the PO cost on a specific invoice line) and
-- track it so the SAME overcharge can never be credited twice.
--
--   * purchase_invoice_lines.price_variance_credited       — set true once an
--     approved credit note covers this line's overcharge; the line then stops
--     being offered in the credit-note "Add from Outstanding" picker.
--   * purchase_invoice_lines.price_variance_credit_note_id — the SCN that did it.
--   * supplier_credit_note_lines.invoice_line_id           — the link back to the
--     invoice line a price-variance credit line came from.
--
-- Mirrors src/lib/shortageEngine.js (createCreditNote) and CreditNoteEditor.jsx.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE purchase_invoice_lines
  ADD COLUMN IF NOT EXISTS price_variance_credited       boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS price_variance_credit_note_id text;

ALTER TABLE supplier_credit_note_lines
  ADD COLUMN IF NOT EXISTS invoice_line_id text;

-- Fast lookup of still-creditable (flagged but not yet credited) variance lines
-- per invoice, used when building the Outstanding picker.
CREATE INDEX IF NOT EXISTS idx_pil_price_variance_open
  ON purchase_invoice_lines (invoice_id)
  WHERE price_variance_flagged = true AND price_variance_credited = false;

COMMENT ON COLUMN purchase_invoice_lines.price_variance_credited IS
  'True once an approved supplier credit note has credited this line''s price overcharge. Prevents double-crediting. See src/lib/shortageEngine.js.';
COMMENT ON COLUMN supplier_credit_note_lines.invoice_line_id IS
  'When the credit line credits a per-invoice-line price variance, the purchase_invoice_lines.id it came from.';
