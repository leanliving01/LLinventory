-- =============================================================================
-- Migration 012 — Central Supplier-Shortage Engine (Stage 1)
-- Lean Living ERP
--
-- Goal: ONE shortage record per purchase-order line item. Every screen
-- (GRN, invoice, credit note, return, tracking) reads from and writes to the
-- same row, keyed on po_line_id. This migration adds the columns that make the
-- central record possible. Dedup is enforced in application code (upsert), so
-- NO unique constraint is added and existing rows are preserved.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- supplier_shortages — central tracking columns
-- ---------------------------------------------------------------------------
ALTER TABLE supplier_shortages
  ADD COLUMN IF NOT EXISTS purchase_order_id     text,
  ADD COLUMN IF NOT EXISTS po_line_id            text,   -- central key
  ADD COLUMN IF NOT EXISTS ordered_qty           numeric,
  ADD COLUMN IF NOT EXISTS received_qty          numeric,
  ADD COLUMN IF NOT EXISTS decision              text,   -- await_receival | request_credit | split | review
  ADD COLUMN IF NOT EXISTS awaiting_qty          numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS credit_qty            numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS credit_note_id        text,
  ADD COLUMN IF NOT EXISTS credit_note_date      date,
  ADD COLUMN IF NOT EXISTS credit_amount_expected numeric,
  ADD COLUMN IF NOT EXISTS credit_amount_actual   numeric,
  ADD COLUMN IF NOT EXISTS credit_variance        numeric,
  ADD COLUMN IF NOT EXISTS return_id             text,
  -- credit_follow_up_status was added in migration 008; keep idempotent in case 008 was skipped
  ADD COLUMN IF NOT EXISTS credit_follow_up_status text NOT NULL DEFAULT 'credit_required';

-- Index the central key for fast upsert lookups
CREATE INDEX IF NOT EXISTS idx_supplier_shortages_po_line_id ON supplier_shortages(po_line_id);
CREATE INDEX IF NOT EXISTS idx_supplier_shortages_po_id ON supplier_shortages(purchase_order_id);

-- Shortages can now originate from an invoice before any GRN exists
ALTER TABLE supplier_shortages ALTER COLUMN grn_id DROP NOT NULL;

-- Widen the status vocabulary (keep legacy values for existing rows)
ALTER TABLE supplier_shortages DROP CONSTRAINT IF EXISTS supplier_shortages_status_check;
ALTER TABLE supplier_shortages
  ADD CONSTRAINT supplier_shortages_status_check CHECK (status IN (
    -- legacy
    'open','follow_up_delivery','credit_received','written_off','resolved','cancelled',
    -- central engine
    'awaiting_receival','awaiting_credit','partially_credited','under_review'
  ));

-- ---------------------------------------------------------------------------
-- grn_lines — short-receival decision (referenced in code, was missing)
-- ---------------------------------------------------------------------------
ALTER TABLE grn_lines
  ADD COLUMN IF NOT EXISTS short_receival_action text;

-- ---------------------------------------------------------------------------
-- purchase_orders — allow the credit_note_pending status used by the flow
-- (recreate with a superset of every status the app uses, idempotently)
-- ---------------------------------------------------------------------------
ALTER TABLE purchase_orders DROP CONSTRAINT IF EXISTS purchase_orders_status_check;
ALTER TABLE purchase_orders
  ADD CONSTRAINT purchase_orders_status_check CHECK (status IN (
    'draft','awaiting_approval','approved','confirmed','partially_received',
    'received','invoiced','credit_note_pending','closed','paid','cancelled'
  ));
