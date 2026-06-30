-- 095 — Harden the reprice + price-review functions (Codex review fixes).
--
-- 1. reprice_supplier_product: lock the supplier_products row (FOR UPDATE) so two
--    concurrent reprices can't both miss an open review and trip idx_spr_one_open;
--    and when applying an in-tolerance price, SUPERSEDE any stale *pending* review
--    so an old parked price can't later be accepted. (A *disputed* review is an
--    intentional follow-up and is left alone.)
-- 2. resolve_price_review: lock the review row and enforce the state machine so a
--    terminal review can't be resolved twice (which could re-apply an old price or
--    clear pending_* belonging to a newer review).

-- ── reprice_supplier_product ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION reprice_supplier_product(
  p_sp_id      text,
  p_unit_cost  numeric,
  p_invoice_id text DEFAULT NULL,
  p_source     text DEFAULT 'invoice'
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
  v_uom text;
BEGIN
  IF p_sp_id IS NULL OR p_unit_cost IS NULL OR p_unit_cost <= 0 THEN
    RETURN 'skipped';
  END IF;

  -- Serialize concurrent reprices for the same supplier product.
  SELECT * INTO sp FROM supplier_products WHERE id = p_sp_id FOR UPDATE;
  IF NOT FOUND THEN RETURN 'skipped'; END IF;

  v_cf  := COALESCE(NULLIF(sp.conversion_factor, 0), 1);
  v_yf  := COALESCE(NULLIF(sp.yield_factor, 0), 1);
  v_old := COALESCE(sp.last_purchase_price, 0);
  v_thr := COALESCE(NULLIF(sp.price_variance_threshold, 0), 0.1);
  v_new := p_unit_cost;
  v_pps := v_new / (v_cf * v_yf);

  IF v_old <= 0 OR abs(v_new - v_old) / v_old <= v_thr THEN
    -- In tolerance → apply, and supersede any stale PENDING review (a parked
    -- price that's now moot). Leave DISPUTED reviews — they're active follow-ups.
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

    UPDATE supplier_price_reviews SET
      status       = 'dismissed',
      resolved_at  = now(),
      notes        = COALESCE(notes || ' · ', '') || 'superseded by an in-tolerance price',
      updated_date = now()
    WHERE supplier_product_id = sp.id AND status = 'pending';

    RETURN 'applied';
  END IF;

  -- Big jump → park it AND open/refresh a review row for the tracker.
  v_var := abs(v_new - v_old) / v_old;
  v_uom := COALESCE(NULLIF(sp.purchase_uom_label, ''), sp.purchase_uom);

  UPDATE supplier_products SET
    pending_price                = v_new,
    pending_price_per_stock_unit = v_pps,
    pending_price_previous       = v_old,
    pending_price_variance       = v_var,
    pending_price_at             = now(),
    pending_price_invoice_id     = p_invoice_id
  WHERE id = sp.id;

  UPDATE supplier_price_reviews SET
    previous_price           = v_old,
    new_price                = v_new,
    new_price_per_stock_unit = v_pps,
    variance                 = v_var,
    source                   = p_source,
    invoice_id               = COALESCE(p_invoice_id, invoice_id),
    updated_date             = now()
  WHERE supplier_product_id = sp.id
    AND status IN ('pending','disputed');

  IF NOT FOUND THEN
    INSERT INTO supplier_price_reviews (
      supplier_product_id, supplier_id, supplier_name, product_id, product_name,
      product_sku, purchase_uom, previous_price, new_price, new_price_per_stock_unit,
      variance, source, invoice_id, status
    ) VALUES (
      sp.id, sp.supplier_id, sp.supplier_name, sp.product_id, sp.product_name,
      sp.product_sku, v_uom, v_old, v_new, v_pps,
      v_var, p_source, p_invoice_id, 'pending'
    );
  END IF;

  RETURN 'parked';
END;
$$;

-- ── resolve_price_review ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION resolve_price_review(
  p_review_id     text,
  p_action        text,
  p_user          text    DEFAULT NULL,
  p_notes         text    DEFAULT NULL,
  p_credit_amount numeric DEFAULT NULL
) RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
  r        supplier_price_reviews%ROWTYPE;
  v_status text;
  v_apply  boolean := false;
  v_clear  boolean := false;
BEGIN
  -- Lock the review and enforce the state machine: only an OPEN review can move.
  SELECT * INTO r FROM supplier_price_reviews WHERE id = p_review_id FOR UPDATE;
  IF NOT FOUND THEN RETURN 'not_found'; END IF;
  IF r.status NOT IN ('pending','disputed') THEN RETURN 'already_resolved'; END IF;

  IF    p_action = 'accept'         THEN v_status := 'accepted';         v_apply := true; v_clear := true;
  ELSIF p_action = 'dispute'        THEN v_status := 'disputed';
  ELSIF p_action = 'dismiss'        THEN v_status := 'dismissed';                         v_clear := true;
  ELSIF p_action = 'resolve_update' THEN v_status := 'resolved_updated'; v_apply := true; v_clear := true;
  ELSIF p_action = 'resolve_credit' THEN v_status := 'resolved_credit';                   v_clear := true;
  ELSE  RETURN 'bad_action';
  END IF;

  -- 'dispute' only valid from 'pending'; resolves only from 'disputed'.
  IF p_action = 'dispute' AND r.status <> 'pending' THEN RETURN 'bad_transition'; END IF;
  IF p_action IN ('resolve_update','resolve_credit') AND r.status <> 'disputed' THEN RETURN 'bad_transition'; END IF;

  IF v_apply THEN
    UPDATE supplier_products SET
      last_purchase_price  = r.new_price,
      nominal_cost         = r.new_price,
      price_per_stock_unit = COALESCE(r.new_price_per_stock_unit, price_per_stock_unit),
      last_purchase_date   = now()
    WHERE id = r.supplier_product_id;
  END IF;

  IF v_clear THEN
    UPDATE supplier_products SET
      pending_price                = NULL,
      pending_price_per_stock_unit = NULL,
      pending_price_previous       = NULL,
      pending_price_variance       = NULL,
      pending_price_at             = NULL,
      pending_price_invoice_id     = NULL
    WHERE id = r.supplier_product_id;
  END IF;

  UPDATE supplier_price_reviews SET
    status        = v_status,
    decided_by    = COALESCE(p_user, decided_by),
    notes         = COALESCE(p_notes, notes),
    credit_amount = CASE WHEN p_action = 'resolve_credit' THEN p_credit_amount ELSE credit_amount END,
    disputed_at   = CASE WHEN p_action = 'dispute' THEN now() ELSE disputed_at END,
    resolved_at   = CASE WHEN p_action IN ('accept','dismiss','resolve_update','resolve_credit') THEN now() ELSE resolved_at END,
    updated_date  = now()
  WHERE id = r.id;

  RETURN v_status;
END;
$$;
