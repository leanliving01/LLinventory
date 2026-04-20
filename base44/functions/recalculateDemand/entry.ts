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
  const user = await base44.auth.me();
  if (!user || user.role !== 'admin') {
    return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const action = body.action || 'preview'; // 'preview' or 'commit'

  // Load all needed data
  const [orders, packages, bomLines, skus] = await Promise.all([
    base44.asServiceRole.entities.ShopifyOrder.filter({ paid_status: 'paid', fulfilment_status: 'unfulfilled' }),
    base44.asServiceRole.entities.PackageProduct.filter({}),
    base44.asServiceRole.entities.PackageBOMLine.filter({}),
    base44.asServiceRole.entities.SKU.filter({}),
  ]);

  console.log(`Loaded: ${orders.length} orders, ${packages.length} packages, ${bomLines.length} BOM lines, ${skus.length} SKUs`);

  // Index packages by family → sorted by pack_size
  const packagesByFamily = {};
  packages.forEach(p => {
    if (p.is_active === false) return;
    if (!packagesByFamily[p.package_family]) packagesByFamily[p.package_family] = [];
    packagesByFamily[p.package_family].push(p);
  });
  Object.values(packagesByFamily).forEach(arr => arr.sort((a, b) => a.pack_size - b.pack_size));

  // Index BOM lines by package_product_id
  const bomByPackage = {};
  bomLines.forEach(bl => {
    if (!bomByPackage[bl.package_product_id]) bomByPackage[bl.package_product_id] = [];
    bomByPackage[bl.package_product_id].push(bl);
  });

  // SKU lookup
  const skuById = {};
  skus.forEach(s => { skuById[s.id] = s; });

  // For each order, figure out how many of each package_family they ordered
  // Then use BOM to explode into SKU demand
  const FAMILY_KEYS = [
    { field: 'mwl_meals', family: 'MWL' },
    { field: 'mlm_meals', family: 'MLM' },
    { field: 'wwl_meals', family: 'WWL' },
    { field: 'wlm_meals', family: 'WLM' },
    { field: 'lc_meals', family: 'LOW_CARB' },
  ];

  const allDemandRecords = [];
  const orderBreakdowns = [];
  const warnings = [];

  for (const order of orders) {
    const orderDemand = [];

    for (const { field, family } of FAMILY_KEYS) {
      const mealCount = order[field] || 0;
      if (mealCount === 0) continue;

      // Find the best matching package (closest pack_size to mealCount)
      const familyPackages = packagesByFamily[family] || [];
      if (familyPackages.length === 0) {
        warnings.push(`No packages found for family ${family} (order ${order.order_number})`);
        continue;
      }

      // Find exact match or closest
      let bestPkg = familyPackages[0];
      for (const p of familyPackages) {
        if (p.pack_size === mealCount) { bestPkg = p; break; }
        if (Math.abs(p.pack_size - mealCount) < Math.abs(bestPkg.pack_size - mealCount)) {
          bestPkg = p;
        }
      }

      // If mealCount is a multiple of pack_size, calculate multiplier
      // e.g. 60 MWL meals with a 30-pack = 2x the BOM
      const packMultiplier = bestPkg.pack_size > 0 ? mealCount / bestPkg.pack_size : 1;

      // Get BOM for this package
      const bom = bomByPackage[bestPkg.id] || [];
      if (bom.length === 0) {
        warnings.push(`No BOM lines for ${bestPkg.name} (id: ${bestPkg.id}), order ${order.order_number}`);
        continue;
      }

      for (const bl of bom) {
        const qty = bl.quantity_per_pack * packMultiplier;
        const sku = skuById[bl.sku_id];
        allDemandRecords.push({
          date: new Date().toISOString().split('T')[0],
          sku_id: bl.sku_id,
          sku_display_name: sku?.display_name || bl.sku_display_name || 'Unknown',
          quantity: qty,
          source_order_id: order.id,
          demand_type: 'fixed_pack',
        });
        orderDemand.push({
          family,
          package_name: bestPkg.name,
          sku_name: sku?.display_name || bl.sku_display_name,
          quantity: qty,
        });
      }
    }

    // BYO meals — skip for now as they need line-item-level mapping
    if (order.byo_meals > 0) {
      warnings.push(`Order ${order.order_number} has ${order.byo_meals} BYO meals — BYO demand not yet implemented`);
    }

    if (orderDemand.length > 0) {
      orderBreakdowns.push({
        order_number: order.order_number,
        customer_name: order.customer_name,
        mwl: order.mwl_meals || 0,
        mlm: order.mlm_meals || 0,
        wwl: order.wwl_meals || 0,
        wlm: order.wlm_meals || 0,
        lc: order.lc_meals || 0,
        byo: order.byo_meals || 0,
        total_demand_lines: orderDemand.length,
        demand_items: orderDemand,
      });
    }
  }

  // Aggregate demand by SKU for summary
  const demandBySku = {};
  allDemandRecords.forEach(d => {
    if (!demandBySku[d.sku_id]) {
      demandBySku[d.sku_id] = { sku_id: d.sku_id, sku_display_name: d.sku_display_name, total: 0 };
    }
    demandBySku[d.sku_id].total += d.quantity;
  });

  // Aggregate by family
  const demandByFamily = { MWL: 0, MLM: 0, WWL: 0, WLM: 0, LOW_CARB: 0 };
  allDemandRecords.forEach(d => {
    const sku = skuById[d.sku_id];
    if (sku?.package_type) {
      demandByFamily[sku.package_type] = (demandByFamily[sku.package_type] || 0) + d.quantity;
    }
  });

  if (action === 'preview') {
    return Response.json({
      action: 'preview',
      total_orders: orders.length,
      orders_with_demand: orderBreakdowns.length,
      total_demand_records: allDemandRecords.length,
      demand_by_family: demandByFamily,
      demand_by_sku: Object.values(demandBySku).sort((a, b) => b.total - a.total),
      order_breakdowns: orderBreakdowns,
      warnings,
    });
  }

  // ─── COMMIT: Delete old demand, create new ───
  // Delete existing committed demand in batches
  const existingDemand = await base44.asServiceRole.entities.CommittedDemand.filter({});
  console.log(`Deleting ${existingDemand.length} old demand records...`);
  for (let i = 0; i < existingDemand.length; i++) {
    await withRetry(() => base44.asServiceRole.entities.CommittedDemand.delete(existingDemand[i].id));
    if ((i + 1) % 20 === 0) await delay(1000);
  }

  // Create new demand in batches
  console.log(`Creating ${allDemandRecords.length} new demand records...`);
  for (let i = 0; i < allDemandRecords.length; i += 50) {
    const batch = allDemandRecords.slice(i, i + 50);
    await withRetry(() => base44.asServiceRole.entities.CommittedDemand.bulkCreate(batch));
    await delay(500);
  }

  // Mark orders as demand_calculated
  for (const order of orders) {
    if ((order.mwl_meals || 0) + (order.mlm_meals || 0) + (order.wwl_meals || 0) + (order.wlm_meals || 0) + (order.lc_meals || 0) > 0) {
      await withRetry(() => base44.asServiceRole.entities.ShopifyOrder.update(order.id, { demand_calculated: true }));
    }
    await delay(100);
  }

  // Audit log
  await base44.asServiceRole.entities.AuditLog.create({
    action: 'sync',
    entity_type: 'CommittedDemand',
    description: `Demand recalculated: ${allDemandRecords.length} records from ${orderBreakdowns.length} orders. Old: ${existingDemand.length} deleted.`,
  });

  return Response.json({
    action: 'committed',
    old_demand_deleted: existingDemand.length,
    new_demand_created: allDemandRecords.length,
    orders_processed: orderBreakdowns.length,
    demand_by_family: demandByFamily,
    warnings,
  });
});