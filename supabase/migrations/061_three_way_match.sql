-- ============================================================================
-- 061_three_way_match
-- Full PO ↔ GRN ↔ Invoice three-way match: a formal, line-level match result
-- with editable tolerances and an "Approve for Payment" gate.
--
--   1. purchase_invoices  — store the computed overall match status, who/when it
--      was checked, and (when out of tolerance) the manager override reason +
--      the approval audit (approved_by / approved_at).
--   2. purchase_invoice_lines — store the qty-variance result alongside the
--      existing price-variance columns, plus a per-line match status, so reports
--      and lists can read the outcome without recomputing.
--   3. settings — allow a 'purchasing' group, then seed the default tolerances
--      (STRICT): price ±2%, no over-billing, R0.50 rounding allowance. Editable
--      in Settings → Purchasing.
--
-- Idempotent (IF NOT EXISTS / ON CONFLICT). Run in the SQL Editor BEFORE
-- deploying the frontend changes.
-- ============================================================================

-- 1. Invoice header — match result + approval audit
ALTER TABLE purchase_invoices
  ADD COLUMN IF NOT EXISTS three_way_match_status text,
  ADD COLUMN IF NOT EXISTS three_way_checked_at   timestamptz,
  ADD COLUMN IF NOT EXISTS three_way_checked_by   text,
  ADD COLUMN IF NOT EXISTS match_overridden        boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS match_override_reason   text,
  ADD COLUMN IF NOT EXISTS approved_by             text,
  ADD COLUMN IF NOT EXISTS approved_at             timestamptz,
  ADD COLUMN IF NOT EXISTS total_variance          numeric;  -- recalc vs captured total (legacy-safe)

-- 2. Invoice lines — qty-variance result + per-line match status
ALTER TABLE purchase_invoice_lines
  ADD COLUMN IF NOT EXISTS qty_variance         numeric,
  ADD COLUMN IF NOT EXISTS qty_variance_flagged boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS match_line_status    text;

-- 3a. Allow a 'purchasing' settings group (the CHECK constraint predates it)
ALTER TABLE settings DROP CONSTRAINT IF EXISTS settings_group_check;
ALTER TABLE settings
  ADD CONSTRAINT settings_group_check
  CHECK ("group" IN ('org','tax','shopify','cin7','production','alerts','xero','purchasing'));

-- 3b. Seed default tolerances (STRICT). ON CONFLICT (uq_settings_key) keeps any
--     value finance has already tuned.
INSERT INTO settings (id, key, value, "group", label) VALUES
  (gen_random_uuid()::text, 'match_price_tolerance_pct',    '2',    'purchasing', 'Match: price tolerance (%)'),
  (gen_random_uuid()::text, 'match_qty_over_tolerance_pct',  '0',    'purchasing', 'Match: qty over-billing tolerance (%)'),
  (gen_random_uuid()::text, 'match_value_tolerance',         '0.50', 'purchasing', 'Match: value rounding allowance (R)')
ON CONFLICT (key) DO NOTHING;
