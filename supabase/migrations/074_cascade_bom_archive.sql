-- ============================================================================
-- 074_cascade_bom_archive.sql
--
-- Archiving a product should also hide its BOM(s); re-activating the product
-- should bring those BOM(s) back. BOMs are never deleted — only flipped via
-- boms.is_active (the column the Recipes list + RecipeProductDetail already use
-- to show/hide a layer).
--
-- WHY: after the spinach→replacement cutover the old `…6D/8D/9D` meals were
-- archived (products.status='archived') but their portion BOMs stayed
-- is_active=true, so they kept showing in the BOM/Recipes lists. The user wants
-- archive to cascade to the BOM automatically and reversibly, app-wide.
--
-- HOW: a new boms.archived_by_product flag records that a BOM was deactivated BY
-- the cascade (not a manual "inactive draft"). Re-activating the product only
-- restores BOMs that the cascade itself turned off — a manually-disabled draft
-- on an archived product stays disabled.
-- ============================================================================

-- 1. Remember which BOMs the cascade turned off (so reactivation is precise).
ALTER TABLE boms ADD COLUMN IF NOT EXISTS archived_by_product boolean NOT NULL DEFAULT false;

-- 2. Cascade function — fires on a real status transition only.
CREATE OR REPLACE FUNCTION cascade_bom_archive_on_product_status()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status = 'archived' AND OLD.status IS DISTINCT FROM 'archived' THEN
    -- Product archived → deactivate its currently-active BOMs, tagging them so
    -- we know to restore exactly these (and not manual drafts) later.
    UPDATE boms
       SET is_active = false,
           archived_by_product = true,
           updated_date = now()
     WHERE product_id = NEW.id
       AND is_active IS DISTINCT FROM false;

  ELSIF NEW.status = 'active' AND OLD.status = 'archived' THEN
    -- Product re-activated → restore ONLY the BOMs the cascade turned off.
    UPDATE boms
       SET is_active = true,
           archived_by_product = false,
           updated_date = now()
     WHERE product_id = NEW.id
       AND archived_by_product = true;
  END IF;

  RETURN NEW;
END;
$$;

-- 3. Trigger: only when the status column changes.
DROP TRIGGER IF EXISTS trg_cascade_bom_archive ON products;
CREATE TRIGGER trg_cascade_bom_archive
  AFTER UPDATE OF status ON products
  FOR EACH ROW
  WHEN (NEW.status IS DISTINCT FROM OLD.status)
  EXECUTE FUNCTION cascade_bom_archive_on_product_status();

GRANT EXECUTE ON FUNCTION cascade_bom_archive_on_product_status() TO service_role, authenticated;

-- 4. Cutover backfill: any product ALREADY archived gets its still-active BOMs
--    deactivated now (covers the 12 `…6D/8D/9D` replacement-cutover meals whose
--    BOMs are currently is_active=true).
UPDATE boms b
   SET is_active = false,
       archived_by_product = true,
       updated_date = now()
  FROM products p
 WHERE b.product_id = p.id
   AND p.status = 'archived'
   AND b.is_active IS DISTINCT FROM false;

-- 5. Verify: no active BOM should remain on an archived product.
SELECT COUNT(*) AS active_boms_on_archived_products
FROM   boms b
JOIN   products p ON p.id = b.product_id
WHERE  p.status = 'archived'
  AND  b.is_active = true;
