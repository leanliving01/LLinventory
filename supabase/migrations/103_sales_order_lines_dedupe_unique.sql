-- ============================================================================
-- 103_sales_order_lines_dedupe_unique.sql
--
-- BUG (live, 2026-07-01): a single Shopify order's lines were stored 2–3×, so
-- deduct_fulfilled_stock summed the duplicates and deducted 2–3× the real
-- quantity on fulfilment — the ordered meals AND the 100%-off free gifts
-- (soups/stews on 15/30/60-meal packs).
--
-- ROOT CAUSE: both sync-shopify-orders and shopify-webhook-handler replace an
-- order's lines with a NON-ATOMIC delete-then-insert, and sales_order_lines has
-- no unique key. When the scheduled sync and the order's webhook (or two webhook
-- deliveries) run for the same order within the same second, the deletes and
-- inserts interleave and every line is inserted more than once.
--
-- FIX (data cleanup + permanent guard):
--   1. Collapse any duplicate (sales_order_id, external_id) rows, keeping the
--      earliest-created copy. A whole import pass shares one created_date, so the
--      kept copy's parent/child linkage stays internally consistent.
--   2. Add a UNIQUE index on (sales_order_id, external_id) so a racing re-import
--      can never duplicate a line again. Lines with NULL external_id (manual
--      orders) stay unconstrained — Postgres treats NULLs as distinct.
--
-- The four edge functions that write sales_order_lines (sync-shopify-orders,
-- shopify-webhook-handler, shopify-history-import, recalc-demand) are changed in
-- the same commit to upsert with onConflict='sales_order_id,external_id',
-- ignoreDuplicates=true so the losing racer no-ops instead of erroring.
--
-- NOT handled here (separate issue): ~5,598 orphan lines from ~423 sales_orders
-- deleted without an ON DELETE CASCADE (2026-05-18 → present). They are
-- unreachable (every read/deduct path joins sales_orders) so they don't affect
-- stock, and only 45 of them (2 orders) carry the duplicate pairs collapsed in
-- step 1. A dedicated cleanup + FK-cascade migration should follow.
--
-- Stock already over-deducted on the fulfilled orders (#31646, #31410) was
-- corrected separately via cancellation_reversal movements.
-- ============================================================================

-- 1. Collapse duplicates — keep earliest per (order, external_id) --------------
WITH ranked AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY sales_order_id, external_id
           ORDER BY created_date, id
         ) AS rn
  FROM sales_order_lines
  WHERE external_id IS NOT NULL
)
DELETE FROM sales_order_lines t
USING ranked r
WHERE t.id = r.id AND r.rn > 1;

-- 2. Enforce uniqueness going forward -----------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS ux_sales_order_lines_order_extid
  ON sales_order_lines (sales_order_id, external_id);
