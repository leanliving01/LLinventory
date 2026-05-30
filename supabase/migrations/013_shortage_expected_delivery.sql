-- =============================================================================
-- Migration 013 — Expected next-delivery date on shortages
-- When a short receival is set to "await remaining receival", capture when the
-- remainder is expected so the open PO has a target date for the next GRN.
-- =============================================================================
ALTER TABLE supplier_shortages
  ADD COLUMN IF NOT EXISTS expected_delivery_date date;
