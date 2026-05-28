import { getSupabase, corsHeaders, json } from '../_shared/shopify.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders() });

  let body: { dry_run?: boolean } = {};
  try { body = await req.json(); } catch { /* empty body ok */ }
  const dryRun = !!body.dry_run;

  const supabase = getSupabase();
  const now = new Date().toISOString();
  const start = Date.now();

  // 1. Get IDs of all paid_unfulfilled sales orders
  const { data: paidOrders, error: ordersErr } = await supabase
    .from('sales_orders')
    .select('id')
    .eq('lifecycle_state', 'paid_unfulfilled');

  if (ordersErr) {
    return json({ status: 'error', error: ordersErr.message });
  }

  const paidOrderIds = (paidOrders || []).map((o: { id: string }) => o.id);

  // 2. Load all active BOMs so package parent lines can be decomposed inline.
  //    recalc-committed-stock is self-contained — it does not depend on
  //    recalc-demand having created component rows first.
  const { data: boms } = await supabase
    .from('pack_boms')
    .select('package_sku, multiplier, component_skus, disabled_skus, sku_overrides')
    .eq('active', true);

  const bomMap = new Map<string, {
    multiplier: number;
    component_skus: string[];
    disabled_skus: Set<string>;
    sku_overrides: Record<string, number>;
  }>();

  for (const b of boms || []) {
    let overrides: Record<string, number> = {};
    try { overrides = typeof b.sku_overrides === 'string' ? JSON.parse(b.sku_overrides) : (b.sku_overrides || {}); } catch { /* */ }
    bomMap.set(b.package_sku, {
      multiplier: Number(b.multiplier) || 1,
      component_skus: b.component_skus || [],
      disabled_skus: new Set(b.disabled_skus || []),
      sku_overrides: overrides,
    });
  }

  // 3. Sum committed quantities per SKU across all paid_unfulfilled orders.
  //    - Standalone lines (supplements, solo items): count SKU qty directly.
  //    - Package parent lines: decompose via BOM into component meal SKUs.
  //    - Skip is_package_component rows — those are derived rows we don't double-count.
  const committedBySku: Record<string, number> = {};

  if (paidOrderIds.length > 0) {
    const CHUNK = 500;
    for (let i = 0; i < paidOrderIds.length; i += CHUNK) {
      const chunk = paidOrderIds.slice(i, i + CHUNK);
      const { data: lines } = await supabase
        .from('sales_order_lines')
        .select('sku, qty, is_package_parent')
        .in('sales_order_id', chunk)
        .eq('is_package_component', false)
        .eq('status', 'active');

      for (const l of lines || []) {
        if (!l.sku) continue;
        const qty = Number(l.qty || 0);

        if (l.is_package_parent) {
          // Decompose meal pack into component SKUs using the current BOM
          const bom = bomMap.get(l.sku);
          if (bom) {
            for (const compSku of bom.component_skus) {
              if (bom.disabled_skus.has(compSku)) continue;
              const mealQty = (bom.sku_overrides[compSku] ?? bom.multiplier) * qty;
              committedBySku[compSku] = (committedBySku[compSku] || 0) + mealQty;
            }
          }
        } else {
          // Standalone item — commit the SKU directly
          committedBySku[l.sku] = (committedBySku[l.sku] || 0) + qty;
        }
      }
    }
  }

  const uniqueSkus = Object.keys(committedBySku).length;

  // 4. Dry run: return computed quantities without writing
  if (dryRun) {
    return json({
      status: 'dry_run',
      orders_processed: paidOrderIds.length,
      unique_skus: uniqueSkus,
      committed_quantities: committedBySku,
      elapsed_seconds: Number(((Date.now() - start) / 1000).toFixed(2)),
    });
  }

  // 5. Load all stock_on_hand rows that have a product_sku
  const { data: allSoh } = await supabase
    .from('stock_on_hand')
    .select('id, product_sku, qty_on_hand, qty_committed');

  if (!allSoh?.length) {
    return json({
      status: 'completed',
      orders_processed: paidOrderIds.length,
      unique_skus: uniqueSkus,
      stock_rows_updated: 0,
      elapsed_seconds: Number(((Date.now() - start) / 1000).toFixed(2)),
    });
  }

  // 6. Build the update list — only rows where qty_committed actually changes
  const updates: Array<{ id: string; qty_committed: number; qty_available: number; updated_date: string }> = [];

  for (const row of allSoh) {
    if (!row.product_sku) continue;
    const newCommitted = committedBySku[row.product_sku] || 0;
    const onHand = Number(row.qty_on_hand || 0);
    const newAvailable = Math.max(0, onHand - newCommitted);

    if (Number(row.qty_committed) !== newCommitted) {
      updates.push({
        id: row.id,
        qty_committed: newCommitted,
        qty_available: newAvailable,
        updated_date: now,
      });
    }
  }

  // 7. Write updates in batches of 500
  let stockRowsUpdated = 0;
  const errors: string[] = [];
  const UPDATE_CHUNK = 500;

  for (let i = 0; i < updates.length; i += UPDATE_CHUNK) {
    const batch = updates.slice(i, i + UPDATE_CHUNK);
    const { error } = await supabase
      .from('stock_on_hand')
      .upsert(batch, { onConflict: 'id' });
    if (error) {
      errors.push(error.message);
    } else {
      stockRowsUpdated += batch.length;
    }
  }

  console.log(
    `[recalc-committed-stock] orders=${paidOrderIds.length} skus=${uniqueSkus} updated=${stockRowsUpdated} errors=${errors.length} dry=${dryRun} elapsed=${((Date.now() - start) / 1000).toFixed(2)}s`
  );

  return json({
    status: errors.length ? 'completed_with_errors' : 'completed',
    orders_processed: paidOrderIds.length,
    unique_skus: uniqueSkus,
    stock_rows_updated: stockRowsUpdated,
    errors: errors.length ? errors : undefined,
    elapsed_seconds: Number(((Date.now() - start) / 1000).toFixed(2)),
  });
});
