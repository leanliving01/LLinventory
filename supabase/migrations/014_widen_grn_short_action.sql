-- =============================================================================
-- Migration 014 — widen grn_lines.short_receival_action for the 5 decision options
-- Migration 008 created this column with CHECK IN ('receive_later','request_credit').
-- Stage 2 adds await_receival / split / review, so the constraint must be widened.
-- =============================================================================
ALTER TABLE grn_lines DROP CONSTRAINT IF EXISTS grn_lines_short_receival_action_check;
ALTER TABLE grn_lines
  ADD CONSTRAINT grn_lines_short_receival_action_check
  CHECK (short_receival_action IS NULL OR short_receival_action IN (
    'receive_later','await_receival','request_credit','split','review'
  ));
