-- ===========================================================================
-- 105_product_max_level.sql
--
-- Phase 2 of the 2026-07-01 planning logic: a per-meal MAX ceiling, distinct
-- from par. Par is the floor to rebuild TO; max_level is a "never exceed on
-- hand" ceiling. Today's driver: LHCCG capped at 270 while burning down
-- cauliflower, so the veg-burn-down / par top-up can't overstock it.
--
-- Nullable — most meals have no ceiling (only par). The engine treats
-- max_level = NULL as "no ceiling".
-- ===========================================================================
ALTER TABLE products ADD COLUMN IF NOT EXISTS max_level numeric;

COMMENT ON COLUMN products.max_level IS
  'Optional production ceiling (max units to hold on hand). NULL = no ceiling. '
  'Distinct from par_level (the floor to rebuild to). Used by the production planner.';
