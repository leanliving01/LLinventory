-- 091 — Unify supplier repricing across EVERY price-entry path (GRN + invoice).
--
-- Until now two paths disagreed on what to do with a new supplier price:
--   • the invoice-line trigger (086) PARKED big jumps in pending_* for review;
--   • the GRN confirm flow (GRNConfirmLogic.jsx) OVERWROTE last_purchase_price
--     unconditionally, only raising a display flag.
--
-- That meant the same "big jump" silently moved the cost basis or waited for
-- review depending purely on which door the price walked in. This migration
-- makes the PARK-then-review behaviour the single rule. The compare-and-park
-- logic is extracted into reprice_supplier_product() so both the trigger and
-- the GRN flow (via RPC) share one implementation and one threshold.
--
-- Behaviour is otherwise identical to 086: within threshold (or no baseline) →
-- apply; over threshold → park in pending_price for the Product Auditing tab.

-- ── 1. Shared reprice function ───────────────────────────────────────────────
--    Returns 'applied' | 'parked' | 'skipped' so callers can react if needed.
CREATE OR REPLACE FUNCTION reprice_supplier_product(
  p_sp_id      text,
  p_unit_cost  numeric,
  p_invoice_id text DEFAULT NULL,
  p_source     text DEFAULT 'invoice'   -- 'invoice' | 'grn' | 'manual' (audit only)
) RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
  sp    supplier_products%ROWTYPE;
  v_cf  numeric;
  v_yf  numeric;
  v_old numeric;
  v_thr numeric;
  v_new numeric;
  v_pps numeric;
  v_var numeric;
BEGIN
  IF p_sp_id IS NULL OR p_unit_cost IS NULL OR p_unit_cost <= 0 THEN
    RETURN 'skipped';
  END IF;

  SELECT * INTO sp FROM supplier_products WHERE id = p_sp_id;
  IF NOT FOUND THEN RETURN 'skipped'; END IF;

  v_cf  := COALESCE(NULLIF(sp.conversion_factor, 0), 1);
  v_yf  := COALESCE(NULLIF(sp.yield_factor, 0), 1);
  v_old := COALESCE(sp.last_purchase_price, 0);
  v_thr := COALESCE(NULLIF(sp.price_variance_threshold, 0), 0.1);
  v_new := p_unit_cost;
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
    RETURN 'applied';
  ELSE
    -- Big jump → DON'T overwrite the cost basis; park it for review.
    v_var := abs(v_new - v_old) / v_old;
    UPDATE supplier_products SET
      pending_price                = v_new,
      pending_price_per_stock_unit = v_pps,
      pending_price_previous       = v_old,
      pending_price_variance       = v_var,
      pending_price_at             = now(),
      pending_price_invoice_id     = p_invoice_id
    WHERE id = sp.id;
    RETURN 'parked';
  END IF;
END;
$$;

-- ── 2. Re-point the invoice-line trigger at the shared function ───────────────
--    (Same guard conditions as 086; the price logic now lives in one place.)
CREATE OR REPLACE FUNCTION refresh_supplier_price_from_invoice_line()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
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

  PERFORM reprice_supplier_product(NEW.supplier_product_id, NEW.unit_cost, NEW.invoice_id, 'invoice');
  RETURN NEW;
END;
$$;

-- Trigger definition itself is unchanged (086 created it); left intact.
