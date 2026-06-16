-- ============================================================================
-- 050_returns_workflow_v2
-- Operations layer on top of the existing Customer Returns (037) + Re-sends
-- (038) modules. Adds:
--   * manager-exception fields + courier-booked receipt gate on returns
--   * richer per-line QC outcomes (qc_outcome)
--   * a generic per-record audit/timeline table (sales_workflow_events)
--   * manager-approval flag + exception fields on re-sends
--   * resolve_return_exception() RPC (manager approve/reject)
--   * receive_shopify_return() rebuilt: courier gate + qc_outcome mapping +
--     auto-flag exceptions for risky outcomes
--   * approve_resend() rebuilt: refuses while a manager approval is required
--
-- All additive / idempotent. Strict stock rules from 037/038 are PRESERVED:
-- nothing moves stock except a QC-approved 'return_to_stock' receipt and a
-- re-send approval. This migration adds gates + traceability, not new movements.
-- ============================================================================

-- 1. shopify_returns: exception + override + refund-completion + created_via ---
ALTER TABLE shopify_returns
  ADD COLUMN IF NOT EXISTS created_via            text NOT NULL DEFAULT 'shopify',
  ADD COLUMN IF NOT EXISTS exception_status       text NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS exception_reason       text,
  ADD COLUMN IF NOT EXISTS exception_resolved_by  text,
  ADD COLUMN IF NOT EXISTS exception_resolved_at  timestamptz,
  ADD COLUMN IF NOT EXISTS exception_notes        text,
  ADD COLUMN IF NOT EXISTS receive_override_by     text,
  ADD COLUMN IF NOT EXISTS receive_override_at     timestamptz,
  ADD COLUMN IF NOT EXISTS receive_override_reason text,
  ADD COLUMN IF NOT EXISTS refund_completed_at     timestamptz,
  ADD COLUMN IF NOT EXISTS refund_completed_by     text;

-- Widen courier_status to allow 'collected' (self-correcting rebuild, like 037 §3).
ALTER TABLE shopify_returns DROP CONSTRAINT IF EXISTS shopify_returns_courier_status_check;
DO $$
DECLARE v_list text;
BEGIN
  SELECT string_agg(quote_literal(v), ',') INTO v_list FROM (
    SELECT unnest(ARRAY['to_be_booked','booked','in_transit','collected']) AS v
    UNION
    SELECT DISTINCT courier_status FROM shopify_returns WHERE courier_status IS NOT NULL
  ) s;
  EXECUTE format(
    'ALTER TABLE shopify_returns ADD CONSTRAINT shopify_returns_courier_status_check CHECK (courier_status IS NULL OR courier_status IN (%s))',
    v_list
  );
END $$;

-- 2. shopify_return_lines: richer QC outcome ---------------------------------
ALTER TABLE shopify_return_lines
  ADD COLUMN IF NOT EXISTS qc_outcome text;
-- Values (app-constrained, kept CHECK-free for flexibility):
--   return_to_stock | write_off | damaged | opened | expired |
--   incorrect_item | needs_manager_review | other

-- 3. sales_workflow_events: generic per-record audit timeline ----------------
CREATE TABLE IF NOT EXISTS sales_workflow_events (
  id           text PRIMARY KEY,
  created_date timestamptz NOT NULL DEFAULT now(),
  actor        text,
  entity_type  text NOT NULL,           -- 'shopify_return' | 'sales_resend'
  entity_id    text NOT NULL,
  event_type   text NOT NULL,           -- created | courier_booked | received | qc | exception | refund | resend | status
  description  text,
  meta         jsonb
);
CREATE INDEX IF NOT EXISTS idx_sales_workflow_events_entity
  ON sales_workflow_events(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_sales_workflow_events_created
  ON sales_workflow_events(created_date);
ALTER TABLE sales_workflow_events DISABLE ROW LEVEL SECURITY;

-- 4. sales_resends: manager approval + exception fields ----------------------
ALTER TABLE sales_resends
  ADD COLUMN IF NOT EXISTS manager_approval_required boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS exception_status      text NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS exception_reason      text,
  ADD COLUMN IF NOT EXISTS exception_resolved_by text,
  ADD COLUMN IF NOT EXISTS exception_resolved_at timestamptz,
  ADD COLUMN IF NOT EXISTS exception_notes       text;
-- linked_return_id already exists (038).

-- 5. receive_shopify_return: courier gate + qc_outcome mapping + exceptions ---
-- Drop the old 4-arg signature so the new defaulted 6-arg form is unambiguous.
DROP FUNCTION IF EXISTS receive_shopify_return(text, jsonb, text, text);

CREATE OR REPLACE FUNCTION receive_shopify_return(
  p_return_id      text,
  p_lines          jsonb,
  p_location_id    text,
  p_user           text    DEFAULT NULL,
  p_override       boolean DEFAULT false,
  p_override_reason text   DEFAULT NULL
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
  v_outcome       text;
  v_decision      text;
  v_rows_written  int := 0;
  v_now           timestamptz := now();
  v_sum_returned  numeric;
  v_sum_received  numeric;
  v_sum_to_stock  numeric;
  v_sum_written   numeric;
  v_sum_quar      numeric;
  v_new_status    text;
  v_loc_name      text;
  v_has_exception boolean := false;
BEGIN
  SELECT * INTO v_ret FROM shopify_returns WHERE id = p_return_id;
  IF v_ret.id IS NULL THEN
    RETURN json_build_object('status','error','error','return not found');
  END IF;

  -- Courier-booked gate: a 'we book' return can't be received before the
  -- courier is confirmed booked, unless an authorised override is supplied.
  IF v_ret.courier_responsibility = 'us'
     AND COALESCE(v_ret.courier_status,'to_be_booked') NOT IN ('booked','in_transit','collected')
     AND NOT p_override THEN
    RETURN json_build_object('status','error','error','courier_not_booked');
  END IF;

  FOR elem IN SELECT * FROM jsonb_array_elements(COALESCE(p_lines, '[]'::jsonb))
  LOOP
    SELECT * INTO v_line FROM shopify_return_lines
     WHERE id = (elem ->> 'line_id') AND return_id = p_return_id;
    IF v_line.id IS NULL THEN CONTINUE; END IF;

    v_loc      := COALESCE(elem ->> 'restock_location_id', p_location_id);
    v_to_stock := COALESCE((elem ->> 'qty_to_stock')::numeric, 0);
    v_outcome  := elem ->> 'qc_outcome';

    -- Derive the coarse stock_decision from qc_outcome when present, else use
    -- the explicit stock_decision (back-compat). Only return_to_stock restocks.
    v_decision := CASE
      WHEN v_outcome = 'return_to_stock' THEN 'return_to_stock'
      WHEN v_outcome IN ('needs_manager_review','other') THEN 'quarantine'
      WHEN v_outcome IS NOT NULL THEN 'write_off'        -- write_off/damaged/opened/expired/incorrect_item
      ELSE COALESCE(elem ->> 'stock_decision', v_line.stock_decision)
    END;

    -- Risky outcomes/conditions trigger a manager exception.
    IF v_outcome IN ('damaged','opened','expired','needs_manager_review')
       OR COALESCE(elem ->> 'condition', '') IN ('damaged','defective','expired','contaminated') THEN
      v_has_exception := true;
    END IF;

    UPDATE shopify_return_lines SET
      qty_received    = COALESCE((elem ->> 'qty_received')::numeric, qty_received),
      qty_to_stock    = CASE WHEN v_decision = 'return_to_stock' THEN v_to_stock ELSE 0 END,
      qty_written_off = COALESCE((elem ->> 'qty_written_off')::numeric, 0),
      qty_quarantine  = COALESCE((elem ->> 'qty_quarantine')::numeric, 0),
      write_off_value = COALESCE((elem ->> 'write_off_value')::numeric, 0),
      condition       = COALESCE(elem ->> 'condition', condition),
      qc_status       = COALESCE(elem ->> 'qc_status', qc_status),
      qc_outcome      = COALESCE(v_outcome, qc_outcome),
      qc_notes        = COALESCE(elem ->> 'qc_notes', qc_notes),
      stock_decision  = COALESCE(v_decision, stock_decision),
      restock_location_id = v_loc,
      received_at     = v_now,
      received_by     = p_user
    WHERE id = v_line.id;

    -- Only an approved return_to_stock increases inventory.
    IF v_decision = 'return_to_stock' AND v_to_stock > 0 AND v_line.product_id IS NOT NULL AND v_loc IS NOT NULL THEN
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
    -- Flag a manager exception when risky outcomes were recorded (only escalate
    -- from 'none' so a prior approval/rejection isn't clobbered).
    exception_status      = CASE WHEN v_has_exception AND exception_status = 'none' THEN 'pending' ELSE exception_status END,
    exception_reason      = CASE WHEN v_has_exception AND exception_status = 'none' THEN 'qc_risky_outcome' ELSE exception_reason END,
    receive_override_by     = CASE WHEN p_override THEN COALESCE(p_user, receive_override_by) ELSE receive_override_by END,
    receive_override_at     = CASE WHEN p_override THEN v_now ELSE receive_override_at END,
    receive_override_reason = CASE WHEN p_override THEN COALESCE(p_override_reason, receive_override_reason) ELSE receive_override_reason END,
    completed_at          = CASE WHEN v_sum_quar = 0 AND v_sum_received >= v_sum_returned AND NOT v_has_exception THEN v_now ELSE completed_at END
  WHERE id = p_return_id;

  -- Audit trail.
  INSERT INTO sales_workflow_events (id, actor, entity_type, entity_id, event_type, description, meta)
  VALUES (
    gen_random_uuid()::text, p_user, 'shopify_return', p_return_id,
    CASE WHEN v_has_exception THEN 'exception' ELSE 'received' END,
    'Received return → ' || v_new_status || CASE WHEN v_has_exception THEN ' (manager review required)' ELSE '' END
      || CASE WHEN p_override THEN ' [courier gate overridden]' ELSE '' END,
    json_build_object('rows_written', v_rows_written, 'status', v_new_status, 'override', p_override)
  );

  RETURN json_build_object(
    'status',        'completed',
    'return_status', v_new_status,
    'rows_written',  v_rows_written,
    'exception',     v_has_exception
  );
END;
$$;

GRANT EXECUTE ON FUNCTION receive_shopify_return(text, jsonb, text, text, boolean, text) TO service_role, authenticated;

-- 6. resolve_return_exception: manager approve / reject ----------------------
CREATE OR REPLACE FUNCTION resolve_return_exception(
  p_return_id text,
  p_decision  text,            -- 'approve' | 'reject'
  p_user      text DEFAULT NULL,
  p_notes     text DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE v_ret shopify_returns%ROWTYPE; v_new text;
BEGIN
  SELECT * INTO v_ret FROM shopify_returns WHERE id = p_return_id;
  IF v_ret.id IS NULL THEN RETURN json_build_object('status','error','error','return not found'); END IF;
  IF p_decision NOT IN ('approve','reject') THEN
    RETURN json_build_object('status','error','error','invalid decision');
  END IF;

  v_new := CASE WHEN p_decision = 'approve' THEN 'approved' ELSE 'rejected' END;

  UPDATE shopify_returns SET
    exception_status      = v_new,
    exception_resolved_by = p_user,
    exception_resolved_at = now(),
    exception_notes       = COALESCE(p_notes, exception_notes)
  WHERE id = p_return_id;

  INSERT INTO sales_workflow_events (id, actor, entity_type, entity_id, event_type, description, meta)
  VALUES (gen_random_uuid()::text, p_user, 'shopify_return', p_return_id, 'exception',
          'Manager ' || v_new || ' the exception' || COALESCE(' — ' || p_notes, ''),
          json_build_object('decision', p_decision));

  RETURN json_build_object('status','ok','exception_status', v_new);
END;
$$;
GRANT EXECUTE ON FUNCTION resolve_return_exception(text, text, text, text) TO service_role, authenticated;

-- 7. approve_resend: refuse while a manager approval is still required --------
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

  -- Manager-approval gate: a flagged re-send must have its exception approved first.
  IF v_rs.manager_approval_required AND COALESCE(v_rs.exception_status,'none') <> 'approved' THEN
    RETURN json_build_object('status','error','error','manager_approval_required');
  END IF;

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

  INSERT INTO sales_workflow_events (id, actor, entity_type, entity_id, event_type, description, meta)
  VALUES (gen_random_uuid()::text, p_user, 'sales_resend', p_resend_id, 'resend',
          'Re-send approved — stock deducted', json_build_object('rows_written', v_rows));

  RETURN json_build_object('status','approved','rows_written',v_rows,'missing_skus',v_missing_skus,'missing_boms',v_missing_boms);
END;
$$;
GRANT EXECUTE ON FUNCTION approve_resend(text, text, text) TO service_role, authenticated;

-- 8. Backfill: existing returns/re-sends default cleanly (created_via, exception
--    none) via column defaults above — no data backfill required.
