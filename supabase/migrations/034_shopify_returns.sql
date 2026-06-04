-- ============================================================================
-- 034_shopify_returns
-- Customer Shopify Returns module.
--
-- Returns NEVER auto-restore stock. A Shopify refund/return imports as a
-- Draft Return (no stock movement). Stock only INCREASES when an item is
-- physically received, passes QC, and a user approves it back to sellable
-- stock via receive_shopify_return(). Write-offs are reporting-only (the goods
-- never entered stock, so nothing is deducted either).
-- ============================================================================

-- 1. Header table -----------------------------------------------------------
CREATE TABLE IF NOT EXISTS shopify_returns (
  id            text PRIMARY KEY,
  created_date  timestamptz NOT NULL DEFAULT now(),
  updated_date  timestamptz NOT NULL DEFAULT now(),
  created_by    text,

  return_number text NOT NULL,
  sales_order_id   text,
  shopify_order_id text,
  order_number     text,
  customer_name    text,
  customer_email   text,

  source           text NOT NULL DEFAULT 'refund' CHECK (source IN ('refund','return')),
  shopify_refund_id text,
  shopify_return_id text,
  shopify_reference text,
  dedupe_key        text NOT NULL,

  return_date    timestamptz,
  shopify_status text,
  shopify_reason text,

  status text NOT NULL DEFAULT 'draft_return' CHECK (status IN (
    'draft_return','not_receiving_stock_back','expected_return',
    'partially_received','received_pending_qc','returned_to_stock','written_off',
    'partially_returned_partially_written_off','completed')),

  stock_path text NOT NULL DEFAULT 'undecided' CHECK (stock_path IN (
    'undecided','not_receiving','expecting')),
  not_receiving_reason text CHECK (not_receiving_reason IS NULL OR not_receiving_reason IN (
    'not_returned','perishable','cannot_resell','refund_writeoff','damaged','other')),

  courier_responsibility text CHECK (courier_responsibility IS NULL OR courier_responsibility IN ('us','customer')),
  courier_status         text CHECK (courier_status IS NULL OR courier_status IN ('to_be_booked','booked','in_transit')),
  courier_company        text,
  courier_tracking_ref   text,
  courier_collection_date date,
  courier_booked_at      timestamptz,
  courier_booked_by      text,
  courier_notes          text,

  total_return_value     numeric NOT NULL DEFAULT 0,
  total_write_off_value  numeric NOT NULL DEFAULT 0,

  received_at   timestamptz,
  received_by   text,
  approved_at   timestamptz,
  approved_by   text,
  completed_at  timestamptz,
  notes         text
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_shopify_returns_dedupe_key ON shopify_returns(dedupe_key);
CREATE INDEX IF NOT EXISTS idx_shopify_returns_status          ON shopify_returns(status);
CREATE INDEX IF NOT EXISTS idx_shopify_returns_sales_order_id  ON shopify_returns(sales_order_id);
CREATE INDEX IF NOT EXISTS idx_shopify_returns_shopify_order   ON shopify_returns(shopify_order_id);
CREATE INDEX IF NOT EXISTS idx_shopify_returns_return_date     ON shopify_returns(return_date);
DROP TRIGGER IF EXISTS trg_shopify_returns_updated_date ON shopify_returns;
CREATE TRIGGER trg_shopify_returns_updated_date
  BEFORE UPDATE ON shopify_returns FOR EACH ROW EXECUTE FUNCTION set_updated_date();

-- 2. Line table -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS shopify_return_lines (
  id            text PRIMARY KEY,
  created_date  timestamptz NOT NULL DEFAULT now(),
  updated_date  timestamptz NOT NULL DEFAULT now(),
  created_by    text,

  return_id            text NOT NULL,
  sales_order_line_id  text,
  shopify_line_item_id text,
  shopify_variant_id   text,
  product_id           text,
  sku                  text,
  product_name         text,
  variant_title        text,

  qty_returned    numeric NOT NULL DEFAULT 0,
  qty_received    numeric NOT NULL DEFAULT 0,
  qty_to_stock    numeric NOT NULL DEFAULT 0,
  qty_written_off numeric NOT NULL DEFAULT 0,
  qty_quarantine  numeric NOT NULL DEFAULT 0,

  return_value     numeric NOT NULL DEFAULT 0,
  write_off_value  numeric NOT NULL DEFAULT 0,
  reason           text,

  condition text CHECK (condition IS NULL OR condition IN (
    'unopened','opened','damaged','defective','expired','contaminated')),
  qc_status text CHECK (qc_status IS NULL OR qc_status IN ('pending','pass','fail','review')),
  qc_notes  text,
  stock_decision text CHECK (stock_decision IS NULL OR stock_decision IN (
    'return_to_stock','write_off','quarantine')),
  restock_location_id text,

  received_at timestamptz,
  received_by text
);
CREATE INDEX IF NOT EXISTS idx_shopify_return_lines_return_id  ON shopify_return_lines(return_id);
CREATE INDEX IF NOT EXISTS idx_shopify_return_lines_product_id ON shopify_return_lines(product_id);
CREATE INDEX IF NOT EXISTS idx_shopify_return_lines_sku        ON shopify_return_lines(sku);
DROP TRIGGER IF EXISTS trg_shopify_return_lines_updated_date ON shopify_return_lines;
CREATE TRIGGER trg_shopify_return_lines_updated_date
  BEFORE UPDATE ON shopify_return_lines FOR EACH ROW EXECUTE FUNCTION set_updated_date();

-- 3. Allow 'shopify_return' as a stock_movements ref_type -------------------
ALTER TABLE stock_movements DROP CONSTRAINT IF EXISTS stock_movements_ref_type_check;
ALTER TABLE stock_movements ADD CONSTRAINT stock_movements_ref_type_check
  CHECK (ref_type IS NULL OR ref_type IN (
    'sales_order','purchase_order','production_run','wastage_log','stock_take',
    'transfer','grn','supplier_return','pick_list','manual','shopify_return'));

-- 4. App-level security (RLS disabled project-wide) -------------------------
ALTER TABLE shopify_returns      DISABLE ROW LEVEL SECURITY;
ALTER TABLE shopify_return_lines DISABLE ROW LEVEL SECURITY;

-- 5. Receipt engine ---------------------------------------------------------
-- Receives an expected return: persists per-line QC/decision, and ONLY for
-- lines decided 'return_to_stock' increases stock_on_hand (+qty_to_stock) at
-- the chosen location and writes a 'return' movement. Write-offs/quarantine
-- move no stock. Idempotent via stock_movements.reference_key.
--
-- p_lines: jsonb array of objects:
--   { line_id, qty_received, condition, qc_status, qc_notes, stock_decision,
--     qty_to_stock, qty_written_off, qty_quarantine, write_off_value,
--     restock_location_id (optional; else p_location_id) }
CREATE OR REPLACE FUNCTION receive_shopify_return(
  p_return_id   text,
  p_lines       jsonb,
  p_location_id text,
  p_user        text DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_ret           shopify_returns%ROWTYPE;
  elem            jsonb;
  v_line          shopify_return_lines%ROWTYPE;
  v_loc           text;
  v_to_stock      numeric;
  v_rows_written  int := 0;
  v_now           timestamptz := now();
  v_sum_returned  numeric;
  v_sum_received  numeric;
  v_sum_to_stock  numeric;
  v_sum_written   numeric;
  v_sum_quar      numeric;
  v_new_status    text;
  v_loc_name      text;
BEGIN
  SELECT * INTO v_ret FROM shopify_returns WHERE id = p_return_id;
  IF v_ret.id IS NULL THEN
    RETURN json_build_object('status','error','error','return not found');
  END IF;

  FOR elem IN SELECT * FROM jsonb_array_elements(COALESCE(p_lines, '[]'::jsonb))
  LOOP
    SELECT * INTO v_line FROM shopify_return_lines
     WHERE id = (elem ->> 'line_id') AND return_id = p_return_id;
    IF v_line.id IS NULL THEN CONTINUE; END IF;

    v_loc      := COALESCE(elem ->> 'restock_location_id', p_location_id);
    v_to_stock := COALESCE((elem ->> 'qty_to_stock')::numeric, 0);

    UPDATE shopify_return_lines SET
      qty_received    = COALESCE((elem ->> 'qty_received')::numeric, qty_received),
      qty_to_stock    = v_to_stock,
      qty_written_off = COALESCE((elem ->> 'qty_written_off')::numeric, 0),
      qty_quarantine  = COALESCE((elem ->> 'qty_quarantine')::numeric, 0),
      write_off_value = COALESCE((elem ->> 'write_off_value')::numeric, 0),
      condition       = COALESCE(elem ->> 'condition', condition),
      qc_status       = COALESCE(elem ->> 'qc_status', qc_status),
      qc_notes        = COALESCE(elem ->> 'qc_notes', qc_notes),
      stock_decision  = COALESCE(elem ->> 'stock_decision', stock_decision),
      restock_location_id = v_loc,
      received_at     = v_now,
      received_by     = p_user
    WHERE id = v_line.id;

    -- Only an approved return_to_stock increases inventory.
    IF (elem ->> 'stock_decision') = 'return_to_stock' AND v_to_stock > 0 AND v_line.product_id IS NOT NULL AND v_loc IS NOT NULL THEN
      INSERT INTO stock_movements (
        id, product_id, product_sku, product_name,
        to_location_id, qty, uom, reason, ref_type, ref_id, ref_number,
        reference_key, unit_cost_at_movement, notes, created_date, updated_date
      ) VALUES (
        gen_random_uuid()::text, v_line.product_id, v_line.sku, v_line.product_name,
        v_loc, v_to_stock, 'pcs', 'return', 'shopify_return', v_ret.id, v_ret.return_number,
        'shopify_return:' || v_ret.id || ':' || v_line.id || ':stock',
        0, 'Customer return to stock — ' || COALESCE(v_ret.order_number, v_ret.return_number),
        v_now, v_now
      )
      ON CONFLICT (reference_key) DO NOTHING;

      IF FOUND THEN
        -- Increase on-hand at the chosen location (insert row if absent).
        UPDATE stock_on_hand
           SET qty_on_hand   = qty_on_hand + v_to_stock,
               qty_available = GREATEST(0, (qty_on_hand + v_to_stock) - COALESCE(qty_committed, 0)),
               updated_date  = v_now
         WHERE product_id = v_line.product_id AND location_id = v_loc;
        IF NOT FOUND THEN
          SELECT name INTO v_loc_name FROM locations WHERE id = v_loc;
          INSERT INTO stock_on_hand (
            id, product_id, product_sku, product_name, location_id, location_name,
            qty_on_hand, qty_committed, qty_available, created_date, updated_date
          ) VALUES (
            gen_random_uuid()::text, v_line.product_id, v_line.sku, v_line.product_name, v_loc, v_loc_name,
            v_to_stock, 0, v_to_stock, v_now, v_now
          );
        END IF;
        v_rows_written := v_rows_written + 1;
      END IF;
    END IF;
  END LOOP;

  -- Roll up header status from line aggregates.
  SELECT COALESCE(SUM(qty_returned),0), COALESCE(SUM(qty_received),0),
         COALESCE(SUM(qty_to_stock),0), COALESCE(SUM(qty_written_off),0),
         COALESCE(SUM(qty_quarantine),0)
    INTO v_sum_returned, v_sum_received, v_sum_to_stock, v_sum_written, v_sum_quar
    FROM shopify_return_lines WHERE return_id = p_return_id;

  IF v_sum_received < v_sum_returned THEN
    v_new_status := 'partially_received';
  ELSIF v_sum_quar > 0 AND v_sum_to_stock = 0 AND v_sum_written = 0 THEN
    v_new_status := 'received_pending_qc';
  ELSIF v_sum_to_stock > 0 AND v_sum_written = 0 AND v_sum_quar = 0 THEN
    v_new_status := 'returned_to_stock';
  ELSIF v_sum_written > 0 AND v_sum_to_stock = 0 AND v_sum_quar = 0 THEN
    v_new_status := 'written_off';
  ELSIF v_sum_to_stock > 0 AND v_sum_written > 0 THEN
    v_new_status := 'partially_returned_partially_written_off';
  ELSE
    v_new_status := 'received_pending_qc';
  END IF;

  UPDATE shopify_returns SET
    status                = v_new_status,
    total_write_off_value = (SELECT COALESCE(SUM(write_off_value),0) FROM shopify_return_lines WHERE return_id = p_return_id),
    received_at           = COALESCE(received_at, v_now),
    received_by           = COALESCE(p_user, received_by),
    completed_at          = CASE WHEN v_sum_quar = 0 AND v_sum_received >= v_sum_returned THEN v_now ELSE completed_at END
  WHERE id = p_return_id;

  RETURN json_build_object(
    'status',       'completed',
    'return_status', v_new_status,
    'rows_written',  v_rows_written
  );
END;
$$;

GRANT EXECUTE ON FUNCTION receive_shopify_return(text, jsonb, text, text) TO service_role, authenticated;
