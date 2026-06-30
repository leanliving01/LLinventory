-- 097 — "Cost fix" price reviews: stage per-stock-unit cost corrections for approval.
--
-- Background: a supplier price is captured per PURCHASE pack (e.g. R310 for a
-- "Case of 6", R550 for a "4 x 5kg" bag). The per-stock-unit cost that actually
-- feeds meal costing is price_per_stock_unit = last_purchase_price /
-- (conversion_factor x yield_factor). For ~half the catalogue that division was
-- never run (conversion_factor was set but price_per_stock_unit stayed 0/garbage),
-- so products.cost_avg drifted to 1000x-wrong values and every BOM rolled the
-- error up into finished-meal cost.
--
-- This migration lets us PROPOSE the corrected per-stock-unit cost as a normal
-- pending row in the existing Price Variances review queue (one Accept / Keep-old
-- per item, full audit trail) instead of silently rewriting live cost. A review of
-- kind='cost_fix' carries the corrected conversion factor + per-stock cost, and on
-- Accept the resolve RPC now ALSO writes conversion_factor and syncs the linked
-- product's cost_avg/cost_current — so accepting the review actually fixes the
-- product cost, not just the supplier price list.
--
-- 'price' reviews (the existing invoice/GRN variance flow) are untouched.

-- ── 1. New columns on the review table ───────────────────────────────────────
ALTER TABLE supplier_price_reviews
  ADD COLUMN IF NOT EXISTS kind                  text NOT NULL DEFAULT 'price',
  ADD COLUMN IF NOT EXISTS new_conversion_factor numeric,
  ADD COLUMN IF NOT EXISTS current_pps           numeric,   -- current per-stock cost (for display)
  ADD COLUMN IF NOT EXISTS derivation            text,      -- human-readable pack maths
  ADD COLUMN IF NOT EXISTS confidence            text;      -- 'high' | 'needs_input'

-- ── 2. resolve_price_review: on apply, persist conversion + sync product cost ─
--    Adds cost_fix handling; the existing 'price' behaviour is unchanged because
--    new_conversion_factor is NULL for those rows (COALESCE keeps the old factor)
--    and kind <> 'cost_fix' skips the cost_avg sync.
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

  IF p_action = 'dispute' AND r.status <> 'pending' THEN RETURN 'bad_transition'; END IF;
  IF p_action IN ('resolve_update','resolve_credit') AND r.status <> 'disputed' THEN RETURN 'bad_transition'; END IF;

  IF v_apply THEN
    -- Supplier price list: apply the (possibly unchanged) purchase price, the
    -- corrected per-stock-unit cost, and — for cost_fix — the corrected factor.
    UPDATE supplier_products SET
      last_purchase_price  = r.new_price,
      nominal_cost         = r.new_price,
      price_per_stock_unit = COALESCE(r.new_price_per_stock_unit, price_per_stock_unit),
      conversion_factor    = COALESCE(r.new_conversion_factor, conversion_factor),
      last_purchase_date   = now()
    WHERE id = r.supplier_product_id;

    -- cost_fix only: push the corrected per-stock cost onto the PURCHASED product
    -- so meal/BOM costing sees it. Manufactured items (wip_bulk/finished/package)
    -- are costed by the rollup, never from a supplier line, so they're excluded.
    IF r.kind = 'cost_fix' AND r.new_price_per_stock_unit IS NOT NULL AND r.product_id IS NOT NULL THEN
      UPDATE products SET
        cost_avg                = r.new_price_per_stock_unit,
        cost_current            = r.new_price_per_stock_unit,
        cost_avg_updated_at     = now(),
        cost_current_updated_at = now(),
        updated_date            = now()
      WHERE id = r.product_id
        AND type IN ('raw','packaging','supplement','sauce');
    END IF;
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
