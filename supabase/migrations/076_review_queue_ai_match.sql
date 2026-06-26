-- ============================================================================
-- 076_review_queue_ai_match
-- AI-assisted Product Review Queue: bulk pre-fill of unmatched supplier invoice
-- lines with the CORRECT catalogue product + a full purchasing unit, so a
-- reviewer just approves instead of searching + scanning per line.
--
-- Pipeline (all OpenAI, propose-only — nothing auto-commits):
--   1. extract-invoice    — scans each invoice PDF ONCE, caches the line items
--                           on purchase_invoices.extracted_lines (no more
--                           re-scanning the whole PDF for every line).
--   2. embed-products     — embeds the active catalogue with text-embedding-3-small
--                           into products.match_embedding (pgvector), so matching
--                           is semantic ("lemon loose" -> Lemons, never Eggplant).
--   3. match-review-queue — for each unmatched line: exact SKU short-circuit,
--                           else embedding shortlist via match_products(), else
--                           a grounded LLM pick FROM THAT SHORTLIST ONLY. Writes
--                           a review_queue_proposals row (pending) with the
--                           proposed product + derived conversion/cost.
--
-- Run in the SQL Editor before deploying the functions/frontend.
-- ============================================================================

-- pgvector for semantic catalogue search ------------------------------------
CREATE EXTENSION IF NOT EXISTS vector;

-- Catalogue embeddings (1536 = text-embedding-3-small native dimension) -------
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS match_embedding vector(1536),
  ADD COLUMN IF NOT EXISTS embedding_text  text,         -- the text that was embedded (change detection)
  ADD COLUMN IF NOT EXISTS embedded_at     timestamptz;

-- Approximate-nearest-neighbour index (cosine). HNSW builds on an empty table
-- and stays correct as rows are embedded.
CREATE INDEX IF NOT EXISTS idx_products_match_embedding
  ON products USING hnsw (match_embedding vector_cosine_ops);

-- Semantic shortlist: nearest ACTIVE products to a query embedding ------------
CREATE OR REPLACE FUNCTION match_products(query_embedding vector(1536), match_count int DEFAULT 15)
RETURNS TABLE (id text, name text, sku text, stock_uom text, type text, similarity float)
LANGUAGE sql STABLE AS $$
  SELECT p.id, p.name, p.sku, p.stock_uom, p.type,
         1 - (p.match_embedding <=> query_embedding) AS similarity
  FROM products p
  WHERE p.status = 'active'
    AND p.match_embedding IS NOT NULL
  ORDER BY p.match_embedding <=> query_embedding
  LIMIT match_count;
$$;

-- Per-invoice scan cache: extract-invoice stores the OpenAI-extracted line
-- items here once, so every queue line reuses them instead of re-scanning. ----
ALTER TABLE purchase_invoices
  ADD COLUMN IF NOT EXISTS extracted_lines jsonb,
  ADD COLUMN IF NOT EXISTS extracted_at    timestamptz;

-- Cursor on the line: NULL = not yet AI-proposed. match-review-queue sets it
-- for every line it processes so chained re-runs only pick up new lines. ------
ALTER TABLE purchase_invoice_lines
  ADD COLUMN IF NOT EXISTS ai_proposed_at timestamptz;

-- One pending proposal per unmatched invoice line (PK = line id) -------------
CREATE TABLE IF NOT EXISTS review_queue_proposals (
  id            text PRIMARY KEY,        -- = invoice_line_id
  created_date  timestamptz NOT NULL DEFAULT now(),
  updated_date  timestamptz NOT NULL DEFAULT now(),
  invoice_line_id text NOT NULL,
  invoice_id    text,
  supplier_id   text,
  supplier_name text,
  -- supplier evidence (from the invoice)
  supplier_sku        text,
  supplier_description text,
  -- the proposed catalogue product (NULL = no confident match, link manually)
  proposed_product_id   text,
  proposed_product_name text,
  proposed_product_sku  text,
  proposed_stock_uom    text,
  confidence    numeric,                 -- 0..1
  match_method  text,                    -- 'sku' | 'embedding' | 'ai' | 'none'
  reasoning     text,
  -- pre-filled purchasing unit (the reviewer can tweak before approving)
  purchase_uom        text,
  purchase_uom_label  text,
  conversion_factor   numeric,
  yield_factor        numeric DEFAULT 1,
  nominal_cost        numeric,
  status        text NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending','approved','rejected')),
  approved_at   timestamptz
);

ALTER TABLE review_queue_proposals DISABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_rqp_status   ON review_queue_proposals(status);
CREATE INDEX IF NOT EXISTS idx_rqp_invoice  ON review_queue_proposals(invoice_id);
CREATE INDEX IF NOT EXISTS idx_rqp_supplier ON review_queue_proposals(supplier_id);
