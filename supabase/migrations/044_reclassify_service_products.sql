-- ============================================================================
-- 044_reclassify_service_products
-- Clean up inventory products that were wrongly created from Shopify service /
-- shipping / voucher / discount / refund entries. Safe, reversible, auditable:
--   * NO hard delete.
--   * Order-line references are migrated into sales_order_financial_lines first,
--     then the offending sales_order_lines rows are CANCELLED (not deleted), so
--     historical sales data and stock_movements are preserved.
--   * The product is archived (status='archived', item_type='service',
--     inventory_tracked=false, purchasable=false) so it drops out of Catalog,
--     purchasing, production, BOM, stock and stock-take without being deleted.
--
-- Idempotent: re-running migrates nothing new (unique key + status guards) and
-- re-archives nothing already archived.
--
-- Detection uses sales_line_classification_rules (042) matched against
-- products.name / products.sku, plus type='service'. product_type rules are not
-- applied here (products has no Shopify product_type column).
-- ============================================================================

-- 1. Audit table (populated first — review before/after) --------------------
CREATE TABLE IF NOT EXISTS service_product_reclass_audit (
  id            text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  run_at        timestamptz NOT NULL DEFAULT now(),
  product_id    text NOT NULL,
  sku           text,
  name          text,
  old_type      text,
  classified_as text,
  ref_counts    jsonb,
  action_taken  text
);

-- 2. Resolve candidate products + their classification ----------------------
--    Lowest-priority matching active rule wins.
DROP TABLE IF EXISTS _reclass_candidates;
CREATE TEMP TABLE _reclass_candidates AS
WITH matched AS (
  SELECT
    p.id AS product_id, p.sku, p.name, p.type AS old_type,
    r.classified_as, r.priority,
    ROW_NUMBER() OVER (PARTITION BY p.id ORDER BY r.priority ASC) AS rn
  FROM products p
  JOIN sales_line_classification_rules r
    ON r.active = true
   AND r.classified_as <> 'inventory_product'
   AND (
        (r.match_type = 'title_keyword' AND p.name ILIKE '%' || r.pattern || '%')
     OR (r.match_type = 'title_regex'   AND p.name ~* r.pattern)
     OR (r.match_type = 'sku_exact'     AND lower(p.sku) = lower(r.pattern))
     OR (r.match_type = 'sku_prefix'    AND lower(p.sku) LIKE lower(r.pattern) || '%')
   )
  WHERE p.status <> 'archived'
),
ranked AS (
  SELECT product_id, sku, name, old_type, classified_as FROM matched WHERE rn = 1
)
-- Also fold in any product already typed as 'service' that no rule caught.
SELECT product_id, sku, name, old_type, classified_as FROM ranked
UNION
SELECT p.id, p.sku, p.name, p.type, 'other'
FROM products p
WHERE p.type = 'service' AND p.status <> 'archived'
  AND NOT EXISTS (SELECT 1 FROM ranked rk WHERE rk.product_id = p.id);

-- 3. Record audit rows with reference counts --------------------------------
INSERT INTO service_product_reclass_audit
  (product_id, sku, name, old_type, classified_as, ref_counts, action_taken)
SELECT
  c.product_id, c.sku, c.name, c.old_type, c.classified_as,
  jsonb_build_object(
    'order_lines',   (SELECT count(*) FROM sales_order_lines sol
                        WHERE sol.our_product_id = c.product_id OR sol.sku = c.sku),
    'pack_bom_pkg',  (SELECT count(*) FROM pack_boms b WHERE b.package_sku = c.sku),
    'pack_bom_comp', (SELECT count(*) FROM pack_boms b WHERE c.sku = ANY(b.component_skus)),
    'supplier_products', (SELECT count(*) FROM supplier_products sp WHERE sp.product_id = c.product_id),
    'stock_on_hand', (SELECT count(*) FROM stock_on_hand soh WHERE soh.product_id = c.product_id),
    'stock_movements', (SELECT count(*) FROM stock_movements sm WHERE sm.product_id = c.product_id)
  ),
  'pending'
FROM _reclass_candidates c;

-- 4. Migrate order-line references into financial lines ----------------------
--    source='migration', external_ref = the original line id → idempotent via
--    the unique index (sales_order_id, source, category, external_ref).
INSERT INTO sales_order_financial_lines
  (id, sales_order_id, shopify_order_id, order_number, category, label,
   amount, sign, tax_amount, source, external_ref, raw_payload, notes,
   created_date, updated_date)
SELECT
  gen_random_uuid()::text,
  sol.sales_order_id,
  so.shopify_order_id,
  so.order_number,
  c.classified_as,
  COALESCE(sol.name, c.name, c.sku),
  ABS(COALESCE(sol.line_total, 0)),
  CASE WHEN c.classified_as IN ('discount','voucher','store_credit','refund') THEN -1 ELSE 1 END,
  0,
  'migration',
  sol.id,
  sol.raw_payload,
  'Reclassified from wrongly-created product ' || c.sku,
  now(), now()
FROM sales_order_lines sol
JOIN _reclass_candidates c
  ON (sol.our_product_id = c.product_id OR sol.sku = c.sku)
JOIN sales_orders so ON so.id = sol.sales_order_id
WHERE sol.status = 'active'
ON CONFLICT (sales_order_id, source, category, COALESCE(external_ref, '')) DO NOTHING;

-- 5. Cancel the migrated product lines (stops future stock deduction;
--    deduct_fulfilled_stock filters status='active'). History preserved.
UPDATE sales_order_lines sol
SET status = 'cancelled', updated_date = now()
FROM _reclass_candidates c
WHERE (sol.our_product_id = c.product_id OR sol.sku = c.sku)
  AND sol.status = 'active';

-- 6. Archive the offending products (reversible — nothing deleted) -----------
UPDATE products p
SET item_type = 'service',
    inventory_tracked = false,
    purchasable = false,
    status = 'archived',
    updated_date = now()
FROM _reclass_candidates c
WHERE p.id = c.product_id
  AND p.status <> 'archived';

UPDATE service_product_reclass_audit SET action_taken = 'archived'
WHERE action_taken = 'pending';

DROP TABLE IF EXISTS _reclass_candidates;

-- ----------------------------------------------------------------------------
-- Verification (run manually after applying):
--   SELECT classified_as, count(*) FROM service_product_reclass_audit GROUP BY 1;
--   SELECT count(*) FROM products WHERE type='service' AND status='active';   -- expect 0
--   -- Every reclassified product's old active lines now cancelled:
--   SELECT count(*) FROM sales_order_lines sol
--     JOIN service_product_reclass_audit a
--       ON (sol.our_product_id=a.product_id OR sol.sku=a.sku)
--    WHERE sol.status='active';                                               -- expect 0
--   -- stock_movements untouched (no rows deleted by this migration).
-- ----------------------------------------------------------------------------
