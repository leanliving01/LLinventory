import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * recalcCommittedStockFast
 *
 * Pure read-then-aggregate-then-write approach for committed stock.
 * - READs PackBom, SalesOrder (paid_unfulfilled), SalesOrderLine, Product, StockOnHand
 * - COMPUTES committed quantities entirely in-memory
 * - WRITES only to StockOnHand (qty_committed + qty_available)
 * - NEVER modifies SalesOrderLine records
 * - NEVER touches qty_on_hand (derived from StockMovements)
 *
 * Accepts { dry_run: boolean } — when true, returns computed quantities without writing.
 *
 * Expected: ~400 API calls total for 300 orders → 40-80 seconds.
 */

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function withRetry(fn, maxRetries = 3) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const msg = (err.message || '').toLowerCase();
      if ((msg.includes('rate limit') || err.status === 429) && attempt < maxRetries) {
        const backoff = 2000 * attempt;
        console.log(`[RecalcFast] Rate limited, backoff ${backoff}ms (attempt ${attempt})`);
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
    await sleep(100);
  }
  return all;
}

Deno.serve(async (req) => {
  const startTime = Date.now();
  const base44 = createClientFromRequest(req);
  // Auth: allow admin users OR scheduled automation (no user context)
  let user = null;
  try {
    user = await base44.auth.me();
  } catch { /* scheduled automation — no user */ }

  if (user && user.role !== 'admin') {
    return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
  }

  let body = {};
  try { body = await req.json(); } catch { /* no body or not JSON */ }
  const dryRun = body.dry_run === true;

  const log = [];

  // ──────────────────────────────────────────────────
  // STEP 1: Load all active PackBom records into memory
  // ──────────────────────────────────────────────────
  const allPackBoms = await base44.asServiceRole.entities.PackBom.filter({ active: true });
  const bomMap = {};
  for (const bom of allPackBoms) {
    // Parse sku_overrides
    let skuOverrides = {};
    try { skuOverrides = JSON.parse(bom.sku_overrides || '{}'); } catch { /* ignore */ }
    const disabledSet = new Set(bom.disabled_skus || []);

    bomMap[bom.package_sku] = {
      component_skus: (bom.component_skus || []).filter(s => !disabledSet.has(s)),
      multiplier: bom.multiplier || 1,
      sku_overrides: skuOverrides,
      portion_weight_g: bom.portion_weight_g,
      package_type: bom.package_type,
    };
  }
  log.push(`Loaded ${allPackBoms.length} active PackBom definitions`);

  // ──────────────────────────────────────────────────
  // STEP 2: Load ALL paid_unfulfilled orders
  // ──────────────────────────────────────────────────
  const paidUnfulfilledOrders = await fetchAllPaginated(
    base44.asServiceRole.entities.SalesOrder,
    { lifecycle_state: 'paid_unfulfilled' },
    '-order_date',
    500
  );
  log.push(`Found ${paidUnfulfilledOrders.length} paid_unfulfilled orders`);

  // ──────────────────────────────────────────────────
  // STEP 3: For each order, load its SalesOrderLines and compute committed
  // ──────────────────────────────────────────────────
  const committedMap = {}; // { sku: total_committed_qty }
  let ordersProcessed = 0;
  let linesProcessed = 0;
  let packageLinesDecomposed = 0;
  let standaloneLinesProcessed = 0;
  const warnings = [];

  // Process orders sequentially — one line-fetch at a time to stay under rate limits
  for (let i = 0; i < paidUnfulfilledOrders.length; i++) {
    const order = paidUnfulfilledOrders[i];

    const lines = await withRetry(() =>
      base44.asServiceRole.entities.SalesOrderLine.filter(
        { sales_order_id: order.id }, 'id', 500
      )
    );

    for (const line of lines) {
      // Skip existing component lines — we recompute from PackBom
      if (line.is_package_component === true) continue;

      const lineQty = line.qty || 0;
      const fulfilledQty = line.fulfilled_qty || 0;
      const remainingQty = Math.max(0, lineQty - fulfilledQty);

      if (remainingQty <= 0) continue;

      if (line.is_package_parent === true) {
        // PACKAGE LINE: decompose using current PackBom
        const bom = bomMap[line.sku];
        if (bom) {
          for (const componentSku of bom.component_skus) {
            const skuMult = bom.sku_overrides[componentSku] || bom.multiplier;
            const componentQty = remainingQty * skuMult;
            committedMap[componentSku] = (committedMap[componentSku] || 0) + componentQty;
          }
          packageLinesDecomposed++;
        } else {
          warnings.push(`No active PackBom for package SKU "${line.sku}" on order ${order.order_number || order.id}`);
        }
      } else {
        // STANDALONE LINE: commit the SKU directly
        committedMap[line.sku] = (committedMap[line.sku] || 0) + remainingQty;
        standaloneLinesProcessed++;
      }

      linesProcessed++;
    }
    ordersProcessed++;

    // Log progress every 50 orders
    if (ordersProcessed % 50 === 0) {
      console.log(`[RecalcFast] Processed ${ordersProcessed}/${paidUnfulfilledOrders.length} orders...`);
    }

    // Delay every 2 orders to avoid rate limits
    if (i % 2 === 1) {
      await sleep(350);
    }
  }

  log.push(`Processed ${ordersProcessed} orders, ${linesProcessed} relevant lines`);
  log.push(`Package lines decomposed: ${packageLinesDecomposed}, Standalone lines: ${standaloneLinesProcessed}`);
  log.push(`Computed committed quantities for ${Object.keys(committedMap).length} unique SKUs`);
  if (warnings.length > 0) {
    log.push(`${warnings.length} warnings encountered`);
  }

  // ──────────────────────────────────────────────────
  // STEP 4: If dry_run, return results without writing
  // ──────────────────────────────────────────────────
  if (dryRun) {
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    log.push(`Dry run completed in ${elapsed}s`);
    return Response.json({
      status: 'dry_run_complete',
      elapsed_seconds: parseFloat(elapsed),
      orders_processed: ordersProcessed,
      lines_processed: linesProcessed,
      package_lines_decomposed: packageLinesDecomposed,
      standalone_lines: standaloneLinesProcessed,
      unique_skus: Object.keys(committedMap).length,
      committed_quantities: committedMap,
      warnings,
      log,
    });
  }

  // ──────────────────────────────────────────────────
  // STEP 5: Load all Products to map SKU → product_id
  // ──────────────────────────────────────────────────
  const allProducts = await fetchAllPaginated(
    base44.asServiceRole.entities.Product,
    { status: 'active' },
    'sku',
    500
  );
  const skuToProductId = {};
  const productIdToSku = {};
  for (const prod of allProducts) {
    if (prod.sku) {
      skuToProductId[prod.sku] = prod.id;
      productIdToSku[prod.id] = prod.sku;
    }
  }
  log.push(`Loaded ${allProducts.length} active products`);

  // ──────────────────────────────────────────────────
  // STEP 6: Load all StockOnHand records
  // ──────────────────────────────────────────────────
  const allStockOnHand = await fetchAllPaginated(
    base44.asServiceRole.entities.StockOnHand,
    {},
    'product_sku',
    500
  );
  // Build lookup: product_id → SOH record
  const sohByProductId = {};
  for (const soh of allStockOnHand) {
    if (soh.product_id) {
      // If multiple SOH records per product (different locations), aggregate
      if (!sohByProductId[soh.product_id]) {
        sohByProductId[soh.product_id] = [];
      }
      sohByProductId[soh.product_id].push(soh);
    }
  }
  log.push(`Loaded ${allStockOnHand.length} StockOnHand records`);

  // ──────────────────────────────────────────────────
  // STEP 7: Write committed quantities to StockOnHand
  // ──────────────────────────────────────────────────
  let updatedCount = 0;
  let zeroedCount = 0;
  let skippedCount = 0;
  const errors = [];
  const now = new Date().toISOString();

  // Track which product_ids have committed stock
  const productsWithCommitted = new Set();

  // 7a: Update SKUs that HAVE committed stock
  const UPDATE_BATCH = 5;
  const committedEntries = Object.entries(committedMap);

  for (let i = 0; i < committedEntries.length; i += UPDATE_BATCH) {
    const batch = committedEntries.slice(i, i + UPDATE_BATCH);
    const updatePromises = batch.map(async ([sku, committedQty]) => {
      const productId = skuToProductId[sku];
      if (!productId) {
        warnings.push(`SKU "${sku}" has ${committedQty} committed but no matching Product found`);
        skippedCount++;
        return;
      }

      productsWithCommitted.add(productId);
      const sohRecords = sohByProductId[productId];

      if (sohRecords && sohRecords.length > 0) {
        // Update the first SOH record (primary location — typically dispatch)
        const primary = sohRecords[0];
        try {
          await withRetry(() => base44.asServiceRole.entities.StockOnHand.update(primary.id, {
            qty_committed: committedQty,
            qty_available: (primary.qty_on_hand || 0) - committedQty,
            last_updated_at: now,
          }));
          updatedCount++;
        } catch (err) {
          errors.push(`Update SOH failed for SKU ${sku}: ${err.message}`);
        }

        // Zero out committed on any secondary location SOH records
        for (let j = 1; j < sohRecords.length; j++) {
          if (sohRecords[j].qty_committed > 0) {
            try {
              await withRetry(() => base44.asServiceRole.entities.StockOnHand.update(sohRecords[j].id, {
                qty_committed: 0,
                qty_available: sohRecords[j].qty_on_hand || 0,
                last_updated_at: now,
              }));
            } catch { /* best effort */ }
          }
        }
      } else {
        // No SOH record exists — create one with qty_on_hand = 0
        try {
          await withRetry(() => base44.asServiceRole.entities.StockOnHand.create({
            product_id: productId,
            product_sku: sku,
            product_name: allProducts.find(p => p.id === productId)?.name || sku,
            location_id: '',
            location_name: 'Dispatch',
            qty_on_hand: 0,
            qty_committed: committedQty,
            qty_available: 0 - committedQty,
            last_updated_at: now,
          }));
          updatedCount++;
        } catch (err) {
          errors.push(`Create SOH failed for SKU ${sku}: ${err.message}`);
        }
      }
    });

    await Promise.all(updatePromises);

    if (i + UPDATE_BATCH < committedEntries.length) {
      await sleep(400);
    }
  }

  // 7b: Zero out committed stock for products NOT in committedMap
  const zeroUpdates = [];
  for (const soh of allStockOnHand) {
    if (!soh.product_id) continue;
    if (productsWithCommitted.has(soh.product_id)) continue;
    if ((soh.qty_committed || 0) > 0) {
      zeroUpdates.push(soh);
    }
  }

  log.push(`${zeroUpdates.length} SOH records to zero out (no open orders)`);

  for (let i = 0; i < zeroUpdates.length; i += UPDATE_BATCH) {
    const batch = zeroUpdates.slice(i, i + UPDATE_BATCH);
    const promises = batch.map(async (soh) => {
      try {
        await withRetry(() => base44.asServiceRole.entities.StockOnHand.update(soh.id, {
          qty_committed: 0,
          qty_available: soh.qty_on_hand || 0,
          last_updated_at: now,
        }));
        zeroedCount++;
      } catch (err) {
        errors.push(`Zero SOH failed for product ${soh.product_sku || soh.product_id}: ${err.message}`);
      }
    });
    await Promise.all(promises);
    if (i + UPDATE_BATCH < zeroUpdates.length) {
      await sleep(400);
    }
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  log.push(`Completed in ${elapsed}s`);
  log.push(`Updated: ${updatedCount}, Zeroed: ${zeroedCount}, Skipped: ${skippedCount}, Errors: ${errors.length}`);

  // Audit log
  try {
    await base44.asServiceRole.entities.AuditLog.create({
      action: 'recalc_committed_stock',
      entity_type: 'StockOnHand',
      description: `Fast committed recalc: ${ordersProcessed} orders, ${Object.keys(committedMap).length} SKUs, ${updatedCount} updated, ${zeroedCount} zeroed in ${elapsed}s`,
    });
  } catch { /* best effort */ }

  return Response.json({
    status: errors.length > 0 ? 'completed_with_errors' : 'completed',
    elapsed_seconds: parseFloat(elapsed),
    orders_processed: ordersProcessed,
    lines_processed: linesProcessed,
    package_lines_decomposed: packageLinesDecomposed,
    standalone_lines: standaloneLinesProcessed,
    unique_skus: Object.keys(committedMap).length,
    updated: updatedCount,
    zeroed: zeroedCount,
    skipped: skippedCount,
    errors,
    warnings,
    log,
  });
});