-- ============================================================================
-- 061_pack_bom_autosync.sql
--
-- "Packing BOM is the master, the stock-deduction map auto-syncs from it."
--
-- A sellable package/bundle is assembled in-house from finished meals. Its
-- composition is authored ONCE as a manufacturing packing BOM (boms.bom_class=
-- 'packing' + its bom_components). This migration derives the pack_boms
-- explosion row (used by deduct_fulfilled_stock / recalc-demand) FROM that
-- packing BOM, and keeps it in sync via triggers — so the two systems can never
-- drift.
--
-- Mapping: each component meal's per-box qty becomes a sku_overrides entry and
-- multiplier is fixed at 1, which reproduces exactly the same per-order
-- deduction the hand-authored pack_boms rows produced.
--
-- OPT-IN & SAFE: a package's pack_boms row is only ever rewritten once an ACTIVE
-- packing BOM with components exists for it. Packages that have no packing BOM
-- (the existing goal/low-carb packs) keep their current hand-authored pack_boms
-- untouched. The proven deduction path (054/057) is not changed.
-- ============================================================================

-- One pack_boms row per package SKU (enables the upsert below + dedupes future
-- inserts). Before creating the unique index, defensively collapse any pre-existing
-- duplicate package_sku rows (none exist in the current DB, but the table had no
-- uniqueness before this migration and the PackBomManager UI / a re-run of 056 could
-- have created some — without this the CREATE UNIQUE INDEX would abort the whole
-- migration). Keep the most complete row per SKU (most components), then most recently
-- updated, with id as the final deterministic tie-break so exactly one row survives.
DELETE FROM pack_boms a
USING  pack_boms b
WHERE  a.package_sku = b.package_sku
  AND  a.id <> b.id
  AND  (
        COALESCE(array_length(a.component_skus, 1), 0) <  COALESCE(array_length(b.component_skus, 1), 0)
     OR (COALESCE(array_length(a.component_skus, 1), 0) =  COALESCE(array_length(b.component_skus, 1), 0)
         AND a.updated_date < b.updated_date)
     OR (COALESCE(array_length(a.component_skus, 1), 0) =  COALESCE(array_length(b.component_skus, 1), 0)
         AND a.updated_date = b.updated_date
         AND a.id < b.id)
      );

CREATE UNIQUE INDEX IF NOT EXISTS uq_pack_boms_package_sku ON pack_boms(package_sku);

-- UI-created rows may omit portion_weight_g; give it a default so the NOT NULL
-- column is always satisfied.
ALTER TABLE pack_boms ALTER COLUMN portion_weight_g SET DEFAULT 0;

-- ── Rebuild a package's pack_boms row from its packing BOM ──────────────────
CREATE OR REPLACE FUNCTION rebuild_pack_bom_from_packing_bom(p_product_id text)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_prod      RECORD;
  v_bom_id    text;
  v_skus      text[] := '{}'::text[];
  v_overrides jsonb  := '{}'::jsonb;
  v_pt        text;
  v_weight    numeric;
  comp        RECORD;
BEGIN
  SELECT id, sku, type, weight_g INTO v_prod FROM products WHERE id = p_product_id;
  IF NOT FOUND OR v_prod.sku IS NULL OR v_prod.sku = '' THEN RETURN; END IF;
  -- Only packages/bundles get a derived explosion map.
  IF v_prod.type NOT IN ('package', 'bundle') THEN RETURN; END IF;

  -- The active packing BOM for this product (latest version wins).
  SELECT id INTO v_bom_id
  FROM   boms
  WHERE  product_id = p_product_id
    AND  bom_class  = 'packing'
    AND  is_active  = true
  ORDER  BY version DESC, updated_date DESC
  LIMIT  1;

  -- No active packing BOM → leave any existing pack_boms row as-is (conservative;
  -- never strips deduction coverage out from under fulfilled orders).
  IF v_bom_id IS NULL THEN RETURN; END IF;

  -- Aggregate components: each input meal SKU → qty per ONE box.
  FOR comp IN
    SELECT input_product_sku AS sku, SUM(qty) AS qty
    FROM   bom_components
    WHERE  bom_id = v_bom_id
      AND  input_product_sku IS NOT NULL
      AND  input_product_sku <> ''
    GROUP  BY input_product_sku
  LOOP
    v_skus := v_skus || comp.sku;
    v_overrides := jsonb_set(v_overrides, ARRAY[comp.sku], to_jsonb(comp.qty), true);
  END LOOP;

  -- No components yet → don't wipe an existing row.
  IF array_length(v_skus, 1) IS NULL THEN RETURN; END IF;

  -- Preserve package_type / portion_weight_g from any existing row.
  SELECT package_type, portion_weight_g INTO v_pt, v_weight
  FROM   pack_boms WHERE package_sku = v_prod.sku;
  v_pt     := COALESCE(v_pt, 'bundle');
  v_weight := COALESCE(v_weight, v_prod.weight_g, 0);

  INSERT INTO pack_boms (
    id, package_sku, package_type, portion_weight_g, multiplier,
    component_skus, disabled_skus, sku_overrides, active, created_date, updated_date
  ) VALUES (
    encode(gen_random_bytes(12), 'hex'), v_prod.sku, v_pt, v_weight, 1,
    v_skus, ARRAY[]::text[], v_overrides::text, true, now(), now()
  )
  ON CONFLICT (package_sku) DO UPDATE SET
    package_type     = COALESCE(pack_boms.package_type, EXCLUDED.package_type),
    portion_weight_g = COALESCE(pack_boms.portion_weight_g, EXCLUDED.portion_weight_g),
    multiplier       = EXCLUDED.multiplier,
    component_skus   = EXCLUDED.component_skus,
    disabled_skus    = EXCLUDED.disabled_skus,
    sku_overrides    = EXCLUDED.sku_overrides,
    active           = true,
    updated_date     = now();
END;
$$;

GRANT EXECUTE ON FUNCTION rebuild_pack_bom_from_packing_bom(text) TO service_role, authenticated;

-- ── Triggers: keep pack_boms in step with the packing BOM ──────────────────
-- (rebuild only writes pack_boms — never boms/bom_components — so no recursion.)
CREATE OR REPLACE FUNCTION trg_sync_pack_bom_from_components()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_pid text; v_class text;
BEGIN
  SELECT product_id, bom_class INTO v_pid, v_class
  FROM   boms WHERE id = COALESCE(NEW.bom_id, OLD.bom_id);
  IF v_pid IS NOT NULL AND v_class = 'packing' THEN
    PERFORM rebuild_pack_bom_from_packing_bom(v_pid);
  END IF;
  RETURN NULL;
END; $$;

DROP TRIGGER IF EXISTS trg_bom_components_sync_pack_bom ON bom_components;
CREATE TRIGGER trg_bom_components_sync_pack_bom
  AFTER INSERT OR UPDATE OR DELETE ON bom_components
  FOR EACH ROW EXECUTE FUNCTION trg_sync_pack_bom_from_components();

CREATE OR REPLACE FUNCTION trg_sync_pack_bom_from_boms()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_pid text;
BEGIN
  v_pid := COALESCE(NEW.product_id, OLD.product_id);
  IF v_pid IS NOT NULL AND COALESCE(NEW.bom_class, OLD.bom_class) = 'packing' THEN
    PERFORM rebuild_pack_bom_from_packing_bom(v_pid);
  END IF;
  RETURN NULL;
END; $$;

DROP TRIGGER IF EXISTS trg_boms_sync_pack_bom ON boms;
CREATE TRIGGER trg_boms_sync_pack_bom
  AFTER INSERT OR UPDATE OR DELETE ON boms
  FOR EACH ROW EXECUTE FUNCTION trg_sync_pack_bom_from_boms();
