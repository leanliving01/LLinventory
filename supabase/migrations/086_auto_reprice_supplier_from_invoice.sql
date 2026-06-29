-- 086 — Keep supplier prices current from recurring invoices, flag big jumps.
--
-- When an invoice line is matched to a supplier product (auto OR manual), refresh
-- that supplier product's stored price from the line's unit cost so configured
-- pricing tracks the latest invoice automatically — EXCEPT when the change blows
-- past the supplier product's price_variance_threshold, in which case the new
-- price is parked in pending_* columns for review instead of silently overwriting
-- a possibly-wrong price (e.g. a unit mismatch billed per-kg vs per-case).
--
-- Implemented as a trigger on purchase_invoice_lines so EVERY match path is
-- covered in one place: the Xero sync's exact auto-match, the Review Queue's
-- contained-match auto-link, manual matches, and one-off backfills. No app code
-- needs to know about it.

-- ── 1. Columns ───────────────────────────────────────────────────────────────
ALTER TABLE supplier_products
  ADD COLUMN IF NOT EXISTS last_purchase_date            timestamptz,
  ADD COLUMN IF NOT EXISTS pending_price                 numeric,
  ADD COLUMN IF NOT EXISTS pending_price_per_stock_unit  numeric,
  ADD COLUMN IF NOT EXISTS pending_price_previous        numeric,
  ADD COLUMN IF NOT EXISTS pending_price_variance        numeric,
  ADD COLUMN IF NOT EXISTS pending_price_at              timestamptz,
  ADD COLUMN IF NOT EXISTS pending_price_invoice_id      text;

-- Partial index so the review surface (pending_price > 0) is a cheap lookup.
CREATE INDEX IF NOT EXISTS idx_supplier_products_pending_price
  ON supplier_products(pending_price) WHERE pending_price IS NOT NULL;

-- ── 2. Trigger function ──────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION refresh_supplier_price_from_invoice_line()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  sp        supplier_products%ROWTYPE;
  v_cf      numeric;
  v_yf      numeric;
  v_old     numeric;
  v_thr     numeric;
  v_new     numeric;
  v_pps     numeric;
  v_var     numeric;
BEGIN
  -- Only act on lines matched to a supplier product with a real positive cost.
  IF NEW.supplier_product_id IS NULL
     OR NEW.unit_cost IS NULL OR NEW.unit_cost <= 0
     OR NEW.match_status NOT IN ('auto_matched', 'manually_matched') THEN
    RETURN NEW;
  END IF;

  -- On UPDATE, skip when nothing price-relevant changed (avoid needless churn).
  IF TG_OP = 'UPDATE'
     AND NEW.supplier_product_id IS NOT DISTINCT FROM OLD.supplier_product_id
     AND NEW.unit_cost           IS NOT DISTINCT FROM OLD.unit_cost
     AND NEW.match_status        IS NOT DISTINCT FROM OLD.match_status THEN
    RETURN NEW;
  END IF;

  SELECT * INTO sp FROM supplier_products WHERE id = NEW.supplier_product_id;
  IF NOT FOUND THEN RETURN NEW; END IF;

  v_cf  := COALESCE(NULLIF(sp.conversion_factor, 0), 1);
  v_yf  := COALESCE(NULLIF(sp.yield_factor, 0), 1);
  v_old := COALESCE(sp.last_purchase_price, 0);
  v_thr := COALESCE(NULLIF(sp.price_variance_threshold, 0), 0.1);
  v_new := NEW.unit_cost;
  v_pps := v_new / (v_cf * v_yf);

  IF v_old <= 0 OR abs(v_new - v_old) / v_old <= v_thr THEN
    -- No baseline yet, or within tolerance → keep pricing current automatically.
    UPDATE supplier_products SET
      last_purchase_price          = v_new,
      nominal_cost                 = v_new,
      price_per_stock_unit         = v_pps,
      last_purchase_date           = now(),
      pending_price                = NULL,
      pending_price_per_stock_unit = NULL,
      pending_price_previous       = NULL,
      pending_price_variance       = NULL,
      pending_price_at             = NULL,
      pending_price_invoice_id     = NULL
    WHERE id = sp.id;
  ELSE
    -- Big jump → DON'T overwrite; park it for review.
    v_var := abs(v_new - v_old) / v_old;
    UPDATE supplier_products SET
      pending_price                = v_new,
      pending_price_per_stock_unit = v_pps,
      pending_price_previous       = v_old,
      pending_price_variance       = v_var,
      pending_price_at             = now(),
      pending_price_invoice_id     = NEW.invoice_id
    WHERE id = sp.id;
  END IF;

  RETURN NEW;
END;
$$;

-- ── 3. Trigger ───────────────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS trg_reprice_supplier_from_line ON purchase_invoice_lines;
CREATE TRIGGER trg_reprice_supplier_from_line
  AFTER INSERT OR UPDATE ON purchase_invoice_lines
  FOR EACH ROW EXECUTE FUNCTION refresh_supplier_price_from_invoice_line();
