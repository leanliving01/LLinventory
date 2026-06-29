-- ============================================================================
-- 088_purchase_landed_costs.sql
--
-- LANDED COST / FREIGHT CAPITALISATION
--
-- A one-off purchase charge (shipping, freight, customs, handling…) is a real
-- cost of getting stock into the building, so it must be CAPITALISED — spread
-- across the units it was incurred for — not expensed and lost. Example: buy 4
-- sauces + one shipping fee → the fee is allocated across those sauce units so
-- each unit's cost rises by its share.
--
-- Model: charges are recorded against the INVOICE (purchase_invoice_charges).
-- When that invoice's stock is received (GRN), confirmGRN allocates the charges
-- BY VALUE across the received stock lines and folds each line's share into the
-- FIFO cost layer / product cost (NOT into the supplier price — three-way match
-- and supplier-price history keep using the un-landed unit cost). Per-line
-- audit is stored on grn_lines (landed_cost_total + landed_unit_cost).
-- ============================================================================

-- ── 1. Invoice charges ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS purchase_invoice_charges (
  id                text PRIMARY KEY,
  created_date      timestamptz NOT NULL DEFAULT now(),
  updated_date      timestamptz NOT NULL DEFAULT now(),
  created_by        text,
  invoice_id        text NOT NULL REFERENCES purchase_invoices(id) ON DELETE CASCADE,
  charge_type       text NOT NULL DEFAULT 'shipping'
                      CHECK (charge_type IN ('shipping','freight','customs','duty','handling','insurance','other')),
  description       text,
  amount            numeric NOT NULL DEFAULT 0,          -- net (excl. VAT) amount to capitalise
  allocation_method text NOT NULL DEFAULT 'by_value'
                      CHECK (allocation_method IN ('by_value','by_qty')),
  allocated         boolean NOT NULL DEFAULT false,      -- true once folded into a GRN's costs
  allocated_grn_id  text,
  allocated_amount  numeric,
  allocated_at      timestamptz
);

CREATE INDEX IF NOT EXISTS idx_pi_charges_invoice ON purchase_invoice_charges(invoice_id);
CREATE INDEX IF NOT EXISTS idx_pi_charges_unallocated ON purchase_invoice_charges(invoice_id) WHERE allocated = false;

-- ── 2. Per-line landed-cost audit on receipts ───────────────────────────────
ALTER TABLE grn_lines
  ADD COLUMN IF NOT EXISTS landed_cost_total numeric NOT NULL DEFAULT 0,  -- freight allocated to this line
  ADD COLUMN IF NOT EXISTS landed_unit_cost  numeric;                     -- cost/stock-unit incl. freight (what hit the cost layer)
