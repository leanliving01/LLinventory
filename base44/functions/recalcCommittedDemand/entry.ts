import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * §7C — Single Source of Truth for Committed Stock
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
 * This is the ONLY function that writes qty_committed. No other code should.
 */

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function withRetry(fn, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try { return await fn(); }
    catch (err) {
      if ((err.status === 429 || err.message?.includes('rate limit')) && i < retries - 1) {
        await sleep((i + 1) * 2000);
      } else { throw err; }
    }
  }
}

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me();
  if (!user || user.role !== 'admin') {
    return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const action = body.action || 'commit'; // 'preview' or 'commit'

  console.log(`[CommittedDemand] Starting (mode=${action})…`);

  // ── 1. Load paid-unfulfilled orders ──
  const openOrders = await withRetry(() =>
    base44.asServiceRole.entities.SalesOrder.filter({ lifecycle_state: 'paid_unfulfilled' })
  );
  console.log(`[CommittedDemand] ${openOrders.length} paid_unfulfilled orders`);

  // ── 2. Load ALL lines for these orders, aggregate by SKU ──
  const committedBySku = {};    // sku → total qty
  const orderBreakdowns = [];   // per-order detail for audit UI
  const demandRecords = [];     // flat list for CommittedDemand entity
  const warnings = [];

  for (const order of openOrders) {
    const lines = await withRetry(() =>
      base44.asServiceRole.entities.SalesOrderLine.filter({ sales_order_id: order.id })
    );

    // Build parent line lookup so components can inherit family
    const parentLineById = {};
    for (const line of lines) {
      if (line.is_package_parent) parentLineById[line.id] = line;
    }

    const orderDemandItems = [];
    let orderTotalLines = 0;

    for (const line of lines) {
      // §7C: Only count component & standalone lines, skip package parents
      if (line.is_package_parent) continue;
      if (line.status !== 'active') continue;
      const sku = line.sku;
      if (!sku) continue;

      // Unfulfilled quantity only
      const unfulfilledQty = Math.max(0, (line.qty || 0) - (line.fulfilled_qty || 0));
      if (unfulfilledQty <= 0) continue;

      committedBySku[sku] = (committedBySku[sku] || 0) + unfulfilledQty;
      orderTotalLines++;

      // Determine family: for components, look up parent line_type
      let family = 'standalone';
      if (line.is_package_component && line.parent_line_id) {
        const parent = parentLineById[line.parent_line_id];
        const parentType = parent?.line_type || '';
        if (parentType === 'low_carb_package') {
          family = 'LOW_CARB';
        } else if (parentType === 'goal_package') {
          // Use portion_weight_g to distinguish goal sub-families
          const pw = line.portion_weight_g;
          if (pw === 330) family = 'MLM';
          else if (pw === 300) family = 'MWL';
          else if (pw === 260) family = 'WWL';
          else if (pw === 240) family = 'WLM';
          else family = 'MLM'; // default goal
        }
      } else if (line.line_type === 'byo') {
        family = 'BYO';
      }

      orderDemandItems.push({
        family,
        sku,
        sku_name: line.name || sku,
        quantity: unfulfilledQty,
        portion_weight_g: line.portion_weight_g || null,
      });

      demandRecords.push({
        date: new Date().toISOString().split('T')[0],
        sku_id: sku,
        sku_display_name: line.name || sku,
        quantity: unfulfilledQty,
        source_order_id: order.id,
        demand_type: line.line_type === 'byo' ? 'byo' : 'fixed_pack',
        _family: family, // internal, not persisted
      });
    }

    if (orderTotalLines > 0) {
      // Count meals by family for summary
      const familyCounts = { MWL: 0, MLM: 0, WWL: 0, WLM: 0, LOW_CARB: 0, BYO: 0, standalone: 0 };
      orderDemandItems.forEach(d => { familyCounts[d.family] = (familyCounts[d.family] || 0) + d.quantity; });

      orderBreakdowns.push({
        order_number: order.order_number || order.shopify_order_id,
        customer_name: order.customer_name || '',
        mwl: familyCounts.MWL,
        mlm: familyCounts.MLM,
        wwl: familyCounts.WWL,
        wlm: familyCounts.WLM,
        lc: familyCounts.LOW_CARB,
        byo: familyCounts.BYO,
        total_demand_lines: orderTotalLines,
        demand_items: orderDemandItems,
      });
    }

    // Throttle to avoid rate limits on large order sets
    if (openOrders.length > 20) await sleep(200);
  }

  // ── 3. Build aggregated demand by SKU for summary ──
  const skuList = Object.keys(committedBySku);
  const demandBySku = skuList
    .map(sku => ({ sku_id: sku, sku_display_name: sku, total: committedBySku[sku] }))
    .sort((a, b) => b.total - a.total);

  // Enrich display names from first matching demand record
  for (const d of demandBySku) {
    const match = demandRecords.find(r => r.sku_id === d.sku_id);
    if (match) d.sku_display_name = match.sku_display_name;
  }

  // ── 4. Aggregate demand by family ──
  const demandByFamily = { MWL: 0, MLM: 0, WWL: 0, WLM: 0, LOW_CARB: 0, BYO: 0 };
  demandRecords.forEach(d => {
    const family = d._family || 'standalone';
    if (demandByFamily[family] !== undefined) {
      demandByFamily[family] += d.quantity;
    }
  });

  console.log(`[CommittedDemand] ${skuList.length} unique SKUs, ${demandRecords.length} demand lines from ${orderBreakdowns.length} orders`);

  // ── Build response (same shape for both preview and commit) ──
  const responseData = {
    action,
    total_orders: openOrders.length,
    orders_with_demand: orderBreakdowns.length,
    total_demand_records: demandRecords.length,
    demand_by_family: demandByFamily,
    demand_by_sku: demandBySku,
    order_breakdowns: orderBreakdowns,
    warnings,
    skus_committed: skuList.length,
  };

  if (action === 'preview') {
    return Response.json(responseData);
  }

  // ═══ COMMIT MODE ═══

  // ── 5. Load ALL products in one call, build SKU index ──
  const allProducts = await withRetry(() =>
    base44.asServiceRole.entities.Product.filter({ status: 'active' })
  );
  const productBySku = {};
  for (const p of allProducts) {
    if (p.sku) productBySku[p.sku] = p;
  }
  const unmatchedSkus = skuList.filter(s => !productBySku[s]);
  if (unmatchedSkus.length > 0) {
    warnings.push(`Products not found for SKUs: ${unmatchedSkus.join(', ')}`);
  }

  // ── 6. Get DISPATCH location ──
  const locations = await withRetry(() =>
    base44.asServiceRole.entities.Location.filter({ code: 'DISPATCH' })
  );
  const dispatchId = locations.length > 0 ? locations[0].id : '';
  const dispatchName = locations.length > 0 ? locations[0].name : 'Dispatch';
  if (!dispatchId) {
    warnings.push('No DISPATCH location found — committed stock written without location');
  }

  // ── 7. Load existing StockOnHand for DISPATCH ──
  const existingSoh = await withRetry(() =>
    base44.asServiceRole.entities.StockOnHand.filter(dispatchId ? { location_id: dispatchId } : {})
  );
  const sohByProductId = {};
  for (const soh of existingSoh) {
    sohByProductId[soh.product_id] = soh;
  }

  // ── 8. Update StockOnHand.qty_committed ──
  const updatedProductIds = new Set();
  let sohUpdated = 0, sohCreated = 0;

  for (const sku of skuList) {
    const product = productBySku[sku];
    if (!product) continue;

    const committed = committedBySku[sku];
    const existing = sohByProductId[product.id];
    updatedProductIds.add(product.id);

    if (existing) {
      const onHand = existing.qty_on_hand || 0;
      await withRetry(() => base44.asServiceRole.entities.StockOnHand.update(existing.id, {
        qty_committed: committed,
        qty_available: onHand - committed,
        last_updated_at: new Date().toISOString(),
      }));
      sohUpdated++;
    } else {
      await withRetry(() => base44.asServiceRole.entities.StockOnHand.create({
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
      }));
      sohCreated++;
    }
    await sleep(150);
  }

  // Zero out committed for products no longer in open orders
  let sohZeroed = 0;
  for (const soh of existingSoh) {
    if (!updatedProductIds.has(soh.product_id) && soh.qty_committed > 0) {
      await withRetry(() => base44.asServiceRole.entities.StockOnHand.update(soh.id, {
        qty_committed: 0,
        qty_available: soh.qty_on_hand || 0,
        last_updated_at: new Date().toISOString(),
      }));
      sohZeroed++;
      await sleep(150);
    }
  }

  // ── 9. Refresh CommittedDemand audit records ──
  // Only refresh if explicitly requested (saves time on scheduled runs)
  const refreshAudit = body.refresh_audit !== false;
  let oldDemandDeleted = 0, newDemandCreated = 0;

  if (refreshAudit) {
    // Delete old records
    const existingDemand = await withRetry(() =>
      base44.asServiceRole.entities.CommittedDemand.filter({})
    );
    for (let i = 0; i < existingDemand.length; i++) {
      await withRetry(() => base44.asServiceRole.entities.CommittedDemand.delete(existingDemand[i].id));
      if (i % 8 === 7) await sleep(600);
    }
    oldDemandDeleted = existingDemand.length;

    // Bulk create new records (strip internal _family field)
    const cleanRecords = demandRecords.map(({ _family, ...rest }) => rest);
    for (let i = 0; i < cleanRecords.length; i += 25) {
      const batch = cleanRecords.slice(i, i + 25);
      await withRetry(() => base44.asServiceRole.entities.CommittedDemand.bulkCreate(batch));
      await sleep(600);
    }
    newDemandCreated = cleanRecords.length;
  }

  // ── Audit log ──
  await base44.asServiceRole.entities.AuditLog.create({
    action: 'sync',
    entity_type: 'StockOnHand',
    description: `Committed demand recalc: ${openOrders.length} orders → ${skuList.length} SKUs. SOH: ${sohUpdated} updated, ${sohCreated} created, ${sohZeroed} zeroed. ${demandRecords.length} audit records written.`,
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