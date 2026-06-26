-- Atomic stock-on-hand adjustment.
-- Replaces all client-side read-modify-write SOH mutations.
-- Positive delta = add stock (GRN, production output, manual adjustment)
-- Negative delta = remove stock (pick, write-off, return)
--
-- NOTE: id params are text — products.id / stock_on_hand.product_id /
-- location_id are all text columns (legacy Base44 rows use non-UUID hex ids).
-- stock_on_hand carries NO cost column (cost lives on products / cost_layers),
-- so p_new_cost_avg is accepted for caller compatibility but ignored.
-- See migration 081_adjust_stock_on_hand_text_ids.sql.
CREATE OR REPLACE FUNCTION adjust_stock_on_hand(
  p_product_id  text,
  p_location_id text,
  p_delta       numeric,
  p_new_cost_avg numeric DEFAULT NULL
)
RETURNS stock_on_hand
LANGUAGE plpgsql
AS $$
DECLARE
  v_row stock_on_hand;
BEGIN
  UPDATE stock_on_hand
  SET
    qty_on_hand   = GREATEST(0, qty_on_hand + p_delta),
    qty_available = GREATEST(0, (qty_on_hand + p_delta) - COALESCE(qty_committed, 0)),
    updated_date  = now()
  WHERE product_id = p_product_id
    AND location_id = p_location_id
  RETURNING * INTO v_row;

  IF NOT FOUND THEN
    INSERT INTO stock_on_hand (
      id, product_id, location_id,
      qty_on_hand, qty_committed, qty_available,
      created_date, updated_date
    ) VALUES (
      gen_random_uuid()::text, p_product_id, p_location_id,
      GREATEST(0, p_delta), 0, GREATEST(0, p_delta),
      now(), now()
    )
    RETURNING * INTO v_row;
  END IF;

  RETURN v_row;
END;
$$;

GRANT EXECUTE ON FUNCTION adjust_stock_on_hand(text, text, numeric, numeric) TO service_role;
GRANT EXECUTE ON FUNCTION adjust_stock_on_hand(text, text, numeric, numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION adjust_stock_on_hand(text, text, numeric, numeric) TO anon;
