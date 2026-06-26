-- ============================================================================
-- 081_adjust_stock_on_hand_text_ids
-- FIX: manual "Adjust Stock" failed for legacy products with non-UUID ids.
--
-- Two problems in adjust_stock_on_hand():
--   1. Its id params were declared `uuid`, but every id column here is `text`
--      (products.id, stock_on_hand.product_id / location_id). Legacy Base44
--      rows use 24-char hex ObjectIds like "69ea6f6c6f57e3ad408e301c" that are
--      NOT valid UUIDs, so the RPC raised:
--        invalid input syntax for type uuid: "69ea6f6c6f57e3ad408e301c"
--   2. It referenced a `cost_avg` column that does not exist on stock_on_hand
--      (stock_on_hand carries no cost column — cost lives on products /
--      cost_layers), raising:
--        column "cost_avg" does not exist
--
-- This recreates the function with `text` id params and no cost_avg reference.
-- The p_new_cost_avg argument is kept (callers such as GRN/Receiving still pass
-- it) but ignored, since stock_on_hand stores no cost. qty + availability are
-- updated exactly as the deduct_fulfilled_stock path does (033). All other
-- callers (GRN / picks / transfers / stock-take / write-offs / returns) keep
-- working — they only ever used the returned qty fields.
--
-- ⚠️  Run in the Supabase SQL Editor before/with the deploy.
-- ============================================================================

-- Drop the old uuid-typed signature so PostgREST can't pick the wrong overload.
DROP FUNCTION IF EXISTS adjust_stock_on_hand(uuid, uuid, numeric, numeric);

CREATE OR REPLACE FUNCTION adjust_stock_on_hand(
  p_product_id  text,
  p_location_id text,
  p_delta       numeric,
  p_new_cost_avg numeric DEFAULT NULL  -- accepted for caller compatibility; ignored (no cost column on stock_on_hand)
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
