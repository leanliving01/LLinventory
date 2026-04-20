import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

async function withRetry(fn, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try { return await fn(); } catch (err) {
      if (err.status === 429 && i < retries - 1) { await delay((i + 1) * 2000); } else { throw err; }
    }
  }
}

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);

  // Load all required data
  const [skus, parLevels, allDemand, existingRecs] = await Promise.all([
    base44.asServiceRole.entities.SKU.filter({}),
    base44.asServiceRole.entities.ParLevel.filter({}),
    base44.asServiceRole.entities.CommittedDemand.filter({}),
    base44.asServiceRole.entities.ParLevelRecommendation.filter({ status: 'pending' }),
  ]);

  // Also load ShopifyOrders to get historical order dates for demand weighting
  const allOrders = await base44.asServiceRole.entities.ShopifyOrder.filter({});

  console.log(`Loaded: ${skus.length} SKUs, ${parLevels.length} par levels, ${allDemand.length} demand records, ${allOrders.length} orders`);

  // Build lookup maps
  const parBySkuId = {};
  parLevels.forEach(p => { parBySkuId[p.sku_id] = p; });

  // Build order date lookup (source_order_id → order_date)
  const orderDateById = {};
  allOrders.forEach(o => { orderDateById[o.id] = o.order_date || o.created_date; });

  // Define the 6-month historical window (excluding December 2025)
  // Current date context: April 2026
  // Last 6 months: Oct 2025, Nov 2025, Jan 2026, Feb 2026, Mar 2026, Apr 2026
  // (skip Dec 2025)
  const now = new Date();
  const sixMonthsAgo = new Date(now);
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

  // Aggregate demand per SKU from orders within the historical window (excluding Dec 2025)
  const demandBySku = {};
  let includedRecords = 0;
  let excludedDec = 0;

  for (const d of allDemand) {
    const orderDate = orderDateById[d.source_order_id];
    if (!orderDate) continue;

    const dt = new Date(orderDate);
    
    // Must be within last 6 months
    if (dt < sixMonthsAgo) continue;
    if (dt > now) continue;

    // Exclude December 2025
    if (dt.getFullYear() === 2025 && dt.getMonth() === 11) {
      excludedDec++;
      continue;
    }

    if (!demandBySku[d.sku_id]) {
      demandBySku[d.sku_id] = { total: 0, records: [] };
    }
    demandBySku[d.sku_id].total += d.quantity;
    demandBySku[d.sku_id].records.push({ qty: d.quantity, date: orderDate });
    includedRecords++;
  }

  console.log(`Demand analysis: ${includedRecords} records included, ${excludedDec} Dec 2025 records excluded`);

  // Calculate weeks in the period (approximately 26 weeks for 6 months, minus ~4 for Dec = ~22 weeks)
  // More precise: count actual weeks between sixMonthsAgo and now, minus Dec 2025 weeks
  const totalDays = Math.ceil((now - sixMonthsAgo) / (1000 * 60 * 60 * 24));
  // December 2025 has 31 days — subtract those
  const effectiveDays = totalDays - 31;
  const effectiveWeeks = Math.max(1, effectiveDays / 7);

  console.log(`Effective period: ${effectiveDays} days (~${effectiveWeeks.toFixed(1)} weeks)`);

  const SAFETY_BUFFER_PCT = 15;
  const recommendations = [];

  for (const sku of skus) {
    if (sku.is_active === false) continue;

    const demand = demandBySku[sku.id];
    if (!demand || demand.total === 0) continue; // No demand = no recommendation needed

    const avgWeekly = demand.total / effectiveWeeks;
    const recommended = Math.ceil(avgWeekly * (1 + SAFETY_BUFFER_PCT / 100));
    const currentPar = parBySkuId[sku.id]?.par_level || 0;

    // Only recommend if there's a meaningful difference (>10% change or new par)
    const diff = Math.abs(recommended - currentPar);
    const pctChange = currentPar > 0 ? (diff / currentPar) * 100 : 100;
    
    if (pctChange < 10 && currentPar > 0) continue; // Skip if change is less than 10%

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
      notes: `Avg weekly demand: ${avgWeekly.toFixed(1)} units over ${effectiveWeeks.toFixed(0)} weeks (excl. Dec 2025). +${SAFETY_BUFFER_PCT}% safety buffer.`,
    });
  }

  console.log(`Generated ${recommendations.length} recommendations`);

  // Delete old pending recommendations before inserting new ones
  for (const old of existingRecs) {
    await withRetry(() => base44.asServiceRole.entities.ParLevelRecommendation.delete(old.id));
    if (existingRecs.indexOf(old) % 20 === 19) await delay(500);
  }

  // Create new recommendations in batches
  for (let i = 0; i < recommendations.length; i += 25) {
    const batch = recommendations.slice(i, i + 25);
    await withRetry(() => base44.asServiceRole.entities.ParLevelRecommendation.bulkCreate(batch));
    await delay(500);
  }

  // Audit log
  await base44.asServiceRole.entities.AuditLog.create({
    action: 'sync',
    entity_type: 'ParLevelRecommendation',
    description: `Par level recommendations calculated: ${recommendations.length} SKUs with suggested changes. Period: last 6 months (excl. Dec 2025).`,
  });

  return Response.json({
    success: true,
    total_skus: skus.filter(s => s.is_active !== false).length,
    skus_with_demand: Object.keys(demandBySku).length,
    recommendations_generated: recommendations.length,
    old_pending_cleared: existingRecs.length,
    effective_weeks: Math.round(effectiveWeeks),
    safety_buffer_pct: SAFETY_BUFFER_PCT,
  });
});