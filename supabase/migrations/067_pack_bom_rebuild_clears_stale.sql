-- ============================================================================
-- 067_pack_bom_rebuild_clears_stale.sql
--
-- BUG (from review of 061): rebuild_pack_bom_from_packing_bom() returned early
-- when a package's packing BOM was inactivated/deleted or had all its components
-- removed — leaving the previously-derived pack_boms explosion row ACTIVE. That
-- stale row would keep driving deduction/demand even though the master packing
-- BOM no longer describes that composition.
--
-- FIX: in those "nothing to build" cases, DEACTIVATE the derived pack_boms row
-- (active=false) so the explosion map faithfully reflects the master. Only ever
-- triggered by a packing-BOM/component change on a package/bundle product, so
-- hand-authored pack_boms for packages that have no packing BOM are never touched.
-- ============================================================================

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
  IF v_prod.type NOT IN ('package', 'bundle') THEN RETURN; END IF;

  -- The active packing BOM for this product (latest version wins).
  SELECT id INTO v_bom_id
  FROM   boms
  WHERE  product_id = p_product_id
    AND  bom_class  = 'packing'
    AND  is_active  = true
  ORDER  BY version DESC, updated_date DESC
  LIMIT  1;

  -- No active packing BOM → the master no longer describes this pack: deactivate
  -- the derived explosion row so deduction/demand stop using a stale composition.
  IF v_bom_id IS NULL THEN
    UPDATE pack_boms SET active = false, updated_date = now()
     WHERE package_sku = v_prod.sku AND active = true;
    RETURN;
  END IF;

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

  -- Active packing BOM but no components yet → also deactivate (empty box).
  IF array_length(v_skus, 1) IS NULL THEN
    UPDATE pack_boms SET active = false, updated_date = now()
     WHERE package_sku = v_prod.sku AND active = true;
    RETURN;
  END IF;

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
