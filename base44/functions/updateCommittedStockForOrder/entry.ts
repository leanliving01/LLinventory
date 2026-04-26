import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * §7C — Real-time Committed Stock Update (per order)
 *
 * Triggered by entity automation on SalesOrder create/update.
 * Performs a FULL recalc of committed stock across all open orders
 * but using the optimised bulk-load approach (same as nightly).
 *
 * This ensures accuracy: if an order moves from paid_unfulfilled
 * to fulfilled/cancelled, ALL SKU totals are recomputed correctly.
 */

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function withRetry(fn, retries = 4) {
  for (let i = 0; i < retries; i++) {
    try { return await fn(); }
    catch (err) {
      if ((err.status === 429 || err.message?.includes('rate limit')) && i < retries - 1) {
        await sleep((i + 1) * 3000);
      } else { throw err; }
    }
  }
}

async function fetchAll(entityRef, filter = {}, pageSize = 100) {
  const all = [];
  let offset = 0;
  while (true) {
    const page = await withRetry(() => entityRef.filter(filter, '-created_date', pageSize, offset));
    all.push(...page);
    if (page.length < pageSize) break;
    offset += pageSize;
    await sleep(300);
  }
  return all;
}

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);

  // Entity automations run with admin context — verify
  const user = await base44.auth.me();
  if (!user || user.role !== 'admin') {
    return Response.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const event = body.event || {};
  const orderData = body.data || {};

  console.log(`[CommittedStock:RT] Triggered by ${event.type} on order ${orderData.order_number || event.entity_id}`);

  // ── 1. Load all paid_unfulfilled orders ──
  const openOrders = await fetchAll(base44.asServiceRole.entities.SalesOrder, { lifecycle_state: 'paid_unfulfilled' });
  const openOrderIds = new Set(openOrders.map(o => o.id));

  // ── 2. Bulk-load ALL SalesOrderLines ──
  const allLines = await fetchAll(base44.asServiceRole.entities.SalesOrderLine);

  // ── 3. Aggregate committed by SKU ──
  const committedBySku = {};
  for (const line of allLines) {
    if (!openOrderIds.has(line.sales_order_id)) continue;
    if (line.is_package_parent) continue;
    if (line.status !== 'active') continue;
    if (!line.sku) continue;
    const unfulfilledQty = Math.max(0, (line.qty || 0) - (line.fulfilled_qty || 0));
    if (unfulfilledQty <= 0) continue;
    committedBySku[line.sku] = (committedBySku[line.sku] || 0) + unfulfilledQty;
  }

  const skuList = Object.keys(committedBySku);
  console.log(`[CommittedStock:RT] ${openOrders.length} open orders, ${skuList.length} SKUs with demand`);

  // ── 4. Load products, dispatch location, existing SOH in parallel ──
  const [allProducts, locations, existingSoh] = await Promise.all([
    fetchAll(base44.asServiceRole.entities.Product, { status: 'active' }),
    withRetry(() => base44.asServiceRole.entities.Location.filter({ code: 'DISPATCH' })),
    fetchAll(base44.asServiceRole.entities.StockOnHand),
  ]);

  const productBySku = {};
  for (const p of allProducts) { if (p.sku) productBySku[p.sku] = p; }

  const dispatchId = locations.length > 0 ? locations[0].id : '';
  const dispatchName = locations.length > 0 ? locations[0].name : 'Dispatch';

  const dispatchSoh = dispatchId ? existingSoh.filter(s => s.location_id === dispatchId) : existingSoh;
  const sohByProductId = {};
  for (const soh of dispatchSoh) sohByProductId[soh.product_id] = soh;

  // ── 5. Build SOH operations ──
  const updatedProductIds = new Set();
  const sohOps = [];

  for (const sku of skuList) {
    const product = productBySku[sku];
    if (!product) continue;
    const committed = committedBySku[sku];
    const existing = sohByProductId[product.id];
    updatedProductIds.add(product.id);

    if (existing) {
      // Only update if value actually changed
      if (existing.qty_committed !== committed) {
        sohOps.push({ type: 'update', id: existing.id, data: {
          qty_committed: committed,
          qty_available: (existing.qty_on_hand || 0) - committed,
          last_updated_at: new Date().toISOString(),
        }});
      }
    } else {
      sohOps.push({ type: 'create', data: {
        product_id: product.id, product_sku: sku, product_name: product.name,
        location_id: dispatchId, location_name: dispatchName,
        qty_on_hand: 0, qty_committed: committed, qty_available: -committed,
        uom: product.stock_uom || 'pcs', last_updated_at: new Date().toISOString(),
      }});
    }
  }

  // Zero out products no longer in demand
  for (const soh of dispatchSoh) {
    if (!updatedProductIds.has(soh.product_id) && soh.qty_committed > 0) {
      sohOps.push({ type: 'update', id: soh.id, data: {
        qty_committed: 0, qty_available: soh.qty_on_hand || 0,
        last_updated_at: new Date().toISOString(),
      }});
    }
  }

  // ── 6. Execute in batches of 5 ──
  let updated = 0, created = 0;
  for (let i = 0; i < sohOps.length; i += 5) {
    const batch = sohOps.slice(i, i + 5);
    await Promise.all(batch.map(op => {
      if (op.type === 'update') { updated++; return withRetry(() => base44.asServiceRole.entities.StockOnHand.update(op.id, op.data)); }
      else { created++; return withRetry(() => base44.asServiceRole.entities.StockOnHand.create(op.data)); }
    }));
    await sleep(400);
  }

  console.log(`[CommittedStock:RT] Done — ${sohOps.length} SOH ops (${updated} updated, ${created} created)`);

  return Response.json({
    status: 'success',
    trigger: `${event.type} on ${orderData.order_number || event.entity_id}`,
    open_orders: openOrders.length,
    skus_with_demand: skuList.length,
    soh_ops: sohOps.length,
  });
});