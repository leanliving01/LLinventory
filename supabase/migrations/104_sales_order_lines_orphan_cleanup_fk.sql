-- ============================================================================
-- 104_sales_order_lines_orphan_cleanup_fk.sql
--
-- ORPHANED LINES (live, ongoing): ~5,508 sales_order_lines and ~769
-- sales_order_financial_lines referenced a sales_order_id that no longer exists
-- (~423 orders). They are unreachable — every read/deduct path joins
-- sales_orders — so they never affected stock, but they leaked steadily.
--
-- ROOT CAUSE: for a BRAND-NEW order, both sync-shopify-orders and
-- shopify-webhook-handler look it up, find nothing, and each generates its OWN
-- sales_orders UUID and inserts. uq_sales_orders_external_id lets only one row
-- win; the LOSER's insert failed but its code still wrote the order's lines under
-- its own (never-persisted) UUID → instant orphans, one set per new order that
-- was processed by both paths at once. (Same sync↔webhook race as mig 103, but
-- the two line-sets land under DIFFERENT order ids, so the mig-103 line index
-- couldn't catch it.)
--
-- CODE FIX (same commit): both functions now upsert the order on external_id
-- (ignoreDuplicates) and RE-READ the persisted id before writing lines, so a line
-- can only ever attach to an order that actually exists.
--
-- THIS MIGRATION:
--   1. Delete the existing orphan lines (both tables).
--   2. Add FK sales_order_id -> sales_orders(id) ON DELETE CASCADE on both, so a
--      line can never again reference a missing order, and deleting an order
--      takes its lines with it. Safe because all writers create the order first.
-- ============================================================================

-- 1. Clean existing orphans ---------------------------------------------------
DELETE FROM sales_order_lines sol
WHERE NOT EXISTS (SELECT 1 FROM sales_orders so WHERE so.id = sol.sales_order_id);

DELETE FROM sales_order_financial_lines f
WHERE NOT EXISTS (SELECT 1 FROM sales_orders so WHERE so.id = f.sales_order_id);

-- 2. Referential integrity + cascade -----------------------------------------
ALTER TABLE sales_order_lines
  DROP CONSTRAINT IF EXISTS fk_sol_order;
ALTER TABLE sales_order_lines
  ADD CONSTRAINT fk_sol_order
  FOREIGN KEY (sales_order_id) REFERENCES sales_orders(id) ON DELETE CASCADE;

ALTER TABLE sales_order_financial_lines
  DROP CONSTRAINT IF EXISTS fk_sofl_order;
ALTER TABLE sales_order_financial_lines
  ADD CONSTRAINT fk_sofl_order
  FOREIGN KEY (sales_order_id) REFERENCES sales_orders(id) ON DELETE CASCADE;
