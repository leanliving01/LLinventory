-- ============================================================================
-- 056_fix_movement_groups_pack_lines
--
-- Bug: order_lines in get_movement_groups included ALL non-component lines
-- (pack parents AND standalone items like Protein Water, Protein Porridge).
-- This caused "7 packs (7 types)" when the order only had 3 pack types plus
-- 4 standalone products.
--
-- Fix: filter order_lines to is_package_parent = true only. Standalone items
-- are not "packs" and should not count toward the pack summary display.
-- Orders that only have standalone lines (no pack parents) will return
-- order_lines = null and the UI falls back to showing movement_count.
-- ============================================================================

CREATE OR REPLACE FUNCTION get_movement_groups(
  p_limit      int         DEFAULT 25,
  p_offset     int         DEFAULT 0,
  p_reason     text        DEFAULT NULL,
  p_search     text        DEFAULT NULL,
  p_from_date  timestamptz DEFAULT NULL,
  p_to_date    timestamptz DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER AS $$
DECLARE
  v_total int;
  v_rows  jsonb;
BEGIN
  -- Total distinct groups (for pagination header)
  SELECT COUNT(*)::int INTO v_total
  FROM (
    SELECT 1
    FROM stock_movements sm
    WHERE
      (p_reason    IS NULL OR sm.reason       = p_reason)
      AND (p_from_date IS NULL OR sm.created_date >= p_from_date)
      AND (p_to_date   IS NULL OR sm.created_date <= p_to_date)
      AND (
        p_search IS NULL
        OR sm.ref_number   ILIKE '%' || p_search || '%'
        OR sm.product_sku  ILIKE '%' || p_search || '%'
        OR sm.product_name ILIKE '%' || p_search || '%'
      )
    GROUP BY sm.ref_type, sm.ref_id, sm.ref_number, sm.reason
  ) _cnt;

  -- Paginated groups, enriched with customer name + order lines
  SELECT jsonb_agg(row_to_json(r)::jsonb)
  INTO v_rows
  FROM (
    SELECT
      g.ref_type,
      g.ref_id,
      g.ref_number,
      g.reason,
      g.event_date,
      g.movement_count,
      g.total_qty,
      so.customer_name,
      -- Pack parent lines only (not standalone items like Protein Water)
      CASE
        WHEN g.reason IN ('sale_fulfillment', 'cancellation_reversal')
          AND g.ref_id IS NOT NULL
        THEN (
          SELECT jsonb_agg(
            jsonb_build_object('sku', sol.sku, 'name', sol.name, 'qty', sol.qty)
            ORDER BY sol.created_date NULLS LAST
          )
          FROM sales_order_lines sol
          WHERE sol.sales_order_id      = g.ref_id
            AND sol.is_package_parent   = true
            AND sol.is_package_component = false
            AND sol.status              = 'active'
            AND sol.sku                 IS NOT NULL
        )
        ELSE NULL
      END AS order_lines
    FROM (
      SELECT
        sm.ref_type,
        sm.ref_id,
        sm.ref_number,
        sm.reason,
        MAX(sm.created_date) AS event_date,
        COUNT(*)::int        AS movement_count,
        SUM(sm.qty)::numeric AS total_qty
      FROM stock_movements sm
      WHERE
        (p_reason    IS NULL OR sm.reason       = p_reason)
        AND (p_from_date IS NULL OR sm.created_date >= p_from_date)
        AND (p_to_date   IS NULL OR sm.created_date <= p_to_date)
        AND (
          p_search IS NULL
          OR sm.ref_number   ILIKE '%' || p_search || '%'
          OR sm.product_sku  ILIKE '%' || p_search || '%'
          OR sm.product_name ILIKE '%' || p_search || '%'
        )
      GROUP BY sm.ref_type, sm.ref_id, sm.ref_number, sm.reason
      ORDER BY MAX(sm.created_date) DESC NULLS LAST
      LIMIT  p_limit
      OFFSET p_offset
    ) g
    LEFT JOIN sales_orders so
           ON so.id = g.ref_id AND g.ref_type = 'sales_order'
  ) r;

  RETURN json_build_object(
    'total',  COALESCE(v_total, 0),
    'groups', COALESCE(v_rows, '[]'::jsonb)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION get_movement_groups(int, int, text, text, timestamptz, timestamptz)
  TO authenticated, service_role;
