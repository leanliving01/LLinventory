-- ============================================================================
-- 072_products_pack_bom_reparent.sql
--
-- Gap (audit F7.4 / R8): there is no trigger on `products`, so renaming a
-- package's SKU or flipping its `type` away from package/bundle ORPHANS its
-- derived `pack_boms` row — it keeps the OLD package_sku, stays active, and drifts
-- from the master. Deduction/demand then explode (or fail to explode) against a
-- stale key.
--
-- FIX: an AFTER UPDATE trigger on `products` that keeps the derived `pack_boms`
-- row in step whenever a package/bundle's sku or type changes:
--   • SKU rename → carry the derived row to the new SKU (respecting the unique
--     index), then rebuild from the packing BOM.
--   • Still a package/bundle → rebuild from its packing BOM (no-op if none).
--   • No longer a package/bundle → deactivate any derived rows for either SKU.
-- Only fires when a package/bundle is involved, so ordinary product renames are
-- unaffected. Writes only pack_boms (never products) → no recursion.
-- ============================================================================

CREATE OR REPLACE FUNCTION trg_products_pack_bom_reparent()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- SKU rename on a package/bundle → move the derived row to the new SKU.
  IF NEW.sku IS DISTINCT FROM OLD.sku
     AND OLD.sku IS NOT NULL AND OLD.sku <> ''
     AND NEW.sku IS NOT NULL AND NEW.sku <> '' THEN
    -- Clear any pre-existing row on the destination SKU (unique index), then re-point.
    DELETE FROM pack_boms WHERE package_sku = NEW.sku AND package_sku <> OLD.sku;
    UPDATE pack_boms SET package_sku = NEW.sku, updated_date = now() WHERE package_sku = OLD.sku;
  END IF;

  IF NEW.type IN ('package', 'bundle') THEN
    -- (Still) a package → rebuild from its packing BOM; refreshes/creates the
    -- row for NEW.sku, or deactivates it if the master no longer describes it.
    PERFORM rebuild_pack_bom_from_packing_bom(NEW.id);
  ELSIF OLD.type IN ('package', 'bundle') THEN
    -- No longer a package → deactivate any derived rows for either SKU.
    UPDATE pack_boms SET active = false, updated_date = now()
     WHERE package_sku IN (NEW.sku, OLD.sku) AND active = true;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_products_pack_bom_reparent ON products;
CREATE TRIGGER trg_products_pack_bom_reparent
  AFTER UPDATE ON products
  FOR EACH ROW
  WHEN (
    (NEW.sku IS DISTINCT FROM OLD.sku OR NEW.type IS DISTINCT FROM OLD.type)
    AND (NEW.type IN ('package', 'bundle') OR OLD.type IN ('package', 'bundle'))
  )
  EXECUTE FUNCTION trg_products_pack_bom_reparent();

GRANT EXECUTE ON FUNCTION trg_products_pack_bom_reparent() TO service_role, authenticated;
