-- 099 — Make "link once" stick + pricing flow through to product cost.
--
-- Two long-standing gaps the Review Queue hit:
--
--  (1) Re-asking already-linked items. The auto-linker matches an incoming invoice
--      line to an existing supplier_product by its supplier_description, but suppliers
--      reword the SAME item every invoice ("CORIANDER 100g" → "CORIANDER 30g",
--      "BABY MARROW P/KG" → "BABY MARROWLOOSE P/KG"). One stored description can't
--      cover all the wordings, so the line looks new and reappears.
--      → Give each supplier_product a `known_descriptions` array that ACCUMULATES every
--        wording it's ever been linked under, and backfill it from history so all past
--        wordings auto-match immediately. (Matcher reads this — see reviewQueueMatching.js.)
--
--  (2) Pricing not reaching the product. A matched invoice reprices the SUPPLIER row
--      but never products.cost_avg, so "linked" never moved the product cost.
--      → reprice_supplier_product now also syncs cost_avg for the purchased product
--        whenever it APPLIES an in-tolerance price (big jumps still park for review).

-- ── 1. Alias column ──────────────────────────────────────────────────────────
ALTER TABLE supplier_products
  ADD COLUMN IF NOT EXISTS known_descriptions text[] NOT NULL DEFAULT '{}';

-- ── 2. Backfill: union of the stored description + every wording ever invoiced ─
UPDATE supplier_products sp
SET known_descriptions = COALESCE((
  SELECT array_agg(DISTINCT d) FROM (
    SELECT unnest(sp.known_descriptions) AS d
    UNION
    SELECT sp.supplier_description WHERE COALESCE(sp.supplier_description, '') <> ''
    UNION
    SELECT pil.xero_description
      FROM purchase_invoice_lines pil
     WHERE pil.supplier_product_id = sp.id AND COALESCE(pil.xero_description, '') <> ''
  ) u WHERE COALESCE(d, '') <> ''
), '{}');

-- ── 3. reprice_supplier_product: also push the in-tolerance price onto cost_avg ─
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

  SELECT * INTO sp FROM supplier_products WHERE id = p_sp_id FOR UPDATE;
  IF NOT FOUND THEN RETURN 'skipped'; END IF;

  v_cf  := COALESCE(NULLIF(sp.conversion_factor, 0), 1);
  v_yf  := COALESCE(NULLIF(sp.yield_factor, 0), 1);
  v_old := COALESCE(sp.last_purchase_price, 0);
  v_thr := COALESCE(NULLIF(sp.price_variance_threshold, 0), 0.1);
  v_new := p_unit_cost;
  v_pps := v_new / (v_cf * v_yf);

  IF v_old <= 0 OR abs(v_new - v_old) / v_old <= v_thr THEN
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

    -- Pricing pass-through: a matched invoice that applies cleanly now updates the
    -- PURCHASED product's cost too, so "linked" finally moves the product cost.
    -- Manufactured items (wip_bulk/finished/package) are rollup-costed → excluded.
    IF v_pps > 0 AND sp.product_id IS NOT NULL THEN
      UPDATE products SET
        cost_avg                = v_pps,
        cost_current            = v_pps,
        cost_avg_updated_at     = now(),
        cost_current_updated_at = now(),
        updated_date            = now()
      WHERE id = sp.product_id
        AND type IN ('raw','packaging','supplement','sauce');
    END IF;

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
