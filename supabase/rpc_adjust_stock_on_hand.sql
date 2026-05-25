-- Atomic stock-on-hand adjustment.
-- Replaces all client-side read-modify-write SOH mutations.
-- Positive delta = add stock (GRN, production output, manual adjustment)
-- Negative delta = remove stock (pick, write-off, return)
-- p_new_cost_avg: only supply when adding stock — used for weighted-average cost update.

CREATE OR REPLACE FUNCTION adjust_stock_on_hand(
  p_product_id  uuid,
  p_location_id uuid,
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
    cost_avg      = CASE
                      WHEN p_new_cost_avg IS NOT NULL AND p_delta > 0 AND (qty_on_hand + p_delta) > 0
                        THEN (qty_on_hand * COALESCE(cost_avg, 0) + p_delta * p_new_cost_avg)
                             / (qty_on_hand + p_delta)
                      ELSE cost_avg
                    END,
    updated_date  = now()
  WHERE product_id = p_product_id
    AND location_id = p_location_id
  RETURNING * INTO v_row;

  IF NOT FOUND THEN
    INSERT INTO stock_on_hand (
      id, product_id, location_id,
      qty_on_hand, qty_committed, qty_available,
      cost_avg, created_date, updated_date
    ) VALUES (
      gen_random_uuid(), p_product_id, p_location_id,
      GREATEST(0, p_delta), 0, GREATEST(0, p_delta),
      p_new_cost_avg, now(), now()
    )
    RETURNING * INTO v_row;
  END IF;

  RETURN v_row;
END;
$$;

GRANT EXECUTE ON FUNCTION adjust_stock_on_hand(uuid, uuid, numeric, numeric) TO service_role;
GRANT EXECUTE ON FUNCTION adjust_stock_on_hand(uuid, uuid, numeric, numeric) TO authenticated;
