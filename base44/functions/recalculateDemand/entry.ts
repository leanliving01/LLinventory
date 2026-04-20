import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

async function withRetry(fn, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try { return await fn(); } catch (err) {
      if (err.status === 429 && i < retries - 1) { await delay((i + 1) * 2000); } else { throw err; }
    }
  }
}

// ─── BYO helpers ───
function isExcluded(lineItem) {
  const title = (lineItem.title || '').toLowerCase();
  const sku = (lineItem.sku || '').toLowerCase();
  if (title.includes('supplement')) return true;
  if (title.includes('low calorie sauce') || title.includes('sauce')) return true;
  if (title.includes('90-day reset') || title.includes('90 day reset')) return true;
  if (sku === 'l90c2') return true;
  if (title.includes('dry ice') || title.includes('cooler box') || title.includes('delivery')) return true;
  if (title.includes('snack') && !title.includes('meal')) return true;
  if (title.includes('protein water')) return true;
  return false;
}

function normalizeName(name) {
  let n = (name || '').toLowerCase();
  // Strip weight suffixes like "(410g)", "( 330g)", "(460 g)" etc.
  n = n.replace(/\(\s*\d+\s*g\s*\)/g, '');
  // Normalize common spelling variants
  n = n.replace(/chili/g, 'chilli');  // "Sweet Chili" → "Sweet Chilli"
  // Strip all non-alphanumeric
  return n.replace(/[^a-z0-9]/g, '');
}

async function fetchShopifyOrderLineItems(shopifyOrderId, storeDomain, accessToken) {
  const url = `https://${storeDomain}/admin/api/2024-01/orders/${shopifyOrderId}.json?fields=id,line_items`;
  const res = await fetch(url, {
    headers: { 'X-Shopify-Access-Token': accessToken, 'Content-Type': 'application/json' },
  });
  if (!res.ok) return [];
  const data = await res.json();
  return data.order?.line_items || [];
}

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me();
  if (!user || user.role !== 'admin') {
    return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const action = body.action || 'preview'; // 'preview' or 'commit'

  const storeDomain = Deno.env.get('SHOPIFY_STORE_DOMAIN');
  const accessToken = Deno.env.get('SHOPIFY_ACCESS_TOKEN');

  // Load all needed data
  const [orders, packages, bomLines, skus, meals] = await Promise.all([
    base44.asServiceRole.entities.ShopifyOrder.filter({ paid_status: 'paid', fulfilment_status: 'unfulfilled' }),
    base44.asServiceRole.entities.PackageProduct.filter({}),
    base44.asServiceRole.entities.PackageBOMLine.filter({}),
    base44.asServiceRole.entities.SKU.filter({}),
    base44.asServiceRole.entities.Meal.filter({}),
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

  // Build meal name → MWL SKU lookup for BYO matching
  // BYO meals are individual meals — we match to the MWL variant of each meal
  // Also try LOW_CARB for low carb meals
  const skuByMealNameNorm = {};
  skus.forEach(s => {
    if (s.is_active === false || !s.meal_name) return;
    const key = normalizeName(s.meal_name);
    // Prefer MWL, then LOW_CARB (since BYO can be either goal-related or low-carb)
    if (!skuByMealNameNorm[key] || s.package_type === 'MWL' || (s.package_type === 'LOW_CARB' && skuByMealNameNorm[key].package_type !== 'MWL')) {
      skuByMealNameNorm[key] = s;
    }
  });

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

    // ─── BYO: fetch line items from Shopify and match to SKUs ───
    if (order.byo_meals > 0 && order.shopify_order_id && storeDomain && accessToken) {
      const lineItems = await fetchShopifyOrderLineItems(order.shopify_order_id, storeDomain, accessToken);
      await delay(500); // rate limit

      // Identify BYO products from the Shopify product catalog
      // BYO line items are individual meal products (not pack products)
      let byoMatched = 0;
      for (const li of lineItems) {
        if (isExcluded(li)) continue;
        // Skip category-level BYO titles (e.g. "Men's Lean Muscle Meals", "Women's Weight Loss Meals")
        const titleLower = (li.title || '').toLowerCase();
        if (/^(men|women|male|female|ladies).*(meal|pack)/i.test(li.title || '')) continue;
        if (titleLower.includes('build your own') || titleLower.includes('byo')) continue;
        const qty = li.quantity || 0;
        const titleNorm = normalizeName(li.title);

        // Try to match to a SKU by meal name
        const matchedSku = skuByMealNameNorm[titleNorm];
        if (matchedSku) {
          allDemandRecords.push({
            date: new Date().toISOString().split('T')[0],
            sku_id: matchedSku.id,
            sku_display_name: matchedSku.display_name || matchedSku.meal_name,
            quantity: qty,
            source_order_id: order.id,
            demand_type: 'byo',
          });
          orderDemand.push({
            family: 'BYO',
            package_name: `BYO → ${matchedSku.package_type}`,
            sku_name: matchedSku.display_name || matchedSku.meal_name,
            quantity: qty,
          });
          byoMatched += qty;
        } else {
          // Not a known meal — could be a supplement, addon, etc. that passed exclusion
          // Only warn if the title looks meal-like
          const title = li.title || '';
          if (!title.toLowerCase().includes('protein') && !title.toLowerCase().includes('water') && !title.toLowerCase().includes('supplement')) {
            warnings.push(`BYO order ${order.order_number}: could not match "${li.title}" to any SKU`);
          }
        }
      }

      if (byoMatched === 0 && order.byo_meals > 0) {
        warnings.push(`BYO order ${order.order_number}: ${order.byo_meals} BYO meals but 0 matched to SKUs`);
      }
    } else if (order.byo_meals > 0 && !storeDomain) {
      warnings.push(`Order ${order.order_number} has ${order.byo_meals} BYO meals but Shopify credentials not set`);
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

  // Aggregate by family — BYO demand counts toward the SKU's actual package_type
  const demandByFamily = { MWL: 0, MLM: 0, WWL: 0, WLM: 0, LOW_CARB: 0, BYO: 0 };
  allDemandRecords.forEach(d => {
    if (d.demand_type === 'byo') {
      demandByFamily.BYO = (demandByFamily.BYO || 0) + d.quantity;
    } else {
      const sku = skuById[d.sku_id];
      if (sku?.package_type) {
        demandByFamily[sku.package_type] = (demandByFamily[sku.package_type] || 0) + d.quantity;
      }
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

  // Mark orders as demand_calculated (including BYO)
  for (const order of orders) {
    const hasMeals = (order.mwl_meals || 0) + (order.mlm_meals || 0) + (order.wwl_meals || 0) + (order.wlm_meals || 0) + (order.lc_meals || 0) + (order.byo_meals || 0) > 0;
    if (hasMeals) {
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