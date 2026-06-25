-- ============================================================================
-- 068_purchase_attachments  (was 061 — renumbered to clear a number collision
-- with 061_pack_bom_autosync from parallel work)
-- Source documents (supplier invoice PDFs) for purchasing.
--   * Xero bills carry the original supplier PDF as a Xero attachment, but the
--     sync never pulled it. The fetch-xero-attachments fn now downloads each
--     bill's attachment, stores it in the `purchase-documents` bucket, and rows
--     it here linked to the invoice (and its PO if one exists).
--   * Native scans (scan-invoice) also archive their uploaded file here, so the
--     PO "Attachments" tab shows the document no matter where it came from.
--
-- Run in the SQL Editor before deploying the related functions/frontend.
-- ============================================================================

CREATE TABLE IF NOT EXISTS purchase_attachments (
  id text PRIMARY KEY,
  created_date  timestamptz NOT NULL DEFAULT now(),
  updated_date  timestamptz NOT NULL DEFAULT now(),
  invoice_id          text,           -- purchase_invoices(id)
  purchase_order_id   text,           -- purchase_orders(id)  (nullable)
  grn_id              text,           -- goods_received_notes(id) (nullable)
  source        text NOT NULL DEFAULT 'manual' CHECK (source IN ('xero','native','manual')),
  file_name     text,
  file_path     text,                 -- path within the bucket
  file_url      text,                 -- public URL for display/download
  mime_type     text,
  size_bytes    numeric,
  xero_attachment_id text,            -- Xero AttachmentID — dedupe key for imports
  uploaded_by   text
);

ALTER TABLE purchase_attachments DISABLE ROW LEVEL SECURITY;

-- Cursor for the Xero attachment backfill: NULL = not yet checked. Set once a
-- bill has been processed (whether or not it had an attachment) so the fetcher
-- doesn't re-poll it forever.
ALTER TABLE purchase_invoices
  ADD COLUMN IF NOT EXISTS attachments_fetched_at timestamptz;

-- Cursor for the price-recovery pass (reprice-from-attachments): set once an
-- invoice's lines have been re-derived from its source PDF so it isn't redone.
ALTER TABLE purchase_invoices
  ADD COLUMN IF NOT EXISTS repriced_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_purchase_attachments_invoice ON purchase_attachments(invoice_id);
CREATE INDEX IF NOT EXISTS idx_purchase_attachments_po      ON purchase_attachments(purchase_order_id);

-- Don't import the same Xero attachment twice.
CREATE UNIQUE INDEX IF NOT EXISTS uq_purchase_attachments_xero
  ON purchase_attachments(xero_attachment_id)
  WHERE xero_attachment_id IS NOT NULL;

-- Public bucket for purchase source documents (mirrors the pack-proofs setup).
INSERT INTO storage.buckets (id, name, public)
VALUES ('purchase-documents', 'purchase-documents', true)
ON CONFLICT (id) DO NOTHING;

-- Edge fns upload with the service role (bypasses RLS); native scans upload with
-- the anon/authenticated key, so allow inserts + reads on this bucket. Public
-- bucket means downloads also work via the public URL.
DROP POLICY IF EXISTS "purchase-documents insert" ON storage.objects;
CREATE POLICY "purchase-documents insert" ON storage.objects
  FOR INSERT TO anon, authenticated
  WITH CHECK (bucket_id = 'purchase-documents');

DROP POLICY IF EXISTS "purchase-documents select" ON storage.objects;
CREATE POLICY "purchase-documents select" ON storage.objects
  FOR SELECT TO anon, authenticated
  USING (bucket_id = 'purchase-documents');
