-- =============================================================================
-- Migration 028 — Supplier shortage de-duplication + DB-level uniqueness guard
-- Lean Living ERP — June 2026
-- =============================================================================
-- One shortage record per (po_line_id, shortage_kind). App-level upsert was the
-- only guard, so races/double-calls created duplicates. This migration:
--   1. adds a persisted shortage_kind column (backfilled from decision)
--   2. removes existing duplicates (keeps one per po_line_id+kind)
--   3. adds a partial UNIQUE index so duplicates can never be inserted again
-- Run in the Supabase SQL Editor before deploying the matching code.
-- =============================================================================

-- 1. shortage_kind column, backfilled from the existing decision.
ALTER TABLE supplier_shortages ADD COLUMN IF NOT EXISTS shortage_kind text;

UPDATE supplier_shortages SET shortage_kind = CASE
  WHEN decision = 'request_credit'                 THEN 'credit'
  WHEN decision IN ('await_receival','receive_later') THEN 'await'
  WHEN decision = 'review'                          THEN 'review'
  ELSE 'other'
END
WHERE shortage_kind IS NULL;

-- 2. De-duplicate existing rows. Keep one per (po_line_id, shortage_kind):
--    prefer a row referenced by a credit note (line or match), else the newest.
--    Only delete extras that are NOT referenced anywhere (avoids FK errors).
WITH flagged AS (
  SELECT s.id, s.po_line_id, s.shortage_kind, s.created_date,
    (EXISTS (SELECT 1 FROM supplier_credit_note_lines  l WHERE l.shortage_id = s.id)
     OR EXISTS (SELECT 1 FROM supplier_credit_note_matches m WHERE m.shortage_id = s.id)) AS is_referenced
  FROM supplier_shortages s
  WHERE s.po_line_id IS NOT NULL
),
ranked AS (
  SELECT id, is_referenced,
    row_number() OVER (
      PARTITION BY po_line_id, shortage_kind
      ORDER BY is_referenced DESC, created_date DESC
    ) AS rn
  FROM flagged
)
DELETE FROM supplier_shortages
WHERE id IN (SELECT id FROM ranked WHERE rn > 1 AND is_referenced = false);

-- 3. Partial unique index — at most one shortage per PO line per kind.
CREATE UNIQUE INDEX IF NOT EXISTS uq_supplier_shortages_poline_kind
  ON supplier_shortages (po_line_id, shortage_kind)
  WHERE po_line_id IS NOT NULL;
