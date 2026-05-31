-- =============================================================================
-- Migration 019 — Draft status for invoices and credit notes
-- Adds 'draft' to the status CHECK on purchase_invoices and supplier_credit_notes
-- so these documents can be saved part-complete and approved later. A draft has no
-- financial side-effects until approved.
-- =============================================================================
ALTER TABLE purchase_invoices DROP CONSTRAINT IF EXISTS purchase_invoices_status_check;
ALTER TABLE purchase_invoices
  ADD CONSTRAINT purchase_invoices_status_check CHECK (status IN (
    'draft','pending_match','matched','approved','disputed','on_hold'
  ));

ALTER TABLE supplier_credit_notes DROP CONSTRAINT IF EXISTS supplier_credit_notes_status_check;
ALTER TABLE supplier_credit_notes
  ADD CONSTRAINT supplier_credit_notes_status_check CHECK (status IN (
    'draft','open','partially_matched','fully_matched'
  ));
