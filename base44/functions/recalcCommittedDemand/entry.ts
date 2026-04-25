import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * Step 5 — Committed Demand Recalculation
 *
 * Scans all paid_unfulfilled SalesOrders, sums decomposed component-line
 * quantities by product SKU, then writes qty_committed + qty_available
 * on each product's StockOnHand row at the DISPATCH location.
 *
 * Called on-demand from the dashboard or on a schedule.
 */

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me();
  if (!user || user.role !== 'admin') {
    return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
  }

  console.log('[CommittedDemand] Starting recalculation…');

  // ── 1. Load paid-unfulfilled orders ──
  const openOrders = await base44.asServiceRole.entities.SalesOrder.filter({ lifecycle_state: 'paid_unfulfilled' });
  console.log(`[CommittedDemand] ${openOrders.length} paid_unfulfilled orders`);

  if (openOrders.length === 0) {
    // Zero out all committed demand since there are no open orders
    const allSoh = await base44.asServiceRole.entities.StockOnHand.filter({});
    let zeroed = 0;
    for (const soh of allSoh) {
      if (soh.qty_committed > 0) {
        await base44.asServiceRole.entities.StockOnHand.update(soh.id, {
          qty_committed: 0,
          qty_available: soh.qty_on_hand || 0,
          last_updated_at: new Date().toISOString(),
        });
        zeroed++;
      }
    }
    console.log(`[CommittedDemand] No open orders — zeroed ${zeroed} StockOnHand rows`);
    return Response.json({ ok: true, open_orders: 0, skus_committed: 0, zeroed });
  }

  // ── 2. Load ALL component lines for these orders in bulk ──
  // We batch by order to stay within filter limits
  const committedBySku = {}; // sku → total qty

  for (const order of openOrders) {
    const lines = await base44.asServiceRole.entities.SalesOrderLine.filter({
      sales_order_id: order.id,
    });

    for (const line of lines) {
      // Only count component & standalone lines, skip package parents
      if (line.is_package_parent) continue;
      if (line.status !== 'active') continue;

      const sku = line.sku;
      if (!sku) continue;

      committedBySku[sku] = (committedBySku[sku] || 0) + (line.qty || 0);
    }
  }

  const skuList = Object.keys(committedBySku);
  console.log(`[CommittedDemand] ${skuList.length} unique SKUs with committed demand`);

  // ── 3. Resolve products by SKU ──
  const productBySku = {};
  for (const sku of skuList) {
    const products = await base44.asServiceRole.entities.Product.filter({ sku });
    if (products.length > 0) {
      productBySku[sku] = products[0];
    } else {
      console.log(`[CommittedDemand] WARNING: Product not found for SKU ${sku}`);
    }
  }

  // ── 4. Get DISPATCH location ──
  const locations = await base44.asServiceRole.entities.Location.filter({ code: 'DISPATCH' });
  const dispatchId = locations.length > 0 ? locations[0].id : '';
  const dispatchName = locations.length > 0 ? locations[0].name : 'Dispatch';

  if (!dispatchId) {
    console.log('[CommittedDemand] WARNING: No DISPATCH location found');
  }

  // ── 5. Load all existing StockOnHand rows for DISPATCH ──
  const existingSoh = await base44.asServiceRole.entities.StockOnHand.filter(
    dispatchId ? { location_id: dispatchId } : {}
  );
  const sohByProductId = {};
  for (const soh of existingSoh) {
    sohByProductId[soh.product_id] = soh;
  }

  // ── 6. Update or create StockOnHand committed values ──
  const updatedProductIds = new Set();
  let updated = 0;
  let created = 0;

  for (const sku of skuList) {
    const product = productBySku[sku];
    if (!product) continue;

    const committed = committedBySku[sku];
    const existing = sohByProductId[product.id];
    updatedProductIds.add(product.id);

    if (existing) {
      const onHand = existing.qty_on_hand || 0;
      await base44.asServiceRole.entities.StockOnHand.update(existing.id, {
        qty_committed: committed,
        qty_available: onHand - committed,
        last_updated_at: new Date().toISOString(),
      });
      updated++;
    } else {
      // Create a new StockOnHand row (on_hand will be 0 until stock rebuild runs)
      await base44.asServiceRole.entities.StockOnHand.create({
        product_id: product.id,
        product_sku: sku,
        product_name: product.name,
        location_id: dispatchId,
        location_name: dispatchName,
        qty_on_hand: 0,
        qty_committed: committed,
        qty_available: -committed,
        uom: product.stock_uom || 'pcs',
        last_updated_at: new Date().toISOString(),
      });
      created++;
    }
  }

  // ── 7. Zero out committed for products no longer in open orders ──
  let zeroed = 0;
  for (const soh of existingSoh) {
    if (!updatedProductIds.has(soh.product_id) && soh.qty_committed > 0) {
      await base44.asServiceRole.entities.StockOnHand.update(soh.id, {
        qty_committed: 0,
        qty_available: soh.qty_on_hand || 0,
        last_updated_at: new Date().toISOString(),
      });
      zeroed++;
    }
  }

  console.log(`[CommittedDemand] Done — updated ${updated}, created ${created}, zeroed ${zeroed}`);

  // ── Audit log ──
  await base44.asServiceRole.entities.AuditLog.create({
    action: 'sync',
    entity_type: 'StockOnHand',
    description: `Committed demand recalc: ${openOrders.length} orders → ${skuList.length} SKUs committed. Updated ${updated}, created ${created}, zeroed ${zeroed}.`,
  }).catch(() => {});

  return Response.json({
    ok: true,
    open_orders: openOrders.length,
    skus_committed: skuList.length,
    updated,
    created,
    zeroed,
    top_committed: Object.entries(committedBySku)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 15)
      .map(([sku, qty]) => ({ sku, qty })),
  });
});