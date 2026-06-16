-- 2026-06-05_fix_reclass_false_positives.sql
-- ONE-OFF DATA FIX (not an auto-applied migration). Run once in the SQL Editor.
--
-- Corrects two issues from migration 044 (reclassify_service_products):
--   A. "Low Calorie 1000 Island Sauce" is a REAL inventory product that was
--      mis-typed type='service' in the products table, so 044 archived it and
--      cancelled its order lines. This fully restores it.
--   B. Four genuinely-shipping items ("Shipping - Custom", "Shipping - LOCAL
--      PICK UP", "Shipping - Lean Living PE", "Shipping - Standard Shipping")
--      were correctly archived BUT their financial lines landed in category
--      'other' because no rule matched their names. This relabels them
--      'shipping' so they show in the Shipping section / shipping_charged.
--
-- Also adds the missing classification rules to the LIVE rules table (the 042
-- seed has a "WHERE NOT EXISTS" guard, so it won't re-seed an already-populated
-- table — these must be inserted explicitly).
--
-- Idempotent: re-running is safe (no-ops on rows already corrected).

-- A. Restore the sauce ------------------------------------------------------
DO $$
DECLARE v_pid text; v_sku text;
BEGIN
  SELECT product_id INTO v_pid FROM service_product_reclass_audit
   WHERE name = 'Low Calorie 1000 Island Sauce' ORDER BY run_at DESC LIMIT 1;
  IF v_pid IS NULL THEN
    RAISE NOTICE 'Sauce not found in audit — nothing to restore.';
    RETURN;
  END IF;
  SELECT sku INTO v_sku FROM products WHERE id = v_pid;

  -- 1. Remove the migration-created financial lines for its order lines.
  DELETE FROM sales_order_financial_lines f
   USING sales_order_lines sol
   WHERE f.source = 'migration'
     AND f.external_ref = sol.id
     AND (sol.our_product_id = v_pid OR sol.sku = v_sku);

  -- 2. Re-activate the order lines 044 cancelled.
  UPDATE sales_order_lines sol
     SET status = 'active', updated_date = now()
   WHERE (sol.our_product_id = v_pid OR sol.sku = v_sku)
     AND sol.status = 'cancelled';

  -- 3. Restore the product as a tracked inventory item (type was bad data —
  --    set to 'sauce'; change in the catalog if a different type is correct).
  UPDATE products
     SET type = 'sauce', item_type = 'stock', inventory_tracked = true,
         purchasable = true, status = 'active', updated_date = now()
   WHERE id = v_pid;

  RAISE NOTICE 'Restored sauce product % (sku %).', v_pid, v_sku;
END $$;

-- B. Relabel the four "Shipping - *" financial lines from 'other' -> 'shipping'
UPDATE sales_order_financial_lines
   SET category = 'shipping', updated_date = now()
 WHERE source = 'migration'
   AND category = 'other'
   AND label ILIKE 'Shipping -%';

-- C. Add the missing classification rules to the live table ------------------
INSERT INTO sales_line_classification_rules (id, match_type, pattern, classified_as, priority, notes)
SELECT v.* FROM (VALUES
  (gen_random_uuid()::text, 'sku_prefix',    'shipping -', 'shipping', 15, 'Any "Shipping - *" SKU/title'),
  (gen_random_uuid()::text, 'title_keyword', 'pick up',    'shipping', 20, 'Local pick up (spaced)'),
  (gen_random_uuid()::text, 'title_keyword', 'shipping',   'shipping', 45, 'Generic shipping service')
) AS v(id, match_type, pattern, classified_as, priority, notes)
WHERE NOT EXISTS (
  SELECT 1 FROM sales_line_classification_rules r
   WHERE r.match_type = v.match_type AND r.pattern = v.pattern
);
