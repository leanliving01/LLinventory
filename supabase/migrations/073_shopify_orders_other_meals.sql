-- ============================================================================
-- 073_shopify_orders_other_meals.sql
--
-- Gap (Codex CRITICAL): recalc-demand explodes a package into component meals and
-- buckets each by range (mwl/mlm/wwl/wlm/lc/byo). Any meal that isn't one of those
-- variants — e.g. Winter Warmer (WWR) meals — mapped to the "other" category, which
-- had NO column and was dropped from `total_meals`. So a Winter Warmer pack order
-- exploded correctly for stock but showed 0 meals in the dashboard totals.
--
-- FIX: add `other_meals` so recalc-demand can persist the "other" bucket and include
-- it in total_meals (see supabase/functions/recalc-demand/index.ts). Backfill is left
-- at 0; the next recalc-demand pass repopulates per order. Run in the SQL Editor.
-- ============================================================================

ALTER TABLE shopify_orders ADD COLUMN IF NOT EXISTS other_meals numeric NOT NULL DEFAULT 0;
