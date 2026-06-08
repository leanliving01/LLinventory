-- ============================================================
-- Sales Order Module — apply in Supabase SQL Editor (run once)
-- Combines migrations 045 + 046 + 047. All additive/idempotent.
-- ============================================================

-- ============================================================================
-- 045_sales_orders_manual
-- Enable MANUAL (non-Shopify) sales orders on the shared sales_orders model.
--
-- The sales order becomes the one-stop record for every channel. Shopify orders
-- keep shopify_order_id + order_number (Shopify's number) as before. Manual
-- orders carry order_source != 'shopify', an internal SO- number, and have NO
-- shopify_order_id. external_id stays NOT NULL + UNIQUE: manual orders get a
-- synthetic 'manual:<uuid>' value from create_manual_sales_order (047) so the
-- unique key keeps holding without dropping the constraint.
--
-- All additive / idempotent. Nothing is dropped. Existing Shopify rows are
-- backfilled to order_source='shopify'.
-- ============================================================================

-- Shopify orders always have a shopify_order_id; manual orders do not.
ALTER TABLE sales_orders ALTER COLUMN shopify_order_id DROP NOT NULL;

-- Order source / sales channel. Existing rows default to 'shopify'.
ALTER TABLE sales_orders
  ADD COLUMN IF NOT EXISTS order_source text NOT NULL DEFAULT 'shopify';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'sales_orders_order_source_check'
  ) THEN
    ALTER TABLE sales_orders
      ADD CONSTRAINT sales_orders_order_source_check
      CHECK (order_source IN ('shopify','manual','retail','internal','wholesale'));
  END IF;
END $$;

-- Internal SO- number (manual orders only; Shopify orders leave this null).
ALTER TABLE sales_orders ADD COLUMN IF NOT EXISTS internal_order_number text;
CREATE UNIQUE INDEX IF NOT EXISTS uq_sales_orders_internal_order_number
  ON sales_orders (internal_order_number)
  WHERE internal_order_number IS NOT NULL;

-- Manual payment / invoice capture (Shopify payment still derives from sync).
ALTER TABLE sales_orders ADD COLUMN IF NOT EXISTS payment_method    text;
ALTER TABLE sales_orders ADD COLUMN IF NOT EXISTS payment_reference text;
ALTER TABLE sales_orders ADD COLUMN IF NOT EXISTS payment_date      timestamptz;
ALTER TABLE sales_orders ADD COLUMN IF NOT EXISTS amount_paid       numeric NOT NULL DEFAULT 0;

-- Fulfilment metadata (Shopify sync will populate tracking_url; manual via fulfill RPC).
ALTER TABLE sales_orders ADD COLUMN IF NOT EXISTS tracking_url text;

-- Cancellation detail (cancelled_at already exists in the base schema).
ALTER TABLE sales_orders ADD COLUMN IF NOT EXISTS cancelled_reason text;
ALTER TABLE sales_orders ADD COLUMN IF NOT EXISTS cancelled_by     text;

-- Billing address (shipping_* already exist; manual orders may have both).
ALTER TABLE sales_orders ADD COLUMN IF NOT EXISTS billing_address text;

CREATE INDEX IF NOT EXISTS idx_sales_orders_order_source ON sales_orders(order_source);

-- Backfill safety (default already covers existing rows, but explicit + idempotent).
UPDATE sales_orders SET order_source = 'shopify' WHERE order_source IS NULL;

-- The old order sync never populated sales_orders.payment_status /
-- fulfillment_status (only lifecycle_state). Derive sensible values from the
-- already-correct lifecycle_state so the new separate status badges are right
-- immediately — even before the enriched sync redeploys and re-pulls. Only
-- touches rows still sitting at the column defaults so we never clobber data
-- the new sync has already written.
UPDATE sales_orders SET
  payment_status = CASE lifecycle_state
    WHEN 'fulfilled'        THEN 'paid'
    WHEN 'paid_unfulfilled' THEN 'paid'
    WHEN 'refunded'         THEN 'refunded'
    ELSE 'pending' END,
  fulfillment_status = CASE lifecycle_state
    WHEN 'fulfilled' THEN 'fulfilled'
    ELSE 'unfulfilled' END
WHERE order_source = 'shopify'
  AND payment_status = 'pending'
  AND fulfillment_status = 'unfulfilled';

-- Mirror amount_paid for already-paid orders so "outstanding" shows 0, not full.
UPDATE sales_orders SET amount_paid = total_amount
WHERE order_source = 'shopify' AND payment_status IN ('paid') AND amount_paid = 0;

-- ============================================================================
-- 046_sales_order_aux_tables
-- Per-order Notes, Audit-history Events, and Documents/References.
--
-- These power three tabs on the one-stop order detail view and apply equally to
-- Shopify and manual orders. Following the 041 convention: text PK, created_/
-- updated_date, created_by, plain-text order references (no hard FK), RLS off.
-- ============================================================================

-- 1. Structured, timestamped internal notes ---------------------------------
CREATE TABLE IF NOT EXISTS sales_order_notes (
  id            text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  created_date  timestamptz NOT NULL DEFAULT now(),
  updated_date  timestamptz NOT NULL DEFAULT now(),
  created_by    text,

  sales_order_id   text NOT NULL,
  shopify_order_id text,
  order_number     text,

  note      text NOT NULL,
  category  text NOT NULL DEFAULT 'general' CHECK (category IN (
    'general','customer_service','warehouse','finance','management')),
  author    text
);
CREATE INDEX IF NOT EXISTS idx_son_sales_order_id ON sales_order_notes(sales_order_id);

DROP TRIGGER IF EXISTS trg_son_updated_date ON sales_order_notes;
CREATE TRIGGER trg_son_updated_date
  BEFORE UPDATE ON sales_order_notes FOR EACH ROW EXECUTE FUNCTION set_updated_date();

-- 2. Audit-history timeline events ------------------------------------------
CREATE TABLE IF NOT EXISTS sales_order_events (
  id            text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  created_date  timestamptz NOT NULL DEFAULT now(),
  updated_date  timestamptz NOT NULL DEFAULT now(),
  created_by    text,

  sales_order_id   text NOT NULL,
  shopify_order_id text,
  order_number     text,

  -- created | imported | edited | payment_updated | fulfilled | cancelled |
  -- refunded | return_created | resend_created | cost_added | note_added |
  -- document_added | status_changed
  event_type  text NOT NULL,
  description text,
  actor       text,
  metadata    jsonb
);
CREATE INDEX IF NOT EXISTS idx_soe_sales_order_id ON sales_order_events(sales_order_id);
CREATE INDEX IF NOT EXISTS idx_soe_event_type     ON sales_order_events(event_type);
CREATE INDEX IF NOT EXISTS idx_soe_created_date    ON sales_order_events(created_date);

DROP TRIGGER IF EXISTS trg_soe_updated_date ON sales_order_events;
CREATE TRIGGER trg_soe_updated_date
  BEFORE UPDATE ON sales_order_events FOR EACH ROW EXECUTE FUNCTION set_updated_date();

-- 3. Documents / external references ----------------------------------------
CREATE TABLE IF NOT EXISTS sales_order_documents (
  id            text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  created_date  timestamptz NOT NULL DEFAULT now(),
  updated_date  timestamptz NOT NULL DEFAULT now(),
  created_by    text,

  sales_order_id   text NOT NULL,
  shopify_order_id text,
  order_number     text,

  -- shopify_ref | payment_ref | fulfilment_ref | courier_ref | return_ref |
  -- resend_ref | refund_ref | attachment | other
  doc_type   text NOT NULL DEFAULT 'other',
  label      text NOT NULL,
  url        text,
  reference  text,
  notes      text
);
CREATE INDEX IF NOT EXISTS idx_sod_sales_order_id ON sales_order_documents(sales_order_id);

DROP TRIGGER IF EXISTS trg_sod_updated_date ON sales_order_documents;
CREATE TRIGGER trg_sod_updated_date
  BEFORE UPDATE ON sales_order_documents FOR EACH ROW EXECUTE FUNCTION set_updated_date();

-- RLS off (matches existing sales tables — see 041 / 022).
ALTER TABLE sales_order_notes     DISABLE ROW LEVEL SECURITY;
ALTER TABLE sales_order_events    DISABLE ROW LEVEL SECURITY;
ALTER TABLE sales_order_documents DISABLE ROW LEVEL SECURITY;

-- ============================================================================
-- 047_sales_order_rpcs
-- RPCs for manual sales orders + shared cancel/fulfil lifecycle.
--
-- Manual orders reuse the SAME tables, profitability RPC and stock-deduction
-- RPC as Shopify orders. Internal numbering reuses next_doc_number('SO') from
-- migration 002. Fulfilment reuses deduct_fulfilled_stock (033) so manual and
-- Shopify stock movements are identical and idempotent.
-- ============================================================================

-- 1. create_manual_sales_order ----------------------------------------------
-- p_payload shape:
-- {
--   order_source, customer_name, customer_email, customer_phone,
--   customer_external_id, customer_address, billing_address,
--   shipping_city, shipping_province, shipping_zip, shipping_country,
--   order_date, currency, notes, shipping_cost,
--   payment_status, payment_method, payment_reference, payment_date, amount_paid,
--   lines: [{ sku, name, variant_title, qty, unit_price, our_product_id,
--             is_package_parent, line_type }],
--   financial_lines: [{ category, label, amount, sign, tax_amount }]
-- }
CREATE OR REPLACE FUNCTION create_manual_sales_order(p_payload jsonb)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_id        text := gen_random_uuid()::text;
  v_number    text;
  v_source    text := COALESCE(p_payload->>'order_source', 'manual');
  v_pay       text := COALESCE(p_payload->>'payment_status', 'pending');
  v_lifecycle text;
  v_currency  text := COALESCE(p_payload->>'currency', 'ZAR');
  v_ship      numeric := COALESCE((p_payload->>'shipping_cost')::numeric, 0);
  v_actor     text := COALESCE(p_payload->>'created_by', 'manual');
  v_subtotal  numeric := 0;
  v_fin_total numeric := 0;
  v_tax       numeric := 0;
  v_discounts numeric := 0;
  v_total     numeric := 0;
  v_line      jsonb;
  v_lqty      numeric;
  v_lprice    numeric;
  v_ltotal    numeric;
BEGIN
  IF v_source = 'shopify' THEN
    RAISE EXCEPTION 'create_manual_sales_order cannot be used for shopify orders';
  END IF;

  v_number := next_doc_number('SO');

  -- payment_status 'paid' => ready to fulfil; otherwise awaiting payment.
  v_lifecycle := CASE WHEN v_pay = 'paid' THEN 'paid_unfulfilled' ELSE 'pending_payment' END;

  -- Sum inventory line subtotal.
  FOR v_line IN SELECT * FROM jsonb_array_elements(COALESCE(p_payload->'lines','[]'::jsonb)) LOOP
    v_lqty   := COALESCE((v_line->>'qty')::numeric, 0);
    v_lprice := COALESCE((v_line->>'unit_price')::numeric, 0);
    v_subtotal := v_subtotal + (v_lqty * v_lprice);
  END LOOP;

  -- Sum non-inventory financial lines (sign +1 charge, -1 reduces revenue).
  FOR v_line IN SELECT * FROM jsonb_array_elements(COALESCE(p_payload->'financial_lines','[]'::jsonb)) LOOP
    v_fin_total := v_fin_total
      + (COALESCE((v_line->>'amount')::numeric,0) * COALESCE((v_line->>'sign')::numeric,1));
    v_tax := v_tax + COALESCE((v_line->>'tax_amount')::numeric,0);
    IF COALESCE(v_line->>'category','') = 'discount' THEN
      v_discounts := v_discounts + COALESCE((v_line->>'amount')::numeric,0);
    END IF;
  END LOOP;

  v_total := v_subtotal + v_ship + v_fin_total;

  INSERT INTO sales_orders (
    id, created_by, shopify_order_id, external_id, order_number, internal_order_number,
    order_source, source_platform,
    customer_name, customer_email, customer_phone, customer_external_id,
    customer_address, billing_address,
    shipping_city, shipping_province, shipping_zip, shipping_country,
    lifecycle_state, status, payment_status, fulfillment_status,
    order_date, total_amount, subtotal_price, total_tax, total_discounts, currency,
    shipping_cost, amount_paid, payment_method, payment_reference, payment_date,
    notes, decomposition_status
  ) VALUES (
    v_id, v_actor, NULL, 'manual:'||v_id, v_number, v_number,
    v_source, 'manual',
    p_payload->>'customer_name', p_payload->>'customer_email', p_payload->>'customer_phone',
    p_payload->>'customer_external_id', p_payload->>'customer_address', p_payload->>'billing_address',
    p_payload->>'shipping_city', p_payload->>'shipping_province', p_payload->>'shipping_zip',
    p_payload->>'shipping_country',
    v_lifecycle, 'pending', v_pay, 'unfulfilled',
    COALESCE((p_payload->>'order_date')::timestamptz, now()),
    v_total, v_subtotal, v_tax, v_discounts, v_currency,
    v_ship,
    COALESCE((p_payload->>'amount_paid')::numeric, CASE WHEN v_pay='paid' THEN v_total ELSE 0 END),
    p_payload->>'payment_method', p_payload->>'payment_reference',
    (p_payload->>'payment_date')::timestamptz,
    p_payload->>'notes', 'complete'
  );

  -- Inventory product lines.
  FOR v_line IN SELECT * FROM jsonb_array_elements(COALESCE(p_payload->'lines','[]'::jsonb)) LOOP
    v_lqty   := COALESCE((v_line->>'qty')::numeric, 0);
    v_lprice := COALESCE((v_line->>'unit_price')::numeric, 0);
    v_ltotal := v_lqty * v_lprice;
    INSERT INTO sales_order_lines (
      id, created_by, sales_order_id, sku, name, variant_title, qty, unit_price,
      line_total, our_product_id, is_package_parent, line_type, status, source_platform
    ) VALUES (
      gen_random_uuid()::text, v_actor, v_id,
      v_line->>'sku', v_line->>'name', v_line->>'variant_title',
      v_lqty, v_lprice, v_ltotal, v_line->>'our_product_id',
      COALESCE((v_line->>'is_package_parent')::boolean, false),
      COALESCE(v_line->>'line_type', 'standalone'),
      'active', 'manual'
    );
  END LOOP;

  -- Non-inventory financial lines.
  FOR v_line IN SELECT * FROM jsonb_array_elements(COALESCE(p_payload->'financial_lines','[]'::jsonb)) LOOP
    INSERT INTO sales_order_financial_lines (
      id, created_by, sales_order_id, order_number, category, label, amount, sign,
      tax_amount, source
    ) VALUES (
      gen_random_uuid()::text, v_actor, v_id, v_number,
      v_line->>'category', COALESCE(v_line->>'label', v_line->>'category'),
      COALESCE((v_line->>'amount')::numeric,0),
      COALESCE((v_line->>'sign')::smallint,1),
      COALESCE((v_line->>'tax_amount')::numeric,0),
      'manual'
    );
  END LOOP;

  INSERT INTO sales_order_events (sales_order_id, order_number, event_type, description, actor, metadata)
  VALUES (v_id, v_number, 'created',
          'Manual order created ('||v_source||')', v_actor,
          jsonb_build_object('order_source', v_source, 'total', v_total));

  RETURN json_build_object('id', v_id, 'order_number', v_number, 'internal_order_number', v_number);
END;
$$;

-- 2. update_manual_sales_order ----------------------------------------------
-- Edits header + replaces lines while the order is still editable (manual,
-- not fulfilled, not cancelled, stock not deducted). Same payload shape as
-- create (lines / financial_lines optional — when present they replace).
CREATE OR REPLACE FUNCTION update_manual_sales_order(p_order_id text, p_payload jsonb)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_ord       sales_orders%ROWTYPE;
  v_actor     text := COALESCE(p_payload->>'created_by', 'manual');
  v_subtotal  numeric := 0;
  v_fin_total numeric := 0;
  v_tax       numeric := 0;
  v_discounts numeric := 0;
  v_ship      numeric;
  v_total     numeric;
  v_line      jsonb;
  v_lqty      numeric;
  v_lprice    numeric;
BEGIN
  SELECT * INTO v_ord FROM sales_orders WHERE id = p_order_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Order % not found', p_order_id; END IF;
  IF v_ord.order_source = 'shopify' THEN
    RAISE EXCEPTION 'Shopify orders cannot be edited here';
  END IF;
  IF COALESCE(v_ord.stock_deducted, false) OR v_ord.lifecycle_state IN ('fulfilled','cancelled') THEN
    RAISE EXCEPTION 'Order % is no longer editable (%).', p_order_id, v_ord.lifecycle_state;
  END IF;

  v_ship := COALESCE((p_payload->>'shipping_cost')::numeric, v_ord.shipping_cost, 0);

  -- Header fields (only overwrite when key present).
  UPDATE sales_orders SET
    customer_name      = COALESCE(p_payload->>'customer_name', customer_name),
    customer_email     = COALESCE(p_payload->>'customer_email', customer_email),
    customer_phone     = COALESCE(p_payload->>'customer_phone', customer_phone),
    customer_address   = COALESCE(p_payload->>'customer_address', customer_address),
    billing_address    = COALESCE(p_payload->>'billing_address', billing_address),
    shipping_city      = COALESCE(p_payload->>'shipping_city', shipping_city),
    shipping_province  = COALESCE(p_payload->>'shipping_province', shipping_province),
    shipping_zip       = COALESCE(p_payload->>'shipping_zip', shipping_zip),
    shipping_country   = COALESCE(p_payload->>'shipping_country', shipping_country),
    payment_status     = COALESCE(p_payload->>'payment_status', payment_status),
    payment_method     = COALESCE(p_payload->>'payment_method', payment_method),
    payment_reference  = COALESCE(p_payload->>'payment_reference', payment_reference),
    notes              = COALESCE(p_payload->>'notes', notes),
    shipping_cost      = v_ship
  WHERE id = p_order_id;

  -- Replace lines when provided.
  IF p_payload ? 'lines' THEN
    DELETE FROM sales_order_lines WHERE sales_order_id = p_order_id AND source_platform = 'manual';
    FOR v_line IN SELECT * FROM jsonb_array_elements(p_payload->'lines') LOOP
      v_lqty   := COALESCE((v_line->>'qty')::numeric, 0);
      v_lprice := COALESCE((v_line->>'unit_price')::numeric, 0);
      v_subtotal := v_subtotal + (v_lqty * v_lprice);
      INSERT INTO sales_order_lines (
        id, created_by, sales_order_id, sku, name, variant_title, qty, unit_price,
        line_total, our_product_id, is_package_parent, line_type, status, source_platform
      ) VALUES (
        gen_random_uuid()::text, v_actor, p_order_id,
        v_line->>'sku', v_line->>'name', v_line->>'variant_title',
        v_lqty, v_lprice, v_lqty*v_lprice, v_line->>'our_product_id',
        COALESCE((v_line->>'is_package_parent')::boolean, false),
        COALESCE(v_line->>'line_type', 'standalone'), 'active', 'manual'
      );
    END LOOP;
  ELSE
    SELECT COALESCE(SUM(line_total),0) INTO v_subtotal
    FROM sales_order_lines WHERE sales_order_id = p_order_id AND status = 'active';
  END IF;

  -- Replace manual financial lines when provided.
  IF p_payload ? 'financial_lines' THEN
    DELETE FROM sales_order_financial_lines WHERE sales_order_id = p_order_id AND source = 'manual';
    FOR v_line IN SELECT * FROM jsonb_array_elements(p_payload->'financial_lines') LOOP
      v_fin_total := v_fin_total
        + (COALESCE((v_line->>'amount')::numeric,0) * COALESCE((v_line->>'sign')::numeric,1));
      v_tax := v_tax + COALESCE((v_line->>'tax_amount')::numeric,0);
      IF COALESCE(v_line->>'category','') = 'discount' THEN
        v_discounts := v_discounts + COALESCE((v_line->>'amount')::numeric,0);
      END IF;
      INSERT INTO sales_order_financial_lines (
        id, created_by, sales_order_id, order_number, category, label, amount, sign, tax_amount, source
      ) VALUES (
        gen_random_uuid()::text, v_actor, p_order_id, v_ord.order_number,
        v_line->>'category', COALESCE(v_line->>'label', v_line->>'category'),
        COALESCE((v_line->>'amount')::numeric,0),
        COALESCE((v_line->>'sign')::smallint,1),
        COALESCE((v_line->>'tax_amount')::numeric,0), 'manual'
      );
    END LOOP;
  ELSE
    SELECT COALESCE(SUM(amount*sign),0),
           COALESCE(SUM(tax_amount),0),
           COALESCE(SUM(amount) FILTER (WHERE category = 'discount'),0)
      INTO v_fin_total, v_tax, v_discounts
    FROM sales_order_financial_lines WHERE sales_order_id = p_order_id;
  END IF;

  v_total := v_subtotal + v_ship + v_fin_total;
  -- Recompute totals; advance lifecycle when payment just became 'paid'.
  UPDATE sales_orders
     SET subtotal_price = v_subtotal,
         total_discounts = v_discounts,
         total_tax = v_tax,
         total_amount = v_total,
         lifecycle_state = CASE
           WHEN lifecycle_state = 'pending_payment' AND payment_status = 'paid'
           THEN 'paid_unfulfilled' ELSE lifecycle_state END
   WHERE id = p_order_id;

  INSERT INTO sales_order_events (sales_order_id, order_number, event_type, description, actor, metadata)
  VALUES (p_order_id, v_ord.order_number, 'edited', 'Manual order edited', v_actor,
          jsonb_build_object('total', v_total));

  RETURN json_build_object('id', p_order_id, 'total_amount', v_total);
END;
$$;

-- 3. cancel_sales_order ------------------------------------------------------
-- Cancels an UNFULFILLED order (Shopify or manual). Refuses if stock was
-- already deducted — those must go through the returns flow instead.
CREATE OR REPLACE FUNCTION cancel_sales_order(p_order_id text, p_reason text, p_user text)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_ord sales_orders%ROWTYPE;
BEGIN
  SELECT * INTO v_ord FROM sales_orders WHERE id = p_order_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Order % not found', p_order_id; END IF;
  IF COALESCE(v_ord.stock_deducted, false) OR v_ord.lifecycle_state = 'fulfilled' THEN
    RAISE EXCEPTION 'Order % already fulfilled — use the returns flow.', p_order_id;
  END IF;

  UPDATE sales_orders
     SET lifecycle_state = 'cancelled',
         status = 'cancelled',
         cancelled_at = now(),
         cancelled_reason = p_reason,
         cancelled_by = p_user
   WHERE id = p_order_id;

  INSERT INTO sales_order_events (sales_order_id, shopify_order_id, order_number, event_type, description, actor, metadata)
  VALUES (p_order_id, v_ord.shopify_order_id, v_ord.order_number, 'cancelled',
          COALESCE('Cancelled: '||p_reason, 'Cancelled'), p_user,
          jsonb_build_object('reason', p_reason));

  RETURN json_build_object('id', p_order_id, 'lifecycle_state', 'cancelled');
END;
$$;

-- 4. fulfill_manual_order ----------------------------------------------------
-- Marks a manual order fulfilled, records fulfilment metadata, then reuses the
-- shared deduct_fulfilled_stock RPC (auto-picks primary location, idempotent).
CREATE OR REPLACE FUNCTION fulfill_manual_order(
  p_order_id text,
  p_user text,
  p_courier text DEFAULT NULL,
  p_tracking_number text DEFAULT NULL,
  p_tracking_url text DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_ord    sales_orders%ROWTYPE;
  v_deduct json;
BEGIN
  SELECT * INTO v_ord FROM sales_orders WHERE id = p_order_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Order % not found', p_order_id; END IF;
  IF v_ord.order_source = 'shopify' THEN
    RAISE EXCEPTION 'Shopify orders fulfil via Shopify sync, not here';
  END IF;
  IF v_ord.lifecycle_state = 'cancelled' THEN
    RAISE EXCEPTION 'Cancelled order cannot be fulfilled';
  END IF;

  UPDATE sales_orders
     SET lifecycle_state = 'fulfilled',
         fulfillment_status = 'fulfilled',
         status = 'shipped',
         shipped_at = now(),
         courier = COALESCE(p_courier, courier),
         tracking_number = COALESCE(p_tracking_number, tracking_number),
         tracking_url = COALESCE(p_tracking_url, tracking_url)
   WHERE id = p_order_id;

  -- Shared, idempotent stock deduction (033).
  v_deduct := deduct_fulfilled_stock(p_order_id);

  INSERT INTO sales_order_events (sales_order_id, order_number, event_type, description, actor, metadata)
  VALUES (p_order_id, v_ord.order_number, 'fulfilled', 'Manual order fulfilled', p_user,
          jsonb_build_object('courier', p_courier, 'tracking_number', p_tracking_number));

  RETURN json_build_object('id', p_order_id, 'lifecycle_state', 'fulfilled', 'deduction', v_deduct);
END;
$$;

GRANT EXECUTE ON FUNCTION create_manual_sales_order(jsonb)               TO service_role, authenticated;
GRANT EXECUTE ON FUNCTION update_manual_sales_order(text, jsonb)         TO service_role, authenticated;
GRANT EXECUTE ON FUNCTION cancel_sales_order(text, text, text)           TO service_role, authenticated;
GRANT EXECUTE ON FUNCTION fulfill_manual_order(text, text, text, text, text) TO service_role, authenticated;
