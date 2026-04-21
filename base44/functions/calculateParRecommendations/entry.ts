import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

async function withRetry(fn, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try { return await fn(); } catch (err) {
      if (err.status === 429 && i < retries - 1) { await delay((i + 1) * 3000); } else { throw err; }
    }
  }
}

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);

  // Load master data + historical orders from Base44 (no Shopify API calls needed)
  const [skus, parLevels, packages, bomLines, existingRecs, historicalOrders] = await Promise.all([
    base44.asServiceRole.entities.SKU.filter({}),
    base44.asServiceRole.entities.ParLevel.filter({}),
    base44.asServiceRole.entities.PackageProduct.filter({}),
    base44.asServiceRole.entities.PackageBOMLine.filter({}),
    base44.asServiceRole.entities.ParLevelRecommendation.filter({ status: 'pending' }),
    base44.asServiceRole.entities.HistoricalOrder.filter({}),
  ]);

  console.log(`Loaded: ${skus.length} SKUs, ${packages.length} packages, ${bomLines.length} BOM lines, ${historicalOrders.length} historical orders`);

  // Build lookups
  const parBySkuId = {};
  parLevels.forEach(p => { parBySkuId[p.sku_id] = p; });

  const packagesByFamily = {};
  packages.forEach(p => {
    if (p.is_active === false) return;
    if (!packagesByFamily[p.package_family]) packagesByFamily[p.package_family] = [];
    packagesByFamily[p.package_family].push(p);
  });
  Object.values(packagesByFamily).forEach(arr => arr.sort((a, b) => a.pack_size - b.pack_size));

  const bomByPackage = {};
  bomLines.forEach(bl => {
    if (!bomByPackage[bl.package_product_id]) bomByPackage[bl.package_product_id] = [];
    bomByPackage[bl.package_product_id].push(bl);
  });

  const skuById = {};
  skus.forEach(s => { skuById[s.id] = s; });

  // ─── Filter historical orders: 6 months back, exclude ALL Decembers ───
  const now = new Date();
  const sixMonthsAgo = new Date(now);
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

  const filteredOrders = historicalOrders.filter(order => {
    const dt = new Date(order.order_date);
    if (dt < sixMonthsAgo) return false; // Outside 6-month window
    if (dt.getMonth() === 11) return false; // Exclude ALL Decembers (month 11)
    return true;
  });

  const totalHistorical = historicalOrders.length;
  const decExcluded = historicalOrders.filter(o => {
    const dt = new Date(o.order_date);
    return dt >= sixMonthsAgo && dt.getMonth() === 11;
  }).length;
  const outsideWindow = totalHistorical - filteredOrders.length - decExcluded;

  console.log(`Filtered: ${filteredOrders.length} orders in window (${decExcluded} Dec excluded, ${outsideWindow} outside 6-month window)`);

  // ─── Explode each historical order into SKU-level demand using BOM ───
  const FAMILY_KEYS = ['MWL', 'MLM', 'WWL', 'WLM', 'LOW_CARB'];
  const FAMILY_FIELDS = { MWL: 'mwl_meals', MLM: 'mlm_meals', WWL: 'wwl_meals', WLM: 'wlm_meals', LOW_CARB: 'lc_meals' };

  const demandBySku = {}; // sku_id → total quantity

  for (const order of filteredOrders) {
    // Fixed pack demand: explode family meal counts via BOM
    for (const family of FAMILY_KEYS) {
      const mealCount = order[FAMILY_FIELDS[family]] || 0;
      if (mealCount === 0) continue;

      const familyPkgs = packagesByFamily[family] || [];
      if (familyPkgs.length === 0) continue;

      // Find best matching package by pack size
      let bestPkg = familyPkgs[0];
      for (const p of familyPkgs) {
        if (p.pack_size === mealCount) { bestPkg = p; break; }
        if (Math.abs(p.pack_size - mealCount) < Math.abs(bestPkg.pack_size - mealCount)) bestPkg = p;
      }

      const packMultiplier = bestPkg.pack_size > 0 ? mealCount / bestPkg.pack_size : 1;
      const bom = bomByPackage[bestPkg.id] || [];

      for (const bl of bom) {
        const qty = bl.quantity_per_pack * packMultiplier;
        demandBySku[bl.sku_id] = (demandBySku[bl.sku_id] || 0) + qty;
      }
    }

    // BYO demand: stored as JSON array of {sku_id, quantity}
    if (order.byo_items) {
      try {
        const byoItems = JSON.parse(order.byo_items);
        for (const item of byoItems) {
          if (item.sku_id && item.quantity) {
            demandBySku[item.sku_id] = (demandBySku[item.sku_id] || 0) + item.quantity;
          }
        }
      } catch (_) { /* ignore parse errors */ }
    }
  }

  // ─── Calculate effective weeks (subtract December days from the window) ───
  let earliestDate = now;
  let latestDate = sixMonthsAgo;
  for (const order of filteredOrders) {
    const dt = new Date(order.order_date);
    if (dt < earliestDate) earliestDate = dt;
    if (dt > latestDate) latestDate = dt;
  }

  const actualDays = Math.max(1, Math.ceil((latestDate - earliestDate) / (1000 * 60 * 60 * 24)));

  // Count how many December days fall within the actual data range (any year)
  let decDaysToSubtract = 0;
  const scanYear = earliestDate.getFullYear();
  for (let y = scanYear; y <= latestDate.getFullYear(); y++) {
    const decStart = new Date(y, 11, 1); // Dec 1
    const decEnd = new Date(y, 11, 31, 23, 59, 59); // Dec 31
    if (earliestDate <= decEnd && latestDate >= decStart) {
      const overlapStart = Math.max(earliestDate.getTime(), decStart.getTime());
      const overlapEnd = Math.min(latestDate.getTime(), decEnd.getTime());
      decDaysToSubtract += Math.max(0, Math.ceil((overlapEnd - overlapStart) / (1000 * 60 * 60 * 24)));
    }
  }

  const effectiveDays = Math.max(1, actualDays - decDaysToSubtract);
  const effectiveWeeks = Math.max(1, effectiveDays / 7);

  console.log(`Data range: ${earliestDate.toISOString().slice(0, 10)} to ${latestDate.toISOString().slice(0, 10)}`);
  console.log(`Effective period: ${effectiveDays} days (~${effectiveWeeks.toFixed(1)} weeks), Dec days subtracted: ${decDaysToSubtract}`);
  console.log(`SKUs with demand data: ${Object.keys(demandBySku).length}`);

  // ─── Generate recommendations ───
  const SAFETY_BUFFER_PCT = 15;
  const recommendations = [];

  for (const sku of skus) {
    if (sku.is_active === false) continue;

    const totalDemand = demandBySku[sku.id] || 0;
    if (totalDemand === 0) continue;

    const avgWeekly = totalDemand / effectiveWeeks;
    const recommended = Math.ceil(avgWeekly * (1 + SAFETY_BUFFER_PCT / 100));
    const currentPar = parBySkuId[sku.id]?.par_level || 0;

    // Only recommend if meaningful difference (>10% change or new par)
    const diff = Math.abs(recommended - currentPar);
    const pctChange = currentPar > 0 ? (diff / currentPar) * 100 : 100;
    if (pctChange < 10 && currentPar > 0) continue;

    recommendations.push({
      sku_id: sku.id,
      sku_display_name: sku.display_name || sku.meal_name || '',
      package_type: sku.package_type || '',
      current_par_level: currentPar,
      recommended_par_level: recommended,
      avg_weekly_demand: Math.round(avgWeekly * 10) / 10,
      safety_buffer_pct: SAFETY_BUFFER_PCT,
      calculation_date: now.toISOString().split('T')[0],
      status: 'pending',
      notes: `Avg weekly demand: ${avgWeekly.toFixed(1)} units over ${effectiveWeeks.toFixed(0)} weeks (${filteredOrders.length} orders, rolling 6 months excl. Dec). +${SAFETY_BUFFER_PCT}% safety buffer.`,
    });
  }

  console.log(`Generated ${recommendations.length} recommendations`);

  // ─── Clear old pending recommendations ───
  for (let i = 0; i < existingRecs.length; i++) {
    await withRetry(() => base44.asServiceRole.entities.ParLevelRecommendation.delete(existingRecs[i].id));
    if ((i + 1) % 20 === 0) await delay(500);
  }

  // ─── Create new recommendations in batches ───
  for (let i = 0; i < recommendations.length; i += 25) {
    const batch = recommendations.slice(i, i + 25);
    await withRetry(() => base44.asServiceRole.entities.ParLevelRecommendation.bulkCreate(batch));
    await delay(500);
  }

  // Audit log
  await base44.asServiceRole.entities.AuditLog.create({
    action: 'sync',
    entity_type: 'ParLevelRecommendation',
    description: `Par recommendations from ${filteredOrders.length} historical orders (${effectiveWeeks.toFixed(0)} weeks, excl. Dec). ${recommendations.length} SKUs with suggested changes.`,
  });

  return Response.json({
    success: true,
    historical_orders_total: totalHistorical,
    orders_in_window: filteredOrders.length,
    december_excluded: decExcluded,
    outside_window: outsideWindow,
    effective_weeks: Math.round(effectiveWeeks),
    skus_with_demand: Object.keys(demandBySku).length,
    recommendations_generated: recommendations.length,
    old_pending_cleared: existingRecs.length,
    safety_buffer_pct: SAFETY_BUFFER_PCT,
  });
});