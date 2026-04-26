import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * §7C — Single Source of Truth for Committed Stock (Full Recalc)
 *
 * Scans all paid_unfulfilled SalesOrders + their SalesOrderLines.
 * Aggregates decomposed component & standalone line quantities by SKU.
 * Writes:
 *   1. StockOnHand.qty_committed + qty_available at DISPATCH location
 *   2. CommittedDemand audit records (per order × SKU for drill-down)
 *
 * Modes:
 *   action='preview' — read-only, returns data for Demand Audit page
 *   action='commit'  — writes StockOnHand + CommittedDemand, returns same data
 *
 * OPTIMISED: Bulk-loads ALL SalesOrderLines in one paginated fetch
 * instead of per-order queries — reduces API calls from N+1 to ~3.
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

/** Paginated fetch — loads ALL records for a filter using offset pagination */
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
  const user = await base44.auth.me();
  if (!user || user.role !== 'admin') {
    return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const action = body.action || 'commit';

  console.log(`[CommittedDemand] Starting (mode=${action})…`);

  // ── 1. Load paid-unfulfilled orders ──
  const openOrders = await fetchAll(base44.asServiceRole.entities.SalesOrder, { lifecycle_state: 'paid_unfulfilled' });
  console.log(`[CommittedDemand] ${openOrders.length} paid_unfulfilled orders`);

  const orderById = {};
  for (const o of openOrders) orderById[o.id] = o;
  const openOrderIds = new Set(openOrders.map(o => o.id));

  // ── 2. Bulk-load ALL SalesOrderLines (single paginated fetch) ──
  const allLines = await fetchAll(base44.asServiceRole.entities.SalesOrderLine);
  console.log(`[CommittedDemand] ${allLines.length} total SalesOrderLines loaded`);

  // Group lines by order
  const linesByOrder = {};
  for (const line of allLines) {
    if (!openOrderIds.has(line.sales_order_id)) continue;
    if (!linesByOrder[line.sales_order_id]) linesByOrder[line.sales_order_id] = [];
    linesByOrder[line.sales_order_id].push(line);
  }

  // ── 3. Aggregate demand ──
  const committedBySku = {};
  const orderBreakdowns = [];
  const demandRecords = [];
  const warnings = [];

  for (const order of openOrders) {
    const lines = linesByOrder[order.id] || [];

    const parentLineById = {};
    for (const line of lines) {
      if (line.is_package_parent) parentLineById[line.id] = line;
    }

    const orderDemandItems = [];
    let orderTotalLines = 0;

    for (const line of lines) {
      if (line.is_package_parent) continue;
      if (line.status !== 'active') continue;
      const sku = line.sku;
      if (!sku) continue;

      const unfulfilledQty = Math.max(0, (line.qty || 0) - (line.fulfilled_qty || 0));
      if (unfulfilledQty <= 0) continue;

      committedBySku[sku] = (committedBySku[sku] || 0) + unfulfilledQty;
      orderTotalLines++;

      let family = 'standalone';
      if (line.is_package_component && line.parent_line_id) {
        const parent = parentLineById[line.parent_line_id];
        const parentType = parent?.line_type || '';
        if (parentType === 'low_carb_package') {
          family = 'LOW_CARB';
        } else if (parentType === 'goal_package') {
          const pw = line.portion_weight_g;
          if (pw === 330) family = 'MLM';
          else if (pw === 300) family = 'MWL';
          else if (pw === 260) family = 'WWL';
          else if (pw === 240) family = 'WLM';
          else family = 'MLM';
        }
      } else if (line.line_type === 'byo') {
        family = 'BYO';
      }

      orderDemandItems.push({ family, sku, sku_name: line.name || sku, quantity: unfulfilledQty, portion_weight_g: line.portion_weight_g || null });

      demandRecords.push({
        date: new Date().toISOString().split('T')[0],
        sku_id: sku, sku_display_name: line.name || sku,
        quantity: unfulfilledQty, source_order_id: order.id,
        demand_type: line.line_type === 'byo' ? 'byo' : 'fixed_pack',
        _family: family,
      });
    }

    if (orderTotalLines > 0) {
      const fc = { MWL: 0, MLM: 0, WWL: 0, WLM: 0, LOW_CARB: 0, BYO: 0, standalone: 0 };
      orderDemandItems.forEach(d => { fc[d.family] = (fc[d.family] || 0) + d.quantity; });
      orderBreakdowns.push({
        order_number: order.order_number || order.shopify_order_id,
        customer_name: order.customer_name || '',
        mwl: fc.MWL, mlm: fc.MLM, wwl: fc.WWL, wlm: fc.WLM, lc: fc.LOW_CARB, byo: fc.BYO,
        total_demand_lines: orderTotalLines, demand_items: orderDemandItems,
      });
    }
  }

  // ── 4. Build summaries ──
  const skuList = Object.keys(committedBySku);
  const demandBySku = skuList
    .map(sku => ({ sku_id: sku, sku_display_name: sku, total: committedBySku[sku] }))
    .sort((a, b) => b.total - a.total);
  for (const d of demandBySku) {
    const match = demandRecords.find(r => r.sku_id === d.sku_id);
    if (match) d.sku_display_name = match.sku_display_name;
  }

  const demandByFamily = { MWL: 0, MLM: 0, WWL: 0, WLM: 0, LOW_CARB: 0, BYO: 0 };
  demandRecords.forEach(d => {
    if (demandByFamily[d._family] !== undefined) demandByFamily[d._family] += d.quantity;
  });

  console.log(`[CommittedDemand] ${skuList.length} unique SKUs, ${demandRecords.length} demand lines from ${orderBreakdowns.length} orders`);

  const responseData = {
    action, total_orders: openOrders.length, orders_with_demand: orderBreakdowns.length,
    total_demand_records: demandRecords.length, demand_by_family: demandByFamily,
    demand_by_sku: demandBySku, order_breakdowns: orderBreakdowns, warnings, skus_committed: skuList.length,
  };

  if (action === 'preview') return Response.json(responseData);

  // ═══ COMMIT MODE ═══

  // ── 5. Load products + dispatch + SOH in parallel ──
  const [allProducts, locations, existingSoh] = await Promise.all([
    fetchAll(base44.asServiceRole.entities.Product, { status: 'active' }),
    withRetry(() => base44.asServiceRole.entities.Location.filter({ code: 'DISPATCH' })),
    fetchAll(base44.asServiceRole.entities.StockOnHand),
  ]);

  const productBySku = {};
  for (const p of allProducts) { if (p.sku) productBySku[p.sku] = p; }
  const unmatchedSkus = skuList.filter(s => !productBySku[s]);
  if (unmatchedSkus.length > 0) warnings.push(`Products not found for SKUs: ${unmatchedSkus.join(', ')}`);

  const dispatchId = locations.length > 0 ? locations[0].id : '';
  const dispatchName = locations.length > 0 ? locations[0].name : 'Dispatch';
  if (!dispatchId) warnings.push('No DISPATCH location found');

  // Filter SOH to dispatch location
  const dispatchSoh = dispatchId ? existingSoh.filter(s => s.location_id === dispatchId) : existingSoh;
  const sohByProductId = {};
  for (const soh of dispatchSoh) sohByProductId[soh.product_id] = soh;

  // ── 6. Update StockOnHand.qty_committed (batched with throttle) ──
  const updatedProductIds = new Set();
  let sohUpdated = 0, sohCreated = 0;

  // Collect all updates/creates, then execute in small batches
  const sohOps = [];
  for (const sku of skuList) {
    const product = productBySku[sku];
    if (!product) continue;
    const committed = committedBySku[sku];
    const existing = sohByProductId[product.id];
    updatedProductIds.add(product.id);

    if (existing) {
      sohOps.push({ type: 'update', id: existing.id, data: { qty_committed: committed, qty_available: (existing.qty_on_hand || 0) - committed, last_updated_at: new Date().toISOString() } });
    } else {
      sohOps.push({ type: 'create', data: { product_id: product.id, product_sku: sku, product_name: product.name, location_id: dispatchId, location_name: dispatchName, qty_on_hand: 0, qty_committed: committed, qty_available: -committed, uom: product.stock_uom || 'pcs', last_updated_at: new Date().toISOString() } });
    }
  }

  // Zero out committed for products no longer in demand
  for (const soh of dispatchSoh) {
    if (!updatedProductIds.has(soh.product_id) && soh.qty_committed > 0) {
      sohOps.push({ type: 'update', id: soh.id, data: { qty_committed: 0, qty_available: soh.qty_on_hand || 0, last_updated_at: new Date().toISOString() } });
    }
  }

  // Execute in batches of 5 concurrent ops
  const BATCH_SIZE = 5;
  for (let i = 0; i < sohOps.length; i += BATCH_SIZE) {
    const batch = sohOps.slice(i, i + BATCH_SIZE);
    await Promise.all(batch.map(op => {
      if (op.type === 'update') {
        if (op.data.qty_committed === 0) { sohUpdated++; /* counted as zeroed below */ }
        else sohUpdated++;
        return withRetry(() => base44.asServiceRole.entities.StockOnHand.update(op.id, op.data));
      } else {
        sohCreated++;
        return withRetry(() => base44.asServiceRole.entities.StockOnHand.create(op.data));
      }
    }));
    await sleep(500);
  }

  const sohZeroed = sohOps.filter(o => o.type === 'update' && o.data.qty_committed === 0).length;
  sohUpdated -= sohZeroed; // separate counts

  // ── 7. Refresh CommittedDemand audit records ──
  const refreshAudit = body.refresh_audit !== false;
  let oldDemandDeleted = 0, newDemandCreated = 0;

  if (refreshAudit) {
    const existingDemand = await fetchAll(base44.asServiceRole.entities.CommittedDemand);
    // Delete in batches of 5
    for (let i = 0; i < existingDemand.length; i += BATCH_SIZE) {
      const batch = existingDemand.slice(i, i + BATCH_SIZE);
      await Promise.all(batch.map(d => withRetry(() => base44.asServiceRole.entities.CommittedDemand.delete(d.id))));
      await sleep(500);
    }
    oldDemandDeleted = existingDemand.length;

    const cleanRecords = demandRecords.map(({ _family, ...rest }) => rest);
    for (let i = 0; i < cleanRecords.length; i += 25) {
      const batch = cleanRecords.slice(i, i + 25);
      await withRetry(() => base44.asServiceRole.entities.CommittedDemand.bulkCreate(batch));
      await sleep(500);
    }
    newDemandCreated = cleanRecords.length;
  }

  await base44.asServiceRole.entities.AuditLog.create({
    action: 'sync', entity_type: 'StockOnHand',
    description: `Committed demand recalc: ${openOrders.length} orders → ${skuList.length} SKUs. SOH: ${sohUpdated} updated, ${sohCreated} created, ${sohZeroed} zeroed. ${demandRecords.length} audit records.`,
  }).catch(() => {});

  console.log(`[CommittedDemand] Done — SOH: ${sohUpdated}u ${sohCreated}c ${sohZeroed}z, Demand: ${demandRecords.length} records`);

  responseData.soh_updated = sohUpdated;
  responseData.soh_created = sohCreated;
  responseData.soh_zeroed = sohZeroed;
  responseData.old_demand_deleted = oldDemandDeleted;
  responseData.new_demand_created = newDemandCreated;
  responseData.audit_refreshed = refreshAudit;

  return Response.json(responseData);
});