-- 2026-06-05_default_warehouse_pe_main.sql
-- ONE-OFF DATA FIX (not an auto-applied migration). Run once in the Supabase SQL Editor.
--
-- A product's storage location is stored in products.default_location_id as the
-- MOST-SPECIFIC location: a zone id when a zone is set, otherwise the warehouse
-- id. The warehouse is always derivable from a zone via locations.parent_location_id.
--
-- The catalogue already has one warehouse — "Port Elizabeth Main Warehouse"
-- (id 69ea6bec8ec21eb79273085e) — with six zones parented under it (Cold Storage,
-- Meal Freezer, Dry Storage, etc.). Products that already point at a zone are
-- fine: the app resolves their warehouse automatically.
--
-- The gap: ~309 products have NO default_location_id at all, so no warehouse
-- shows on the product list. Business rule: the warehouse must always be set, the
-- zone is optional. This backfills the missing warehouse (no zone) for every
-- product that has none.
--
-- Idempotent: only touches rows where default_location_id is null/blank, and
-- only if the PE Main Warehouse row exists.

DO $$
DECLARE
  v_wh_id   text := '69ea6bec8ec21eb79273085e';  -- Port Elizabeth Main Warehouse
  v_updated int;
BEGIN
  -- Guard: the warehouse must exist and be a real (top-level) warehouse.
  IF NOT EXISTS (
    SELECT 1 FROM locations
     WHERE id = v_wh_id AND parent_location_id IS NULL AND type <> 'production'
  ) THEN
    RAISE EXCEPTION 'PE Main Warehouse (%) not found or is not a top-level warehouse', v_wh_id;
  END IF;

  UPDATE products
     SET default_location_id = v_wh_id,
         updated_date = now()
   WHERE default_location_id IS NULL
      OR btrim(default_location_id) = '';

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RAISE NOTICE 'Set default warehouse on % product(s) with no location.', v_updated;
END $$;
