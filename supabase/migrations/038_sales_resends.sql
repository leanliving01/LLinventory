-- ============================================================================
-- 038_sales_resends
-- Re-sends: replacement shipments against an existing Shopify order, plus
-- refund-decision fields on returns.
--
-- Stock rules: a draft/pending re-send moves nothing. Approving deducts the
-- resent items (packages exploded to component meals) from a user-chosen
-- location — a separate 'resend' movement linked to the original order, never
-- double-counting the original sale. Cancelling an approved re-send auto-
-- reverses the stock. All idempotent via stock_movements.reference_key.
-- ============================================================================

-- 1. Enum extensions (self-correcting — live data may exceed documented sets) --
ALTER TABLE stock_movements DROP CONSTRAINT IF EXISTS stock_movements_reason_check;
DO $$
DECLARE v_list text;
BEGIN
  SELECT string_agg(quote_literal(v), ',') INTO v_list FROM (
    SELECT unnest(ARRAY[
      'receipt','transfer','production_consume','production_yield','production_pick',
      'production_return','sale_fulfillment','wastage_usable','wastage_unusable',
      'stocktake_adjustment','return','supplier_return','cancellation_reversal',
      'write_off','packing_material','resend'
    ]) AS v
    UNION
    SELECT DISTINCT reason FROM stock_movements WHERE reason IS NOT NULL
  ) s;
  EXECUTE format(
    'ALTER TABLE stock_movements ADD CONSTRAINT stock_movements_reason_check CHECK (reason IN (%s))',
    v_list
  );
END $$;

ALTER TABLE stock_movements DROP CONSTRAINT IF EXISTS stock_movements_ref_type_check;
DO $$
DECLARE v_list text;
BEGIN
  SELECT string_agg(quote_literal(v), ',') INTO v_list FROM (
    SELECT unnest(ARRAY[
      'sales_order','purchase_order','production_run','wastage_log','stock_take',
      'transfer','grn','supplier_return','pick_list','manual','shopify_return','resend'
    ]) AS v
    UNION
    SELECT DISTINCT ref_type FROM stock_movements WHERE ref_type IS NOT NULL
  ) s;
  EXECUTE format(
    'ALTER TABLE stock_movements ADD CONSTRAINT stock_movements_ref_type_check CHECK (ref_type IS NULL OR ref_type IN (%s))',
    v_list
  );
END $$;

-- 2. Refund-decision fields on returns --------------------------------------
ALTER TABLE shopify_returns
  ADD COLUMN IF NOT EXISTS refund_decision    text NOT NULL DEFAULT 'undecided',
  ADD COLUMN IF NOT EXISTS refund_amount      numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS refund_status      text,
  ADD COLUMN IF NOT EXISTS refund_recorded_at timestamptz,
  ADD COLUMN IF NOT EXISTS refund_recorded_by text,
  ADD COLUMN IF NOT EXISTS linked_resend_id   text;
-- (decision/status kept free-of-CHECK to stay flexible; app constrains values:
--  refund_decision in undecided|refund|resend|both|none; refund_status in pending|approved|paid|rejected)

-- 3. Re-send header ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS sales_resends (
  id            text PRIMARY KEY,
  created_date  timestamptz NOT NULL DEFAULT now(),
  updated_date  timestamptz NOT NULL DEFAULT now(),
  created_by    text,

  resend_number text NOT NULL,
  sales_order_id   text,
  shopify_order_id text,
  order_number     text,

  customer_name     text,
  customer_email    text,
  customer_phone    text,
  customer_address  text,
  shipping_city     text,
  shipping_province text,
  shipping_zip      text,
  shipping_country  text,

  reason text CHECK (reason IS NULL OR reason IN (
    'incorrect_item','missing_item','damaged_item','wrong_order','quality_issue',
    'replacement_after_return','replacement_without_return','goodwill','other')),
  notes  text,
  linked_return_id text,

  status text NOT NULL DEFAULT 'draft' CHECK (status IN (
    'draft','pending_approval','approved','picked_packed','sent','cancelled','completed')),

  stock_deducted     boolean NOT NULL DEFAULT false,
  deduct_location_id text,
  deducted_at        timestamptz,
  deducted_by        text,
  approved_at        timestamptz,
  approved_by        text,

  courier_company      text,
  courier_tracking_ref text,
  dispatch_date        date,
  courier_notes        text,

  sent_at      timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_sales_resends_status         ON sales_resends(status);
CREATE INDEX IF NOT EXISTS idx_sales_resends_sales_order_id ON sales_resends(sales_order_id);
CREATE INDEX IF NOT EXISTS idx_sales_resends_order_number   ON sales_resends(order_number);
DROP TRIGGER IF EXISTS trg_sales_resends_updated_date ON sales_resends;
CREATE TRIGGER trg_sales_resends_updated_date
  BEFORE UPDATE ON sales_resends FOR EACH ROW EXECUTE FUNCTION set_updated_date();

-- 4. Re-send lines ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS sales_resend_lines (
  id            text PRIMARY KEY,
  created_date  timestamptz NOT NULL DEFAULT now(),
  updated_date  timestamptz NOT NULL DEFAULT now(),
  created_by    text,

  resend_id           text NOT NULL,
  sales_order_line_id text,
  product_id          text,
  sku                 text,
  product_name        text,
  variant_title       text,
  is_package_parent   boolean NOT NULL DEFAULT false,
  line_type           text,
  qty                 numeric NOT NULL DEFAULT 0,
  unit_price          numeric NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_sales_resend_lines_resend_id ON sales_resend_lines(resend_id);
CREATE INDEX IF NOT EXISTS idx_sales_resend_lines_sku       ON sales_resend_lines(sku);
DROP TRIGGER IF EXISTS trg_sales_resend_lines_updated_date ON sales_resend_lines;
CREATE TRIGGER trg_sales_resend_lines_updated_date
  BEFORE UPDATE ON sales_resend_lines FOR EACH ROW EXECUTE FUNCTION set_updated_date();

ALTER TABLE sales_resends      DISABLE ROW LEVEL SECURITY;
ALTER TABLE sales_resend_lines DISABLE ROW LEVEL SECURITY;

-- 5. Shared explosion: resend lines -> { component_sku: qty } ----------------
--    Mirrors deduct_fulfilled_stock: package parents explode via pack_boms.
CREATE OR REPLACE FUNCTION _resend_explode(p_resend_id text)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v jsonb := '{}'::jsonb;
  r RECORD; bom_rec RECORD; comp_sku text; meal_qty numeric; overrides jsonb;
BEGIN
  FOR r IN
    SELECT sku, qty, is_package_parent FROM sales_resend_lines
    WHERE resend_id = p_resend_id AND sku IS NOT NULL AND qty > 0
  LOOP
    IF r.is_package_parent THEN
      FOR bom_rec IN
        SELECT multiplier, component_skus, disabled_skus, sku_overrides
        FROM pack_boms WHERE package_sku = r.sku AND active = true LIMIT 1
      LOOP
        overrides := CASE
          WHEN bom_rec.sku_overrides IS NULL OR bom_rec.sku_overrides = '' OR bom_rec.sku_overrides = '{}'
          THEN '{}'::jsonb ELSE bom_rec.sku_overrides::jsonb END;
        FOREACH comp_sku IN ARRAY COALESCE(bom_rec.component_skus, '{}') LOOP
          IF bom_rec.disabled_skus IS NOT NULL AND comp_sku = ANY(bom_rec.disabled_skus) THEN CONTINUE; END IF;
          meal_qty := COALESCE((overrides ->> comp_sku)::numeric, bom_rec.multiplier::numeric) * r.qty;
          v := jsonb_set(v, ARRAY[comp_sku], to_jsonb(COALESCE((v ->> comp_sku)::numeric, 0) + meal_qty), true);
        END LOOP;
      END LOOP;
    ELSE
      v := jsonb_set(v, ARRAY[r.sku], to_jsonb(COALESCE((v ->> r.sku)::numeric, 0) + r.qty), true);
    END IF;
  END LOOP;
  RETURN v;
END;
$$;

-- 6. Approve a re-send: deduct stock at the chosen location ------------------
CREATE OR REPLACE FUNCTION approve_resend(p_resend_id text, p_location_id text, p_user text DEFAULT NULL)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_rs sales_resends%ROWTYPE;
  v_map jsonb; sku_key text; v_qty numeric; v_pid text;
  v_rows int := 0; v_now timestamptz := now();
  v_missing_skus text[] := '{}'; v_missing_boms text[] := '{}';
BEGIN
  SELECT * INTO v_rs FROM sales_resends WHERE id = p_resend_id;
  IF v_rs.id IS NULL THEN RETURN json_build_object('status','error','error','resend not found'); END IF;
  IF v_rs.status NOT IN ('draft','pending_approval') THEN
    RETURN json_build_object('status','noop','reason','already ' || v_rs.status);
  END IF;
  IF p_location_id IS NULL THEN RETURN json_build_object('status','error','error','location required'); END IF;

  v_map := _resend_explode(p_resend_id);

  SELECT COALESCE(array_agg(DISTINCT srl.sku), '{}') INTO v_missing_boms
  FROM sales_resend_lines srl
  WHERE srl.resend_id = p_resend_id AND srl.is_package_parent
    AND NOT EXISTS (SELECT 1 FROM pack_boms pb WHERE pb.package_sku = srl.sku AND pb.active);

  FOR sku_key, v_qty IN SELECT key, value::numeric FROM jsonb_each_text(v_map) LOOP
    IF v_qty IS NULL OR v_qty = 0 THEN CONTINUE; END IF;
    SELECT id INTO v_pid FROM products WHERE sku = sku_key LIMIT 1;
    IF v_pid IS NULL THEN v_missing_skus := v_missing_skus || sku_key; CONTINUE; END IF;

    INSERT INTO stock_movements (
      id, product_id, product_sku, product_name, from_location_id, qty, uom,
      reason, ref_type, ref_id, ref_number, reference_key, unit_cost_at_movement, notes, created_date, updated_date)
    SELECT gen_random_uuid()::text, v_pid, sku_key, p.name, p_location_id, v_qty, COALESCE(p.stock_uom, 'pcs'),
      'resend', 'resend', v_rs.id, v_rs.resend_number, 'resend:' || v_rs.id || ':' || sku_key || ':out',
      0, 'Re-send ' || v_rs.resend_number || ' for order ' || COALESCE(v_rs.order_number, ''), v_now, v_now
    FROM products p WHERE p.id = v_pid
    ON CONFLICT (reference_key) DO NOTHING;

    IF FOUND THEN
      UPDATE stock_on_hand SET
        qty_on_hand   = GREATEST(0, qty_on_hand - v_qty),
        qty_available = GREATEST(0, GREATEST(0, qty_on_hand - v_qty) - COALESCE(qty_committed, 0)),
        updated_date  = v_now
      WHERE product_id = v_pid AND location_id = p_location_id;
      v_rows := v_rows + 1;
    END IF;
  END LOOP;

  UPDATE sales_resends SET
    status='approved', stock_deducted=true, deduct_location_id=p_location_id,
    deducted_at=v_now, deducted_by=p_user, approved_at=v_now, approved_by=p_user
  WHERE id = p_resend_id;

  RETURN json_build_object('status','approved','rows_written',v_rows,'missing_skus',v_missing_skus,'missing_boms',v_missing_boms);
END;
$$;

-- 7. Cancel a re-send: auto-reverse stock if already deducted ----------------
CREATE OR REPLACE FUNCTION cancel_resend(p_resend_id text, p_user text DEFAULT NULL)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_rs sales_resends%ROWTYPE;
  v_map jsonb; sku_key text; v_qty numeric; v_pid text; v_loc text;
  v_rows int := 0; v_now timestamptz := now();
BEGIN
  SELECT * INTO v_rs FROM sales_resends WHERE id = p_resend_id;
  IF v_rs.id IS NULL THEN RETURN json_build_object('status','error','error','resend not found'); END IF;
  IF v_rs.status = 'cancelled' THEN RETURN json_build_object('status','noop'); END IF;

  IF v_rs.stock_deducted THEN
    v_loc := v_rs.deduct_location_id;
    v_map := _resend_explode(p_resend_id);
    FOR sku_key, v_qty IN SELECT key, value::numeric FROM jsonb_each_text(v_map) LOOP
      IF v_qty IS NULL OR v_qty = 0 THEN CONTINUE; END IF;
      SELECT id INTO v_pid FROM products WHERE sku = sku_key LIMIT 1;
      IF v_pid IS NULL THEN CONTINUE; END IF;

      INSERT INTO stock_movements (
        id, product_id, product_sku, product_name, to_location_id, qty, uom,
        reason, ref_type, ref_id, ref_number, reference_key, unit_cost_at_movement, notes, created_date, updated_date)
      SELECT gen_random_uuid()::text, v_pid, sku_key, p.name, v_loc, v_qty, COALESCE(p.stock_uom, 'pcs'),
        'cancellation_reversal', 'resend', v_rs.id, v_rs.resend_number, 'resend:' || v_rs.id || ':' || sku_key || ':reverse',
        0, 'Re-send ' || v_rs.resend_number || ' cancelled — stock returned', v_now, v_now
      FROM products p WHERE p.id = v_pid
      ON CONFLICT (reference_key) DO NOTHING;

      IF FOUND THEN
        UPDATE stock_on_hand SET
          qty_on_hand   = qty_on_hand + v_qty,
          qty_available = GREATEST(0, (qty_on_hand + v_qty) - COALESCE(qty_committed, 0)),
          updated_date  = v_now
        WHERE product_id = v_pid AND location_id = v_loc;
        IF NOT FOUND THEN
          INSERT INTO stock_on_hand (id, product_id, product_sku, product_name, location_id,
            qty_on_hand, qty_committed, qty_available, created_date, updated_date)
          SELECT gen_random_uuid()::text, v_pid, sku_key, p.name, v_loc, v_qty, 0, v_qty, v_now, v_now
          FROM products p WHERE p.id = v_pid;
        END IF;
        v_rows := v_rows + 1;
      END IF;
    END LOOP;
  END IF;

  UPDATE sales_resends SET status='cancelled', cancelled_at=v_now WHERE id = p_resend_id;
  RETURN json_build_object('status','cancelled','rows_written',v_rows);
END;
$$;

GRANT EXECUTE ON FUNCTION _resend_explode(text)             TO service_role, authenticated;
GRANT EXECUTE ON FUNCTION approve_resend(text, text, text)  TO service_role, authenticated;
GRANT EXECUTE ON FUNCTION cancel_resend(text, text)         TO service_role, authenticated;
