-- =============================================================================
-- Migration 029 — Price variance review sign-off
-- Lean Living ERP — June 2026
-- =============================================================================
-- Lets a user acknowledge a supplier price variance: who reviewed it and when.
-- Run in the Supabase SQL Editor before deploying the matching code.
-- =============================================================================

ALTER TABLE supplier_price_histories
  ADD COLUMN IF NOT EXISTS review_status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS reviewed_by   text,
  ADD COLUMN IF NOT EXISTS reviewed_at   timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'supplier_price_histories_review_status_check'
  ) THEN
    ALTER TABLE supplier_price_histories
      ADD CONSTRAINT supplier_price_histories_review_status_check
      CHECK (review_status IN ('pending', 'reviewed'));
  END IF;
END $$;
