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
