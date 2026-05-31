-- =============================================================================
-- Migration 016 — Invoice captured total + variance, per-line tax rate
-- Lets the invoice store the supplier's stated incl-VAT total and the variance
-- against the recalculated line-item total, and the per-line tax rate/rule used.
-- =============================================================================
ALTER TABLE purchase_invoices
  ADD COLUMN IF NOT EXISTS captured_total numeric,
  ADD COLUMN IF NOT EXISTS total_variance numeric;

ALTER TABLE purchase_invoice_lines
  ADD COLUMN IF NOT EXISTS tax_rate    numeric,
  ADD COLUMN IF NOT EXISTS tax_rate_id text;
