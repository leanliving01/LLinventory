-- ============================================================================
-- 060_invoice_line_unit_and_unit_cost_backfill
-- Purchase-invoice line pricing fixes:
--   1. Capture the invoice's unit of measure (kg / head / bunch / case / box …)
--      per line. The scanner (scan-invoice fn) already extracts it but had
--      nowhere to store it, so the reviewer couldn't tell whether "20 × R33"
--      meant 20 kg or 20 heads. Xero lines leave it null (Xero has no per-line
--      UoM); manual + scanned lines populate it.
--   2. Backfill historic rows where unit_cost was stored as the LINE TOTAL
--      instead of the per-unit price (e.g. carrots showing R660/kg when the
--      invoice was 20 × R33 = R660). The invariant unit_cost × qty = line_total
--      recovers the true per-unit price as line_total ÷ qty.
--
-- Run this in the SQL Editor BEFORE deploying the frontend changes.
-- ============================================================================

-- 1. Add the per-line unit of measure (nullable; free text — the scanner emits
--    whatever the invoice shows, e.g. 'kg', 'head', 'bunch', 'case').
ALTER TABLE purchase_invoice_lines
  ADD COLUMN IF NOT EXISTS unit text;

-- 2. Repair rows whose unit_cost is really the line total.
--    Guard rails so we only touch genuinely-broken rows:
--      * qty present and non-zero (needed to divide, and avoids per-each lines)
--      * line_total present and non-zero
--      * the stored unit_cost × qty is off from line_total by more than 2%
--        (so Xero rows — which are self-consistent — and correct scans are
--         left untouched; only mismatches like 660×20≠660 are corrected)
UPDATE purchase_invoice_lines
SET unit_cost   = ROUND(line_total / qty, 4),
    updated_date = now()
WHERE qty IS NOT NULL AND qty <> 0
  AND line_total IS NOT NULL AND line_total <> 0
  AND ABS(unit_cost * qty - line_total) > GREATEST(0.02 * ABS(line_total), 0.01);
