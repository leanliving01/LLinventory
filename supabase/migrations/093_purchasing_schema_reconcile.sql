-- 093 — Reconcile purchasing schema drift + index for invoice↔PO matching.
--
-- The live DB has columns on purchase_invoice_lines that were applied ad-hoc and
-- never written back to a migration, so a clean rebuild from the repo would be
-- MISSING them (received_qty, ordered_qty, po_line_id, grn_line_id, …). These
-- ALTERs are IF NOT EXISTS — a no-op against live, but they make the migration
-- chain reproduce reality. The canonical linkInvoiceToPO() service writes these.

ALTER TABLE purchase_invoice_lines
  ADD COLUMN IF NOT EXISTS ordered_qty           numeric,
  ADD COLUMN IF NOT EXISTS received_qty          numeric,
  ADD COLUMN IF NOT EXISTS po_line_id            text,
  ADD COLUMN IF NOT EXISTS grn_line_id           text,
  ADD COLUMN IF NOT EXISTS price_variance_pct    numeric,
  ADD COLUMN IF NOT EXISTS price_variance_flagged boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS tax_rate              numeric,
  ADD COLUMN IF NOT EXISTS tax_rate_id           text,
  ADD COLUMN IF NOT EXISTS ai_proposed_at        timestamptz;

-- Fast lookup for invoice-number auto-match (Phase 4): given a supplier + an
-- incoming invoice number, find the open PO that pre-declared it, or detect a
-- duplicate invoice.
CREATE INDEX IF NOT EXISTS idx_purchase_invoices_supplier_invoice
  ON purchase_invoices(supplier_id, invoice_number);
