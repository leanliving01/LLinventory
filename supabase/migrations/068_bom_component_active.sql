-- ============================================================================
-- 068_bom_component_active.sql
--
-- Fold the pack "enable/disable a meal" lever INTO the packing BOM (the master),
-- so a pack's whole composition (which meals, qty, and now active/inactive) lives
-- in ONE place: bom_components. pack_boms stays a purely DERIVED read-model that
-- stock deduction / demand consume.
--
-- WHY: previously a meal could only be disabled on pack_boms.disabled_skus (a
-- direct edit in the Pack Composition UI). But the autosync trigger (061/067)
-- rebuilds pack_boms from the packing BOM and overwrote disabled_skus/sku_overrides
-- on every BOM edit — silently RE-ENABLING a disabled meal so it got deducted
-- again (the "clobber" bug). Once the disable lever lives on bom_components and
-- the rebuild DERIVES disabled_skus from it, there is nothing manual left to
-- clobber.
--
-- SAFE: only packages that ALREADY have an active packing BOM are affected. The
-- existing hand-authored pack_boms rows that have NO master packing BOM (the
-- legacy goal / low-carb packs) are never rebuilt and are left exactly as-is —
-- they keep their current disabled_skus/sku_overrides and stay editable in the
-- Pack Composition page. (Converting those to packing BOMs is a separate rollout.)
-- ============================================================================

-- 1. The new lever on the master. Default true → every existing component (incl.
--    all production-BOM ingredients, which ignore this flag) stays active.
ALTER TABLE bom_components ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;

-- 2. Rebuild now DERIVES disabled_skus from inactive components. Keeps 067's
--    stale-clear behaviour (deactivate the derived row when the master no longer
--    describes the pack) so the explosion map always mirrors the master.
CREATE OR REPLACE FUNCTION rebuild_pack_bom_from_packing_bom(p_product_id text)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_prod      RECORD;
  v_bom_id    text;
  v_skus      text[] := '{}'::text[];
  v_disabled  text[] := '{}'::text[];
  v_overrides jsonb  := '{}'::jsonb;
  v_pt        text;
  v_weight    numeric;
  comp        RECORD;
BEGIN
  SELECT id, sku, type, weight_g INTO v_prod FROM products WHERE id = p_product_id;
  IF NOT FOUND OR v_prod.sku IS NULL OR v_prod.sku = '' THEN RETURN; END IF;
  IF v_prod.type NOT IN ('package', 'bundle') THEN RETURN; END IF;

  -- The active packing BOM for this product (latest version wins).
  SELECT id INTO v_bom_id
  FROM   boms
  WHERE  product_id = p_product_id
    AND  bom_class  = 'packing'
    AND  is_active  = true
  ORDER  BY version DESC, updated_date DESC
  LIMIT  1;

  -- No active packing BOM → deactivate the derived row (067 stale-clear). Only
  -- ever reached for a product that HAS had a packing BOM, so hand-authored
  -- pack_boms rows (no master BOM ever) are untouched.
  IF v_bom_id IS NULL THEN
    UPDATE pack_boms SET active = false, updated_date = now()
     WHERE package_sku = v_prod.sku AND active = true;
    RETURN;
  END IF;

  -- Aggregate components: qty per meal SKU + whether the meal is active.
  -- A SKU is "disabled" only if EVERY row for it is inactive.
  FOR comp IN
    SELECT input_product_sku AS sku,
           SUM(qty)          AS qty,
           bool_or(COALESCE(is_active, true)) AS any_active
    FROM   bom_components
    WHERE  bom_id = v_bom_id
      AND  input_product_sku IS NOT NULL
      AND  input_product_sku <> ''
    GROUP  BY input_product_sku
  LOOP
    v_skus := v_skus || comp.sku;
    v_overrides := jsonb_set(v_overrides, ARRAY[comp.sku], to_jsonb(comp.qty), true);
    IF NOT comp.any_active THEN
      v_disabled := v_disabled || comp.sku;
    END IF;
  END LOOP;

  -- Active packing BOM but no components → deactivate (empty box) (067 behaviour).
  IF array_length(v_skus, 1) IS NULL THEN
    UPDATE pack_boms SET active = false, updated_date = now()
     WHERE package_sku = v_prod.sku AND active = true;
    RETURN;
  END IF;

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
    v_skus, v_disabled, v_overrides::text, true, now(), now()
  )
  ON CONFLICT (package_sku) DO UPDATE SET
    package_type     = COALESCE(pack_boms.package_type, EXCLUDED.package_type),
    portion_weight_g = COALESCE(pack_boms.portion_weight_g, EXCLUDED.portion_weight_g),
    multiplier       = EXCLUDED.multiplier,
    component_skus   = EXCLUDED.component_skus,
    disabled_skus    = EXCLUDED.disabled_skus,   -- now derived from is_active (no clobber)
    sku_overrides    = EXCLUDED.sku_overrides,
    active           = true,
    updated_date     = now();
END;
$$;

GRANT EXECUTE ON FUNCTION rebuild_pack_bom_from_packing_bom(text) TO service_role, authenticated;

-- 3. Cutover backfill (zero behaviour change). For packages that ALREADY have an
--    active packing BOM, fold their current pack_boms disabled/override state back
--    onto the master bom_components so the rebuild reproduces the EXACT current
--    explosion. Hand-authored packs (no master BOM) are skipped untouched.
DO $$
DECLARE
  pb      RECORD;
  v_bom   text;
  v_ov    jsonb;
  v_sku   text;
  v_qty   numeric;
BEGIN
  FOR pb IN
    SELECT p.id AS product_id, pk.package_sku, pk.disabled_skus, pk.sku_overrides
    FROM   pack_boms pk
    JOIN   products p ON upper(p.sku) = upper(pk.package_sku)
    WHERE  p.type IN ('package','bundle')
  LOOP
    SELECT id INTO v_bom
    FROM   boms
    WHERE  product_id = pb.product_id AND bom_class = 'packing' AND is_active = true
    ORDER  BY version DESC, updated_date DESC
    LIMIT  1;
    CONTINUE WHEN v_bom IS NULL;   -- hand-authored pack, no master BOM → leave as-is

    -- Disabled meals → is_active = false on their components.
    IF pb.disabled_skus IS NOT NULL AND array_length(pb.disabled_skus, 1) > 0 THEN
      UPDATE bom_components
         SET is_active = false, updated_date = now()
       WHERE bom_id = v_bom
         AND input_product_sku = ANY(pb.disabled_skus);
    END IF;

    -- Manual qty overrides → bom_components.qty (preserve live quantities).
    v_ov := NULLIF(pb.sku_overrides, '')::jsonb;
    IF v_ov IS NOT NULL THEN
      FOR v_sku, v_qty IN SELECT key, value::numeric FROM jsonb_each_text(v_ov)
      LOOP
        UPDATE bom_components
           SET qty = v_qty, updated_date = now()
         WHERE bom_id = v_bom AND input_product_sku = v_sku;
      END LOOP;
    END IF;

    -- Recompose the derived row from the now-authoritative master.
    PERFORM rebuild_pack_bom_from_packing_bom(pb.product_id);
  END LOOP;
END $$;

-- 4. Verify: derived disabled_skus should now match inactive components per pack.
SELECT pk.package_sku,
       pk.disabled_skus,
       COUNT(*) FILTER (WHERE bc.is_active = false) AS inactive_components
FROM   pack_boms pk
JOIN   products p ON upper(p.sku) = upper(pk.package_sku) AND p.type IN ('package','bundle')
JOIN   boms b ON b.product_id = p.id AND b.bom_class='packing' AND b.is_active = true
LEFT   JOIN bom_components bc ON bc.bom_id = b.id AND bc.is_active = false
GROUP  BY pk.package_sku, pk.disabled_skus
ORDER  BY pk.package_sku;
