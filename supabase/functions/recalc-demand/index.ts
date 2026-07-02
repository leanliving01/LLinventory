import { getSupabase, corsHeaders, json } from '../_shared/shopify.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders() });

  let body: { force_package_sku?: string } = {};
  try { body = await req.json(); } catch { /* empty body ok */ }

  const supabase = getSupabase();
  const now = new Date().toISOString();

  // If a specific package SKU is provided, reset demand_calculated for all orders
  // that contain this SKU so they get re-decomposed with the latest BOM.
  if (body.force_package_sku) {
    const { data: matchingLines } = await supabase
      .from('shopify_order_lines')
      .select('shopify_order_id')
      .eq('sku', body.force_package_sku);

    const idsToReset = [...new Set((matchingLines || []).map((l: { shopify_order_id: string }) => l.shopify_order_id))];
    if (idsToReset.length) {
      await supabase
        .from('shopify_orders')
        .update({ demand_calculated: false, updated_date: now })
        .in('id', idsToReset);
      console.log(`[recalc-demand] force_package_sku=${body.force_package_sku} — reset ${idsToReset.length} orders`);
    }
  }

  // 1. Load all active pack BOMs
  const { data: boms } = await supabase
    .from('pack_boms')
    .select('package_sku, package_type, multiplier, component_skus, disabled_skus, sku_overrides')
    .eq('active', true);

  const bomMap = new Map<string, {
    package_type: string;
    multiplier: number;
    component_skus: string[];
    disabled_skus: string[];
    sku_overrides: Record<string, number>;
  }>();

  for (const b of boms || []) {
    let overrides: Record<string, number> = {};
    try { overrides = typeof b.sku_overrides === 'string' ? JSON.parse(b.sku_overrides) : (b.sku_overrides || {}); } catch { /* */ }
    bomMap.set(b.package_sku, {
      package_type: b.package_type,
      multiplier: Number(b.multiplier) || 1,
      component_skus: b.component_skus || [],
      disabled_skus: b.disabled_skus || [],
      sku_overrides: overrides,
    });
  }

  // 2. Find orders needing decomposition (batch 200 at a time)
  const { data: pendingOrders } = await supabase
    .from('shopify_orders')
    .select('id, shopify_order_id')
    .eq('demand_calculated', false)
    .limit(200);

  if (!pendingOrders?.length) {
    return json({ status: 'completed', processed: 0, message: 'No pending orders' });
  }

  const shopifyOrderIds = pendingOrders.map(o => o.id);

  // 3. Load their Shopify line items
  const { data: allLines } = await supabase
    .from('shopify_order_lines')
    .select('shopify_order_id, sku, quantity, product_title, variant_title')
    .in('shopify_order_id', shopifyOrderIds);

  // Group lines by shopify_order_id (our internal UUID)
  const linesByOrder = new Map<string, typeof allLines>();
  for (const l of allLines || []) {
    const arr = linesByOrder.get(l.shopify_order_id) || [];
    arr.push(l);
    linesByOrder.set(l.shopify_order_id, arr);
  }

  // 4. Load matching sales_orders (by shopify_order_id string)
  const rawShopifyIds = pendingOrders.map(o => o.shopify_order_id).filter(Boolean);
  const { data: salesOrders } = await supabase
    .from('sales_orders')
    .select('id, shopify_order_id')
    .in('shopify_order_id', rawShopifyIds);

  const salesOrderMap = new Map<string, string>(); // shopify_order_id (string) → sales_order.id
  for (const s of salesOrders || []) salesOrderMap.set(s.shopify_order_id, s.id);

  // 5. Load parent lines in sales_order_lines for these sales_orders
  const salesIds = (salesOrders || []).map(s => s.id);
  const { data: parentLines } = salesIds.length
    ? await supabase
        .from('sales_order_lines')
        .select('id, sales_order_id, sku')
        .in('sales_order_id', salesIds)
        .eq('is_package_parent', true)
    : { data: [] };

  // Map: `${salesOrderId}:${sku}` → line id
  const parentLineMap = new Map<string, string>();
  for (const p of parentLines || []) parentLineMap.set(`${p.sales_order_id}:${p.sku}`, p.id);

  // 6. Process each order
  let processed = 0;
  const shopifyUpdates: Array<{ id: string; payload: Record<string, unknown> }> = [];
  const salesDecompStatus: Array<{ id: string }> = [];
  const componentLinesToInsert: Record<string, unknown>[] = [];
  const salesOrderIdsToClean: string[] = [];

  function mealCategory(sku: string, packageType: string): string {
    if (packageType === 'low_carb') return 'lc';
    if (packageType === 'byo') return 'byo';
    const prefix = sku.substring(0, 3).toUpperCase();
    if (prefix === 'MWL') return 'mwl';
    if (prefix === 'MLM') return 'mlm';
    if (prefix === 'WWL') return 'wwl';
    if (prefix === 'WLM') return 'wlm';
    return 'other';
  }

  for (const order of pendingOrders) {
    const orderLines = linesByOrder.get(order.id) || [];
    const salesOrderId = salesOrderMap.get(order.shopify_order_id);

    // `other` catches every non-variant range (e.g. Winter Warmer WWR meals) so
    // they're included in total_meals — previously they exploded for stock but
    // were silently dropped from the dashboard totals.
    const counts = { mwl: 0, mlm: 0, wwl: 0, wlm: 0, lc: 0, byo: 0, other: 0 };

    for (const line of orderLines) {
      const bom = bomMap.get(line.sku);
      if (!bom) continue;

      const disabledSet = new Set(bom.disabled_skus);
      const orderQty = Number(line.quantity) || 1;

      for (const componentSku of bom.component_skus) {
        if (disabledSet.has(componentSku)) continue;
        const mealQty = (bom.sku_overrides[componentSku] ?? bom.multiplier) * orderQty;
        const cat = mealCategory(componentSku, bom.package_type);
        if (cat in counts) (counts as Record<string, number>)[cat] += mealQty;

        // Queue component line for sales_order_lines
        if (salesOrderId) {
          const parentLineId = parentLineMap.get(`${salesOrderId}:${line.sku}`) || null;
          componentLinesToInsert.push({
            id: crypto.randomUUID(),
            sales_order_id: salesOrderId,
            external_id: `${order.shopify_order_id}-${line.sku}-${componentSku}`,
            sku: componentSku,
            name: componentSku,
            variant_title: null,
            qty: mealQty,
            unit_price: 0,
            line_total: 0,
            is_package_parent: false,
            is_package_component: true,
            parent_line_id: parentLineId,
            line_type: 'standalone',
            status: 'active',
            source_platform: 'shopify',
            last_synced_at: now,
            created_date: now,
            updated_date: now,
          });
        }
      }
    }

    const totalMeals = counts.mwl + counts.mlm + counts.wwl + counts.wlm + counts.lc + counts.byo + counts.other;

    shopifyUpdates.push({
      id: order.id,
      payload: {
        mwl_meals: counts.mwl,
        mlm_meals: counts.mlm,
        wwl_meals: counts.wwl,
        wlm_meals: counts.wlm,
        lc_meals: counts.lc,
        byo_meals: counts.byo,
        other_meals: counts.other,
        total_meals: totalMeals,
        demand_calculated: true,
        updated_date: now,
      },
    });

    if (salesOrderId) {
      salesOrderIdsToClean.push(salesOrderId);
      salesDecompStatus.push({ id: salesOrderId });
    }

    processed++;
  }

  // 7. Apply updates
  // Clear old component lines for these sales_orders
  if (salesOrderIdsToClean.length) {
    await supabase
      .from('sales_order_lines')
      .delete()
      .in('sales_order_id', salesOrderIdsToClean)
      .eq('is_package_component', true);
  }

  // Insert new component lines (upsert-ignore so a concurrent re-import racing
  // the delete above can't duplicate or error against the unique index on
  // (sales_order_id, external_id) — migration 103).
  if (componentLinesToInsert.length) {
    const { error: compErr } = await supabase.from('sales_order_lines')
      .upsert(componentLinesToInsert, { onConflict: 'sales_order_id,external_id', ignoreDuplicates: true });
    if (compErr) console.error('Component lines upsert error:', compErr.message);
  }

  // Update shopify_orders
  for (const u of shopifyUpdates) {
    await supabase.from('shopify_orders').update(u.payload).eq('id', u.id);
  }

  // Update sales_orders decomposition_status
  for (const s of salesDecompStatus) {
    await supabase.from('sales_orders').update({ decomposition_status: 'done', updated_date: now }).eq('id', s.id);
  }

  // 8. Backfill component lines for any sales_order parent lines that still have none
  //    (covers orders that exist in sales_orders but not in shopify_orders)
  await supabase.rpc('backfill_missing_components');

  // Chain if more remain
  const { count } = await supabase
    .from('shopify_orders')
    .select('id', { count: 'exact', head: true })
    .eq('demand_calculated', false);

  return json({
    status: (count || 0) > 0 ? 'partial' : 'completed',
    processed,
    remaining: count || 0,
  });
});
