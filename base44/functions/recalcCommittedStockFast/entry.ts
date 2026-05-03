import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * recalcCommittedStockFast  (v2 — bulk-fetch architecture)
 *
 * Reads PackBom + SalesOrder + SalesOrderLine + Product + StockOnHand in BULK,
 * computes committed stock entirely in-memory, then writes only StockOnHand.
 *
 * Key optimisation vs v1: Instead of fetching lines per-order (257 API calls),
 * bulk-fetches ALL SalesOrderLines and groups by sales_order_id in-memory.
 * Total API calls: ~15-20 paginated fetches + SOH writes.
 *
 * Accepts { dry_run: boolean } — when true returns computed quantities without writing.
 */

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function withRetry(fn, maxRetries = 5) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const msg = (err.message || '').toLowerCase();
      if ((msg.includes('rate limit') || err.status === 429) && attempt < maxRetries) {
        const backoff = 3000 * attempt;
        console.log(`[RecalcFast] Rate limited, backoff ${backoff}ms (attempt ${attempt}/${maxRetries})`);
        await sleep(backoff);
        continue;
      }
      throw err;
    }
  }
}

async function fetchAllPaginated(entity, filterObj, sortField, pageSize = 500) {
  const all = [];
  let skip = 0;
  while (true) {
    const batch = await withRetry(() => {
      if (filterObj && Object.keys(filterObj).length > 0) {
        return entity.filter(filterObj, sortField || 'id', pageSize, skip);
      } else {
        return entity.list(sortField || 'id', pageSize, skip);
      }
    });
    if (!batch || batch.length === 0) break;
    all.push(...batch);
    if (batch.length < pageSize) break;
    skip += pageSize;
    await sleep(400);
  }
  return all;
}

Deno.serve(async (req) => {
  const startTime = Date.now();
  const base44 = createClientFromRequest(req);

  // Auth: allow admin users OR scheduled automation (no user context)
  let user = null;
  try { user = await base44.auth.me(); } catch { /* scheduled */ }
  if (user && user.role !== 'admin') {
    return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
  }

  let body = {};
  try { body = await req.json(); } catch { /* no body */ }
  const dryRun = body.dry_run === true;

  const log = [];
  const warnings = [];

  // ── STEP 1: Load PackBom definitions ──
  const allPackBoms = await base44.asServiceRole.entities.PackBom.filter({ active: true });
  const bomMap = {};
  for (const bom of allPackBoms) {
    let skuOverrides = {};
    try { skuOverrides = JSON.parse(bom.sku_overrides || '{}'); } catch { /* */ }
    const disabledSet = new Set(bom.disabled_skus || []);
    bomMap[bom.package_sku] = {
      component_skus: (bom.component_skus || []).filter(s => !disabledSet.has(s)),
      multiplier: bom.multiplier || 1,
      sku_overrides: skuOverrides,
    };
  }
  log.push(`Loaded ${allPackBoms.length} active PackBom definitions`);

  // ── STEP 2: Load paid_unfulfilled orders ──
  const paidUnfulfilledOrders = await fetchAllPaginated(
    base44.asServiceRole.entities.SalesOrder,
    { lifecycle_state: 'paid_unfulfilled' },
    '-order_date', 500
  );
  const orderIds = new Set(paidUnfulfilledOrders.map(o => o.id));
  const orderNumberMap = {};
  paidUnfulfilledOrders.forEach(o => { orderNumberMap[o.id] = o.order_number || o.id; });
  log.push(`Found ${paidUnfulfilledOrders.length} paid_unfulfilled orders`);

  // ── STEP 3: BULK-fetch ALL SalesOrderLines (not per-order!) ──
  // This is the key optimisation — ~5 paginated fetches instead of 257
  console.log('[RecalcFast] Bulk-fetching all SalesOrderLines...');
  const allLines = await fetchAllPaginated(
    base44.asServiceRole.entities.SalesOrderLine,
    {}, 'id', 500
  );
  log.push(`Loaded ${allLines.length} total SalesOrderLines`);

  // Filter to only lines belonging to paid_unfulfilled orders
  const relevantLines = allLines.filter(l => orderIds.has(l.sales_order_id));
  log.push(`${relevantLines.length} lines belong to paid_unfulfilled orders`);

  // ── STEP 4: Compute committed quantities in-memory ──
  const committedMap = {}; // { sku: total_committed_qty }
  let linesProcessed = 0;
  let packageLinesDecomposed = 0;
  let standaloneLinesProcessed = 0;

  for (const line of relevantLines) {
    // Skip decomposed component lines — we recompute from PackBom
    if (line.is_package_component === true) continue;

    const lineQty = line.qty || 0;
    const fulfilledQty = line.fulfilled_qty || 0;
    const remainingQty = Math.max(0, lineQty - fulfilledQty);
    if (remainingQty <= 0) continue;

    if (line.is_package_parent === true) {
      const bom = bomMap[line.sku];
      if (bom) {
        for (const componentSku of bom.component_skus) {
          const skuMult = bom.sku_overrides[componentSku] || bom.multiplier;
          committedMap[componentSku] = (committedMap[componentSku] || 0) + (remainingQty * skuMult);
        }
        packageLinesDecomposed++;
      } else {
        warnings.push(`No active PackBom for "${line.sku}" on order ${orderNumberMap[line.sales_order_id]}`);
      }
    } else {
      // Standalone line (BYO meals, supplements, etc.)
      committedMap[line.sku] = (committedMap[line.sku] || 0) + remainingQty;
      standaloneLinesProcessed++;
    }
    linesProcessed++;
  }

  const ordersProcessed = paidUnfulfilledOrders.length;
  log.push(`Processed ${linesProcessed} relevant lines (${packageLinesDecomposed} package decompositions, ${standaloneLinesProcessed} standalone)`);
  log.push(`Computed committed for ${Object.keys(committedMap).length} unique SKUs`);
  if (warnings.length > 0) log.push(`${warnings.length} warnings`);

  // ── STEP 5: Dry run early return ──
  if (dryRun) {
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    log.push(`Dry run completed in ${elapsed}s`);
    return Response.json({
      status: 'dry_run_complete', elapsed_seconds: parseFloat(elapsed),
      orders_processed: ordersProcessed, lines_processed: linesProcessed,
      package_lines_decomposed: packageLinesDecomposed, standalone_lines: standaloneLinesProcessed,
      unique_skus: Object.keys(committedMap).length,
      committed_quantities: committedMap, warnings, log,
    });
  }

  // ── STEP 6: Load Products (SKU→ID map) ──
  const allProducts = await fetchAllPaginated(
    base44.asServiceRole.entities.Product, { status: 'active' }, 'sku', 500
  );
  const skuToProductId = {};
  for (const prod of allProducts) {
    if (prod.sku) skuToProductId[prod.sku] = prod.id;
  }
  log.push(`Loaded ${allProducts.length} active products`);

  // ── STEP 6b: Find DISPATCH location ──
  const locations = await withRetry(() => base44.asServiceRole.entities.Location.filter({ code: 'DISPATCH' }));
  const dispatchId = locations.length > 0 ? locations[0].id : '';
  const dispatchName = locations.length > 0 ? locations[0].name : 'Dispatch';
  log.push(`DISPATCH location: ${dispatchId || 'NOT FOUND'}`);

  // ── STEP 7: Load StockOnHand ──
  const allStockOnHand = await fetchAllPaginated(
    base44.asServiceRole.entities.StockOnHand, {}, 'product_sku', 500
  );
  // Build lookup: ONLY use DISPATCH location SOH for committed writes
  const dispatchSohByProductId = {};   // productId → single dispatch SOH record
  const nonDispatchStale = [];         // non-dispatch records with stale committed
  for (const soh of allStockOnHand) {
    if (!soh.product_id) continue;
    if (dispatchId && soh.location_id === dispatchId) {
      dispatchSohByProductId[soh.product_id] = soh;
    } else if ((soh.qty_committed || 0) > 0) {
      nonDispatchStale.push(soh);
    }
  }
  log.push(`Loaded ${allStockOnHand.length} StockOnHand records (${Object.keys(dispatchSohByProductId).length} dispatch, ${nonDispatchStale.length} stale non-dispatch)`);

  // ── STEP 8: Write committed quantities ──
  let updatedCount = 0;
  let zeroedCount = 0;
  let skippedCount = 0;
  const errors = [];
  const now = new Date().toISOString();
  const productsWithCommitted = new Set();
  const BATCH = 5;

  // 8a: Zero stale committed on non-dispatch SOH records first
  if (nonDispatchStale.length > 0) {
    log.push(`Zeroing ${nonDispatchStale.length} non-dispatch SOH records with stale committed`);
    for (let i = 0; i < nonDispatchStale.length; i += BATCH) {
      const batch = nonDispatchStale.slice(i, i + BATCH);
      await Promise.all(batch.map(soh =>
        withRetry(() => base44.asServiceRole.entities.StockOnHand.update(soh.id, {
          qty_committed: 0, qty_available: soh.qty_on_hand || 0, last_updated_at: now,
        })).catch(() => {})
      ));
      await sleep(600);
    }
  }

  // 8b: Update SKUs that HAVE committed stock — ONLY on DISPATCH SOH
  const committedEntries = Object.entries(committedMap);

  for (let i = 0; i < committedEntries.length; i += BATCH) {
    const batch = committedEntries.slice(i, i + BATCH);
    await Promise.all(batch.map(async ([sku, committedQty]) => {
      const productId = skuToProductId[sku];
      if (!productId) {
        warnings.push(`SKU "${sku}" has ${committedQty} committed but no matching Product`);
        skippedCount++;
        return;
      }
      productsWithCommitted.add(productId);
      const dispatchSoh = dispatchSohByProductId[productId];

      if (dispatchSoh) {
        try {
          await withRetry(() => base44.asServiceRole.entities.StockOnHand.update(dispatchSoh.id, {
            qty_committed: committedQty,
            qty_available: (dispatchSoh.qty_on_hand || 0) - committedQty,
            last_updated_at: now,
          }));
          updatedCount++;
        } catch (err) {
          errors.push(`Update SOH failed for ${sku}: ${err.message}`);
        }
      } else {
        // No DISPATCH SOH exists — create one
        try {
          await withRetry(() => base44.asServiceRole.entities.StockOnHand.create({
            product_id: productId, product_sku: sku,
            product_name: allProducts.find(p => p.id === productId)?.name || sku,
            location_id: dispatchId, location_name: dispatchName,
            qty_on_hand: 0, qty_committed: committedQty, qty_available: -committedQty,
            last_updated_at: now,
          }));
          updatedCount++;
        } catch (err) {
          errors.push(`Create SOH failed for ${sku}: ${err.message}`);
        }
      }
    }));
    if (i + BATCH < committedEntries.length) await sleep(600);
  }

  // 8c: Zero out committed for dispatch SOH products NOT in committedMap
  const zeroUpdates = allStockOnHand.filter(soh =>
    soh.product_id && !productsWithCommitted.has(soh.product_id) && (soh.qty_committed || 0) > 0
  );
  log.push(`${zeroUpdates.length} SOH records to zero out`);

  for (let i = 0; i < zeroUpdates.length; i += BATCH) {
    const batch = zeroUpdates.slice(i, i + BATCH);
    await Promise.all(batch.map(async (soh) => {
      try {
        await withRetry(() => base44.asServiceRole.entities.StockOnHand.update(soh.id, {
          qty_committed: 0, qty_available: soh.qty_on_hand || 0, last_updated_at: now,
        }));
        zeroedCount++;
      } catch (err) {
        errors.push(`Zero failed for ${soh.product_sku || soh.product_id}: ${err.message}`);
      }
    }));
    if (i + BATCH < zeroUpdates.length) await sleep(600);
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  log.push(`Completed in ${elapsed}s — Updated: ${updatedCount}, Zeroed: ${zeroedCount}, Skipped: ${skippedCount}, Errors: ${errors.length}`);

  // Audit log
  try {
    await base44.asServiceRole.entities.AuditLog.create({
      action: 'recalc_committed_stock', entity_type: 'StockOnHand',
      description: `Fast committed recalc v2: ${ordersProcessed} orders, ${Object.keys(committedMap).length} SKUs, ${updatedCount} updated, ${zeroedCount} zeroed in ${elapsed}s`,
    });
  } catch { /* best effort */ }

  return Response.json({
    status: errors.length > 0 ? 'completed_with_errors' : 'completed',
    elapsed_seconds: parseFloat(elapsed), orders_processed: ordersProcessed,
    lines_processed: linesProcessed, package_lines_decomposed: packageLinesDecomposed,
    standalone_lines: standaloneLinesProcessed, unique_skus: Object.keys(committedMap).length,
    updated: updatedCount, zeroed: zeroedCount, skipped: skippedCount,
    errors, warnings, log,
  });
});