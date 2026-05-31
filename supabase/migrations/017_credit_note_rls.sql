-- =============================================================================
-- Migration 017 — Disable RLS on the credit-note tables
-- The app uses the anon/service key directly (RLS is disabled per table, see 003).
-- The new supplier_credit_note_lines table had RLS on with no policy, which blocked
-- inserts ("new row violates row-level security policy"). Disable it (and siblings
-- for safety) to match the rest of the schema.
-- =============================================================================
ALTER TABLE supplier_credit_note_lines   DISABLE ROW LEVEL SECURITY;
ALTER TABLE supplier_credit_notes        DISABLE ROW LEVEL SECURITY;
ALTER TABLE supplier_credit_note_matches DISABLE ROW LEVEL SECURITY;
