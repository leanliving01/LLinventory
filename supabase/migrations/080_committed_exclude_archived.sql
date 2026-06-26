-- ============================================================================
-- 080_committed_exclude_archived
--
-- Stop committing stock for orders that have been ARCHIVED in Shopify
-- (sales_orders.closed_at IS NOT NULL) even if they never reached 'fulfilled'.
--
-- Why: Shopify's "Archive" sets closed_at without cancelling or fulfilling the
-- order. Such an order is done with and should not keep reserving stock. The
-- committed recalc previously keyed only on lifecycle_state='paid_unfulfilled',
-- so an archived-but-unfulfilled order (e.g. #30983) kept committing its meals.
--
-- This re-creates recalc_committed_stock() (live def from 051) and
-- recalc_committed_stock_dry_run() (live def from 004) adding a single filter:
--   AND so.closed_at IS NULL
-- The sync/webhook now populate sales_orders.closed_at from Shopify o.closed_at.
--
-- ⚠️  Run in the Supabase SQL Editor with the function deploy.
-- ============================================================================

CREATE OR REPLACE FUNCTION recalc_committed_stock()
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_committed    jsonb    := '{}'::jsonb;
  v_written      int      := 0;
  r              RECORD;
  bom_rec        RECORD;
  comp_sku       text;
  meal_qty       numeric;
  overrides      jsonb;
  new_committed  numeric;
  new_available  numeric;
  seen_products  text[]   := '{}';
  missing_boms   text[]   := '{}';
  bom_found      boolean;
BEGIN

  -- Step 1: walk every active non-component, non-bundle line on paid_unfulfilled,
  --         NON-ARCHIVED orders.
  FOR r IN
    SELECT sol.sku, sol.qty, sol.is_package_parent
    FROM   sales_order_lines sol
    JOIN   sales_orders so ON so.id = sol.sales_order_id
    WHERE  so.lifecycle_state       = 'paid_unfulfilled'
      AND  so.closed_at IS NULL
      AND  sol.is_package_component = false
      AND  sol.status               = 'active'
      AND  sol.sku IS NOT NULL
      AND  COALESCE(sol.line_type, '') NOT IN ('bundle', 'bundle_child')
  LOOP
    IF r.is_package_parent THEN
      bom_found := false;
      FOR bom_rec IN
        SELECT multiplier, component_skus, disabled_skus, sku_overrides
        FROM   pack_boms
        WHERE  package_sku = r.sku AND active = true
        LIMIT 1
      LOOP
        bom_found := true;
        overrides := CASE
          WHEN bom_rec.sku_overrides IS NULL OR bom_rec.sku_overrides = '' OR bom_rec.sku_overrides = '{}'
          THEN '{}'::jsonb
          ELSE bom_rec.sku_overrides::jsonb
        END;

        FOREACH comp_sku IN ARRAY COALESCE(bom_rec.component_skus, '{}') LOOP
          IF bom_rec.disabled_skus IS NOT NULL
             AND comp_sku = ANY(bom_rec.disabled_skus) THEN
            CONTINUE;
          END IF;
          meal_qty := COALESCE(
            (overrides ->> comp_sku)::numeric,
            bom_rec.multiplier::numeric
          ) * r.qty;
          v_committed := jsonb_set(
            v_committed,
            ARRAY[comp_sku],
            to_jsonb(COALESCE((v_committed ->> comp_sku)::numeric, 0) + meal_qty),
            true
          );
        END LOOP;
      END LOOP;
      IF NOT bom_found AND NOT (r.sku = ANY(missing_boms)) THEN
        missing_boms := missing_boms || r.sku;
      END IF;
    ELSE
      v_committed := jsonb_set(
        v_committed,
        ARRAY[r.sku],
        to_jsonb(COALESCE((v_committed ->> r.sku)::numeric, 0) + r.qty),
        true
      );
    END IF;
  END LOOP;

  -- Step 2: write to stock_on_hand — one row per product only.
  FOR r IN
    SELECT soh.id,
           soh.product_id,
           soh.qty_on_hand,
           soh.qty_committed AS old_committed,
           soh.qty_available AS old_available,
           p.sku
    FROM   stock_on_hand soh
    JOIN   products p ON p.id = soh.product_id
    WHERE  p.sku IS NOT NULL
    ORDER  BY soh.product_id,
              soh.qty_on_hand DESC NULLS LAST,
              soh.id
  LOOP
    IF r.product_id = ANY(seen_products) THEN
      IF COALESCE(r.old_committed, 0) != 0
         OR COALESCE(r.old_available, 0) != GREATEST(0, COALESCE(r.qty_on_hand, 0)) THEN
        UPDATE stock_on_hand
           SET qty_committed = 0,
               qty_available = GREATEST(0, COALESCE(r.qty_on_hand, 0)),
               updated_date  = now()
         WHERE id = r.id;
        v_written := v_written + 1;
      END IF;
    ELSE
      seen_products := seen_products || r.product_id;
      new_committed := COALESCE((v_committed ->> r.sku)::numeric, 0);
      new_available := GREATEST(0, COALESCE(r.qty_on_hand, 0) - new_committed);

      IF COALESCE(r.old_committed, 0) != new_committed
         OR COALESCE(r.old_available, 0) != new_available THEN
        UPDATE stock_on_hand
           SET qty_committed = new_committed,
               qty_available = new_available,
               updated_date  = now()
         WHERE id = r.id;
        v_written := v_written + 1;
      END IF;
    END IF;
  END LOOP;

  RETURN json_build_object(
    'status',        'completed',
    'rows_written',  v_written,
    'unique_skus',   (SELECT COUNT(*) FROM jsonb_object_keys(v_committed)),
    'missing_boms',  missing_boms
  );
END;
$$;

-- Dry-run variant: same filter, returns computed values without writing.
CREATE OR REPLACE FUNCTION recalc_committed_stock_dry_run()
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_committed  jsonb   := '{}'::jsonb;
  r            RECORD;
  bom_rec      RECORD;
  comp_sku     text;
  meal_qty     numeric;
  overrides    jsonb;
  v_lines      int     := 0;
  missing_boms text[]  := '{}';
  bom_found    boolean;
BEGIN
  FOR r IN
    SELECT sol.sku, sol.qty, sol.is_package_parent
    FROM   sales_order_lines sol
    JOIN   sales_orders so ON so.id = sol.sales_order_id
    WHERE  so.lifecycle_state       = 'paid_unfulfilled'
      AND  so.closed_at IS NULL
      AND  sol.is_package_component = false
      AND  sol.status               = 'active'
      AND  sol.sku IS NOT NULL
      AND  COALESCE(sol.line_type, '') NOT IN ('bundle', 'bundle_child')
  LOOP
    v_lines := v_lines + 1;
    IF r.is_package_parent THEN
      bom_found := false;
      FOR bom_rec IN
        SELECT multiplier, component_skus, disabled_skus, sku_overrides
        FROM   pack_boms
        WHERE  package_sku = r.sku AND active = true
        LIMIT 1
      LOOP
        bom_found := true;
        overrides := CASE
          WHEN bom_rec.sku_overrides IS NULL OR bom_rec.sku_overrides = '' OR bom_rec.sku_overrides = '{}'
          THEN '{}'::jsonb
          ELSE bom_rec.sku_overrides::jsonb
        END;

        FOREACH comp_sku IN ARRAY COALESCE(bom_rec.component_skus, '{}') LOOP
          IF bom_rec.disabled_skus IS NOT NULL
             AND comp_sku = ANY(bom_rec.disabled_skus) THEN
            CONTINUE;
          END IF;
          meal_qty := COALESCE(
            (overrides ->> comp_sku)::numeric,
            bom_rec.multiplier::numeric
          ) * r.qty;
          v_committed := jsonb_set(
            v_committed,
            ARRAY[comp_sku],
            to_jsonb(COALESCE((v_committed ->> comp_sku)::numeric, 0) + meal_qty),
            true
          );
        END LOOP;
      END LOOP;
      IF NOT bom_found AND NOT (r.sku = ANY(missing_boms)) THEN
        missing_boms := missing_boms || r.sku;
      END IF;
    ELSE
      v_committed := jsonb_set(
        v_committed,
        ARRAY[r.sku],
        to_jsonb(COALESCE((v_committed ->> r.sku)::numeric, 0) + r.qty),
        true
      );
    END IF;
  END LOOP;

  RETURN json_build_object(
    'status',               'dry_run',
    'committed_quantities', v_committed,
    'unique_skus',          (SELECT COUNT(*) FROM jsonb_object_keys(v_committed)),
    'orders_scanned',       v_lines,
    'missing_boms',         missing_boms
  );
END;
$$;
