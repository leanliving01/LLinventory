-- =============================================================================
-- Migration 018 — Backfill partial-credit reason notes (one-off data fix)
-- Re-derives resolution_notes for existing partially_credited shortages in the new
-- "Short quantity / Price variance / Quantity & price variance" format, using each
-- shortage's most recent linked credit-note line. Records created before the label
-- change kept the old "credited X of Y, variance" text; this relabels them.
-- Safe to re-run.
-- =============================================================================
WITH latest_line AS (
  SELECT DISTINCT ON (l.shortage_id)
    l.shortage_id,
    l.credit_qty,
    l.unit_cost_excl,
    l.line_total_excl
  FROM supplier_credit_note_lines l
  WHERE l.shortage_id IS NOT NULL
  ORDER BY l.shortage_id, l.created_date DESC
)
UPDATE supplier_shortages s
SET resolution_notes = CASE
  WHEN abs(COALESCE(ll.credit_qty, 0) - COALESCE(s.shortage_qty, 0)) >= 0.001
       AND abs(COALESCE(ll.unit_cost_excl, 0) - COALESCE(s.unit_cost, 0)) >= 0.001
    THEN 'Quantity & price variance — credited '
         || rtrim(rtrim(to_char(ll.credit_qty,  'FM999999990.000'), '0'), '.') || ' of '
         || rtrim(rtrim(to_char(s.shortage_qty, 'FM999999990.000'), '0'), '.') || ' units @ R'
         || to_char(ll.unit_cost_excl, 'FM999999990.00') || ' vs R'
         || to_char(s.unit_cost,       'FM999999990.00') || '/unit · variance R '
         || to_char(ll.line_total_excl - s.shortage_qty * s.unit_cost, 'FM999999990.00')
  WHEN abs(COALESCE(ll.credit_qty, 0) - COALESCE(s.shortage_qty, 0)) >= 0.001
    THEN 'Short quantity — credited '
         || rtrim(rtrim(to_char(ll.credit_qty,  'FM999999990.000'), '0'), '.') || ' of '
         || rtrim(rtrim(to_char(s.shortage_qty, 'FM999999990.000'), '0'), '.') || ' units · variance R '
         || to_char(ll.line_total_excl - s.shortage_qty * s.unit_cost, 'FM999999990.00')
  ELSE 'Price variance — credited R'
         || to_char(ll.unit_cost_excl, 'FM999999990.00') || '/unit vs R'
         || to_char(s.unit_cost,       'FM999999990.00') || '/unit expected · variance R '
         || to_char(ll.line_total_excl - s.shortage_qty * s.unit_cost, 'FM999999990.00')
END
FROM latest_line ll
WHERE s.id = ll.shortage_id
  AND s.status = 'partially_credited';
