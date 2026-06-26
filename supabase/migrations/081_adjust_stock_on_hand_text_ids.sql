-- ============================================================================
-- 081_adjust_stock_on_hand_text_ids
-- FIX: manual "Adjust Stock" failed for legacy products with non-UUID ids.
--
-- adjust_stock_on_hand() declared its id params as `uuid`, but every id column
-- in this system is `text` (products.id, stock_on_hand.product_id /
-- location_id are all text — many legacy Base44 rows use 24-char hex ObjectIds
-- like "69ea6f6c6f57e3ad408e301c" that are NOT valid UUIDs). Calling the RPC
-- for such a product raised:
--   invalid input syntax for type uuid: "69ea6f6c6f57e3ad408e301c"
-- UUID-format products happened to work; legacy ones never could.
--
-- This re-creates the function with `text` id params. The body is otherwise
-- unchanged (same weighted-average cost_avg logic, same RETURNS stock_on_hand),
-- so GRN / picks / transfers / stock-take / write-offs / returns keep behaving
-- exactly as before — they just no longer depend on ids being UUIDs.
--
-- ⚠️  Run in the Supabase SQL Editor before/with the deploy.
-- ============================================================================

-- Drop the old uuid-typed signature so PostgREST can't pick the wrong overload.
DROP FUNCTION IF EXISTS adjust_stock_on_hand(uuid, uuid, numeric, numeric);

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
      gen_random_uuid()::text, p_product_id, p_location_id,
      GREATEST(0, p_delta), 0, GREATEST(0, p_delta),
      p_new_cost_avg, now(), now()
    )
    RETURNING * INTO v_row;
  END IF;

  RETURN v_row;
END;
$$;

GRANT EXECUTE ON FUNCTION adjust_stock_on_hand(text, text, numeric, numeric) TO service_role;
GRANT EXECUTE ON FUNCTION adjust_stock_on_hand(text, text, numeric, numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION adjust_stock_on_hand(text, text, numeric, numeric) TO anon;
