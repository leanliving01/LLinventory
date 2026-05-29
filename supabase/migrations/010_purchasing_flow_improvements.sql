-- Phase 1: add credit_note_pending to PO status enum
ALTER TABLE purchase_orders DROP CONSTRAINT IF EXISTS purchase_orders_status_check;
ALTER TABLE purchase_orders ADD CONSTRAINT purchase_orders_status_check
  CHECK (status IN (
    'draft','awaiting_approval','approved','confirmed',
    'partially_received','received','invoiced',
    'credit_note_pending','closed','cancelled','paid'
  ));

-- Phase 3: add three-way match + price variance columns to invoice lines
ALTER TABLE purchase_invoice_lines
  ADD COLUMN IF NOT EXISTS po_line_id          text,
  ADD COLUMN IF NOT EXISTS grn_line_id         text,
  ADD COLUMN IF NOT EXISTS ordered_qty         numeric,
  ADD COLUMN IF NOT EXISTS received_qty        numeric,
  ADD COLUMN IF NOT EXISTS price_variance_pct  numeric,
  ADD COLUMN IF NOT EXISTS price_variance_flagged boolean NOT NULL DEFAULT false;
