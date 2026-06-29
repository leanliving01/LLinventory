-- 092 — Price-variance review lifecycle (accept / dispute / resolve→update|credit).
--
-- 086/091 park big supplier-price jumps in supplier_products.pending_* and the
-- Review Queue offered only Accept / Keep-old. This adds a proper tracker so a
-- flagged price can be DISPUTED with the supplier and later RESOLVED either by
-- agreeing the new price (update) or claiming a credit (price stays old).
--
-- Lifecycle:
--   pending  ──Accept──────────► accepted          (apply new price)
--   pending  ──Keep old────────► dismissed         (keep old price)
--   pending  ──Dispute─────────► disputed          (tracked follow-up w/ supplier)
--   disputed ──Resolve:Update──► resolved_updated  (apply new price)
--   disputed ──Resolve:Credit──► resolved_credit   (keep old price, credit owed)
--
-- pending_* columns on supplier_products remain the parking mirror; they are
-- CLEARED when a review reaches a terminal state. The review table is the
-- workflow source of truth (one OPEN review per supplier product).

-- ── 1. Table ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS supplier_price_reviews (
  id                       text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  created_date             timestamptz NOT NULL DEFAULT now(),
  updated_date             timestamptz NOT NULL DEFAULT now(),
  supplier_product_id      text NOT NULL,
  supplier_id              text,
  supplier_name            text,
  product_id               text,
  product_name             text,
  product_sku              text,
  purchase_uom             text,
  previous_price           numeric,
  new_price                numeric,
  new_price_per_stock_unit numeric,
  variance                 numeric,        -- decimal fraction (0.15 = 15%)
  source                   text,           -- 'grn' | 'invoice' | 'manual'
  invoice_id               text,
  status                   text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','accepted','disputed','resolved_updated','resolved_credit','dismissed')),
  credit_amount            numeric,        -- captured when resolved as a credit
  credit_note_id           text,           -- optional link to a formal credit note
  notes                    text,
  disputed_at              timestamptz,
  resolved_at              timestamptz,
  decided_by               text
);

CREATE INDEX IF NOT EXISTS idx_spr_status ON supplier_price_reviews(status);
CREATE INDEX IF NOT EXISTS idx_spr_sp     ON supplier_price_reviews(supplier_product_id);
-- At most one OPEN (pending|disputed) review per supplier product.
CREATE UNIQUE INDEX IF NOT EXISTS idx_spr_one_open
  ON supplier_price_reviews(supplier_product_id)
  WHERE status IN ('pending','disputed');

DROP TRIGGER IF EXISTS trg_spr_updated_date ON supplier_price_reviews;
CREATE TRIGGER trg_spr_updated_date BEFORE UPDATE ON supplier_price_reviews
  FOR EACH ROW EXECUTE FUNCTION set_updated_date();

-- ── 2. Reprice function — now also opens a review row when it parks ───────────
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

-- ── 3. Resolve RPC — atomic state transition + price application ──────────────
CREATE OR REPLACE FUNCTION resolve_price_review(
  p_review_id     text,
  p_action        text,            -- accept | dispute | dismiss | resolve_update | resolve_credit
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
  SELECT * INTO r FROM supplier_price_reviews WHERE id = p_review_id;
  IF NOT FOUND THEN RETURN 'not_found'; END IF;

  IF    p_action = 'accept'         THEN v_status := 'accepted';         v_apply := true; v_clear := true;
  ELSIF p_action = 'dispute'        THEN v_status := 'disputed';
  ELSIF p_action = 'dismiss'        THEN v_status := 'dismissed';                         v_clear := true;
  ELSIF p_action = 'resolve_update' THEN v_status := 'resolved_updated'; v_apply := true; v_clear := true;
  ELSIF p_action = 'resolve_credit' THEN v_status := 'resolved_credit';                   v_clear := true;
  ELSE  RETURN 'bad_action';
  END IF;

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

-- ── 4. Backfill open reviews for prices already parked ───────────────────────
INSERT INTO supplier_price_reviews (
  supplier_product_id, supplier_id, supplier_name, product_id, product_name,
  product_sku, purchase_uom, previous_price, new_price, new_price_per_stock_unit,
  variance, source, invoice_id, status, created_date
)
SELECT sp.id, sp.supplier_id, sp.supplier_name, sp.product_id, sp.product_name,
       sp.product_sku, COALESCE(NULLIF(sp.purchase_uom_label, ''), sp.purchase_uom),
       sp.pending_price_previous, sp.pending_price, sp.pending_price_per_stock_unit,
       sp.pending_price_variance, 'invoice', sp.pending_price_invoice_id, 'pending',
       COALESCE(sp.pending_price_at, now())
  FROM supplier_products sp
 WHERE sp.pending_price IS NOT NULL AND sp.pending_price > 0
   AND NOT EXISTS (
     SELECT 1 FROM supplier_price_reviews r
      WHERE r.supplier_product_id = sp.id AND r.status IN ('pending','disputed')
   );
