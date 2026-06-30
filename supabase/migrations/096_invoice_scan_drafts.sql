-- 096: invoice scan drafts
-- Lets a scanned invoice be saved mid-flow (all extracted lines, header,
-- product mappings and per-line purchasing units) and resumed later — e.g. when
-- the user needs to go create/fix products before completing the scan.
--
-- Pure scratch state: a draft is NOT a real invoice (so it never collides with
-- the duplicate-invoice guard or the blind-receipt invoice). On completion the
-- normal save/receive runs and the draft row is deleted.
-- Dates kept as text so an empty draft (no date yet) never trips date coercion.

CREATE TABLE IF NOT EXISTS invoice_scan_drafts (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mode                 text NOT NULL DEFAULT 'invoice',   -- 'invoice' | 'blind'
  supplier_id          text,
  supplier_name        text,
  invoice_number       text,
  invoice_date         text,
  due_date             text,
  due_date_overridden  boolean NOT NULL DEFAULT false,
  extracted            jsonb,    -- the full extracted invoice (lines, totals…)
  mappings             jsonb,    -- { lineIndex: product_id | 'skip' }
  unit_forms           jsonb,    -- { lineIndex: { purchase_uom, pack_size, … } }
  file_name            text,
  file_path            text,
  file_url             text,
  mime_type            text,
  size_bytes           bigint,
  created_by           text,
  created_date         timestamptz NOT NULL DEFAULT now(),
  updated_date         timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE invoice_scan_drafts DISABLE ROW LEVEL SECURITY;
GRANT ALL ON invoice_scan_drafts TO anon, authenticated, service_role;
