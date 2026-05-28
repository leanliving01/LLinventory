-- Ensure qty_committed and qty_available columns exist on stock_on_hand
ALTER TABLE stock_on_hand
  ADD COLUMN IF NOT EXISTS qty_committed numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS qty_available numeric NOT NULL DEFAULT 0;

-- RPC: recalc_committed_stock()
-- Recomputes qty_committed and qty_available for all products based on
-- current paid_unfulfilled sales orders + pack_boms decomposition.
-- Returns { rows_written, unique_skus, errors[] }
CREATE OR REPLACE FUNCTION recalc_committed_stock()
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_committed   jsonb    := '{}'::jsonb;
  v_written     int      := 0;
  v_errors      text[]   := '{}';
  r             RECORD;
  bom_rec       RECORD;
  comp_sku      text;
  meal_qty      numeric;
  new_committed numeric;
  new_available numeric;
BEGIN

  -- Step 1: Walk every active non-component line on paid_unfulfilled orders
  FOR r IN
    SELECT sol.sku, sol.qty, sol.is_package_parent
    FROM   sales_order_lines sol
    JOIN   sales_orders so ON so.id = sol.sales_order_id
    WHERE  so.lifecycle_state    = 'paid_unfulfilled'
      AND  sol.is_package_component = false
      AND  sol.status              = 'active'
      AND  sol.sku IS NOT NULL
  LOOP
    IF r.is_package_parent THEN
      -- Decompose meal pack into component SKUs using the current BOM
      FOR bom_rec IN
        SELECT multiplier, component_skus, disabled_skus, sku_overrides
        FROM   pack_boms
        WHERE  package_sku = r.sku
          AND  active = true
        LIMIT 1
      LOOP
        FOREACH comp_sku IN ARRAY COALESCE(bom_rec.component_skus, '{}') LOOP
          -- Skip disabled SKUs
          IF bom_rec.disabled_skus IS NOT NULL
             AND comp_sku = ANY(bom_rec.disabled_skus) THEN
            CONTINUE;
          END IF;
          -- Override qty or use multiplier
          meal_qty := COALESCE(
            (bom_rec.sku_overrides->>comp_sku)::numeric,
            bom_rec.multiplier::numeric
          ) * r.qty;
          v_committed := jsonb_set(
            v_committed,
            ARRAY[comp_sku],
            to_jsonb(COALESCE((v_committed->>comp_sku)::numeric, 0) + meal_qty),
            true
          );
        END LOOP;
      END LOOP;
    ELSE
      -- Standalone item (supplement, solo serve, etc.)
      v_committed := jsonb_set(
        v_committed,
        ARRAY[r.sku],
        to_jsonb(COALESCE((v_committed->>r.sku)::numeric, 0) + r.qty),
        true
      );
    END IF;
  END LOOP;

  -- Step 2: Update stock_on_hand rows via products JOIN (reliable product_id lookup)
  FOR r IN
    SELECT soh.id,
           soh.qty_on_hand,
           soh.qty_committed AS old_committed,
           p.sku
    FROM   stock_on_hand soh
    JOIN   products p ON p.id = soh.product_id
    WHERE  p.sku IS NOT NULL
  LOOP
    new_committed := COALESCE((v_committed->>r.sku)::numeric, 0);
    new_available := GREATEST(0, COALESCE(r.qty_on_hand, 0) - new_committed);

    IF COALESCE(r.old_committed, 0) != new_committed THEN
      UPDATE stock_on_hand
         SET qty_committed = new_committed,
             qty_available = new_available,
             updated_date  = now()
       WHERE id = r.id;
      v_written := v_written + 1;
    END IF;
  END LOOP;

  RETURN json_build_object(
    'status',       'completed',
    'rows_written', v_written,
    'unique_skus',  jsonb_object_keys(v_committed)::text,
    'errors',       v_errors
  );
END;
$$;

-- Dry-run variant: returns computed values without writing anything
CREATE OR REPLACE FUNCTION recalc_committed_stock_dry_run()
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_committed jsonb := '{}'::jsonb;
  r           RECORD;
  bom_rec     RECORD;
  comp_sku    text;
  meal_qty    numeric;
  v_orders    int := 0;
BEGIN
  FOR r IN
    SELECT sol.sku, sol.qty, sol.is_package_parent,
           so.id AS order_id
    FROM   sales_order_lines sol
    JOIN   sales_orders so ON so.id = sol.sales_order_id
    WHERE  so.lifecycle_state     = 'paid_unfulfilled'
      AND  sol.is_package_component = false
      AND  sol.status               = 'active'
      AND  sol.sku IS NOT NULL
  LOOP
    v_orders := v_orders + 1;
    IF r.is_package_parent THEN
      FOR bom_rec IN
        SELECT multiplier, component_skus, disabled_skus, sku_overrides
        FROM   pack_boms
        WHERE  package_sku = r.sku AND active = true
        LIMIT 1
      LOOP
        FOREACH comp_sku IN ARRAY COALESCE(bom_rec.component_skus, '{}') LOOP
          IF bom_rec.disabled_skus IS NOT NULL
             AND comp_sku = ANY(bom_rec.disabled_skus) THEN
            CONTINUE;
          END IF;
          meal_qty := COALESCE(
            (bom_rec.sku_overrides->>comp_sku)::numeric,
            bom_rec.multiplier::numeric
          ) * r.qty;
          v_committed := jsonb_set(
            v_committed,
            ARRAY[comp_sku],
            to_jsonb(COALESCE((v_committed->>comp_sku)::numeric, 0) + meal_qty),
            true
          );
        END LOOP;
      END LOOP;
    ELSE
      v_committed := jsonb_set(
        v_committed,
        ARRAY[r.sku],
        to_jsonb(COALESCE((v_committed->>r.sku)::numeric, 0) + r.qty),
        true
      );
    END IF;
  END LOOP;

  RETURN json_build_object(
    'status',               'dry_run',
    'committed_quantities', v_committed,
    'unique_skus',          (SELECT COUNT(*) FROM jsonb_object_keys(v_committed)),
    'orders_scanned',       v_orders
  );
END;
$$;
