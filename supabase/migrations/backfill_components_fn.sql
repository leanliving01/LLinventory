CREATE OR REPLACE FUNCTION backfill_missing_components()
RETURNS void
LANGUAGE sql
AS $$
  INSERT INTO sales_order_lines (
    id, sales_order_id, external_id, sku, name, variant_title, qty, unit_price, line_total,
    is_package_parent, is_package_component, parent_line_id, line_type, status, source_platform,
    last_synced_at, created_date, updated_date
  )
  SELECT
    gen_random_uuid(),
    parent.sales_order_id,
    parent.id::text || '-' || comp_sku,
    comp_sku,
    comp_sku,
    NULL::text,
    COALESCE(
      (CASE WHEN (pb.sku_overrides IS NOT NULL AND pb.sku_overrides <> '')
        THEN (pb.sku_overrides::jsonb)->>comp_sku
        ELSE NULL
      END)::numeric,
      pb.multiplier::numeric
    ) * parent.qty,
    0, 0,
    false, true, parent.id,
    'standalone', 'active', 'shopify',
    NOW(), NOW(), NOW()
  FROM
    sales_order_lines parent
    JOIN pack_boms pb ON pb.package_sku = parent.sku AND pb.active = true
    CROSS JOIN LATERAL unnest(pb.component_skus) AS comp_sku
  WHERE
    parent.is_package_parent = true
    AND parent.status = 'active'
    AND NOT EXISTS (
      SELECT 1 FROM sales_order_lines comp
      WHERE comp.sales_order_id = parent.sales_order_id
        AND comp.is_package_component = true
        AND comp.parent_line_id = parent.id
    )
    AND NOT (comp_sku = ANY(COALESCE(pb.disabled_skus, '{}'::text[])));
$$;
