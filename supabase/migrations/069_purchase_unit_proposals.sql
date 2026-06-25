-- ============================================================================
-- 069_purchase_unit_proposals
-- AI purchasing-unit recovery. Many supplier_products have a wrong purchase
-- unit / conversion_factor (e.g. a 10kg box recorded as "1 kg", conversion 1),
-- which silently inflates costing (cost/stock = price ÷ (conversion × yield)).
--
-- propose-purchase-units reads each raw/supplement/packaging supplier product +
-- its recent invoice evidence, asks Gemini for the correct purchase unit,
-- conversion factor and supplier SKU, AUTO-APPLIES high-confidence fixes, and
-- rows the rest here as 'pending' for human review (Settings → Sync).
--
-- Run in the SQL Editor before deploying the function/frontend.
-- ============================================================================

CREATE TABLE IF NOT EXISTS purchase_unit_proposals (
  id text PRIMARY KEY,
  created_date timestamptz NOT NULL DEFAULT now(),
  updated_date timestamptz NOT NULL DEFAULT now(),
  supplier_product_id text NOT NULL,
  product_id   text,
  product_name text,
  supplier_name text,
  stock_uom    text,
  -- current values (snapshot at proposal time)
  current_purchase_uom        text,
  current_conversion_factor   numeric,
  current_purchase_uom_label  text,
  current_supplier_sku        text,
  -- proposed values
  proposed_purchase_uom       text,
  proposed_conversion_factor  numeric,
  proposed_purchase_uom_label text,
  proposed_supplier_sku       text,
  confidence  numeric,         -- 0..1
  reasoning   text,
  evidence    text,            -- invoice descriptions / labels the AI used
  status      text NOT NULL DEFAULT 'pending'
              CHECK (status IN ('pending','auto_applied','applied','rejected')),
  applied_at  timestamptz
);

ALTER TABLE purchase_unit_proposals DISABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_pup_status ON purchase_unit_proposals(status);
CREATE INDEX IF NOT EXISTS idx_pup_sp     ON purchase_unit_proposals(supplier_product_id);

-- One live proposal per supplier product (re-runs update in place).
CREATE UNIQUE INDEX IF NOT EXISTS uq_pup_sp ON purchase_unit_proposals(supplier_product_id);

-- Cursor: NULL = not yet analysed. Set for every supplier product the pass
-- looks at (in or out of scope) so re-runs only pick up new ones.
ALTER TABLE supplier_products
  ADD COLUMN IF NOT EXISTS purchase_unit_checked_at timestamptz;
