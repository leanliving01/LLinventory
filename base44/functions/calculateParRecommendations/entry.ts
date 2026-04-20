import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

async function withRetry(fn, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try { return await fn(); } catch (err) {
      if (err.status === 429 && i < retries - 1) { await delay((i + 1) * 3000); } else { throw err; }
    }
  }
}

// ─── Exclusion logic (same as sync functions) ───
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

function isBYOItem(lineItem, orderTags, byoProductIds) {
  const title = (lineItem.title || '').toLowerCase();
  const tags = (orderTags || '').toLowerCase();
  const tagList = tags.split(',').map(t => t.trim());
  const productId = String(lineItem.product_id || '');
  if (byoProductIds.has(productId)) return true;
  return title.includes('build your own') || title.includes('byo') || tagList.includes('byo meals') || tagList.includes('byo');
}

function normalizeName(name) {
  let n = (name || '').toLowerCase();
  n = n.replace(/\(\s*\d+\s*g\s*\)/g, '');
  n = n.replace(/chili/g, 'chilli');
  return n.replace(/[^a-z0-9]/g, '');
}

function buildPackageLookup(packages) {
  const byVariant = {};
  const byProduct = {};
  for (const p of packages) {
    if (p.is_active === false) continue;
    if (p.shopify_variant_id) byVariant[p.shopify_variant_id] = p;
    if (p.shopify_product_id) {
      if (!byProduct[p.shopify_product_id]) byProduct[p.shopify_product_id] = [];
      byProduct[p.shopify_product_id].push(p);
    }
  }
  return { byVariant, byProduct };
}

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);

  const storeDomain = Deno.env.get('SHOPIFY_STORE_DOMAIN');
  const accessToken = Deno.env.get('SHOPIFY_ACCESS_TOKEN');
  if (!storeDomain || !accessToken) {
    return Response.json({ error: 'Shopify credentials not configured' }, { status: 400 });
  }

  // Load master data from Base44
  const [skus, parLevels, packages, bomLines, existingRecs] = await Promise.all([
    base44.asServiceRole.entities.SKU.filter({}),
    base44.asServiceRole.entities.ParLevel.filter({}),
    base44.asServiceRole.entities.PackageProduct.filter({}),
    base44.asServiceRole.entities.PackageBOMLine.filter({}),
    base44.asServiceRole.entities.ParLevelRecommendation.filter({ status: 'pending' }),
  ]);

  console.log(`Loaded: ${skus.length} SKUs, ${packages.length} packages, ${bomLines.length} BOM lines`);

  // Build lookups
  const parBySkuId = {};
  parLevels.forEach(p => { parBySkuId[p.sku_id] = p; });

  const packageLookup = buildPackageLookup(packages);

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

  // BYO meal name matching
  const skuByMealNameNorm = {};
  skus.forEach(s => {
    if (s.is_active === false || !s.meal_name) return;
    const key = normalizeName(s.meal_name);
    if (!skuByMealNameNorm[key] || s.package_type === 'MWL' || (s.package_type === 'LOW_CARB' && skuByMealNameNorm[key].package_type !== 'MWL')) {
      skuByMealNameNorm[key] = s;
    }
  });

  // ─── Fetch BYO product IDs from Shopify ───
  const byoProductIds = new Set();
  let prodUrl = `https://${storeDomain}/admin/api/2024-01/products.json?limit=250&status=active`;
  while (prodUrl) {
    const prodRes = await fetch(prodUrl, {
      headers: { 'X-Shopify-Access-Token': accessToken, 'Content-Type': 'application/json' },
    });
    if (prodRes.ok) {
      const prodData = await prodRes.json();
      (prodData.products || []).forEach(p => {
        const tags = (p.tags || '').split(',').map(t => t.trim().toLowerCase());
        if (tags.includes('byo meals') || tags.includes('byo')) byoProductIds.add(String(p.id));
      });
      const linkHeader = prodRes.headers.get('Link') || '';
      const nextMatch = linkHeader.match(/<([^>]+)>;\s*rel="next"/);
      prodUrl = nextMatch ? nextMatch[1] : null;
    } else { prodUrl = null; }
  }
  console.log(`Loaded ${byoProductIds.size} BYO product IDs`);

  // ─── Define 6-month historical window (excluding Dec 2025) ───
  const now = new Date();
  const sixMonthsAgo = new Date(now);
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
  const sinceDate = sixMonthsAgo.toISOString();

  // ─── Fetch ALL historical orders from Shopify (paid, any fulfillment status) ───
  let allShopifyOrders = [];
  let pageUrl = `https://${storeDomain}/admin/api/2024-01/orders.json?status=any&financial_status=paid&created_at_min=${sinceDate}&limit=250`;

  while (pageUrl) {
    const res = await fetch(pageUrl, {
      headers: { 'X-Shopify-Access-Token': accessToken, 'Content-Type': 'application/json' },
    });
    if (!res.ok) {
      console.error(`Shopify API error: ${res.status}`);
      break;
    }
    const data = await res.json();
    allShopifyOrders = allShopifyOrders.concat(data.orders || []);
    const linkHeader = res.headers.get('Link') || '';
    const nextMatch = linkHeader.match(/<([^>]+)>;\s*rel="next"/);
    pageUrl = nextMatch ? nextMatch[1] : null;
    await delay(500); // Rate limit
  }

  console.log(`Fetched ${allShopifyOrders.length} historical orders from Shopify`);

  // ─── Filter out December 2025 orders ───
  const filteredOrders = allShopifyOrders.filter(order => {
    const dt = new Date(order.created_at);
    if (dt.getFullYear() === 2025 && dt.getMonth() === 11) return false; // Skip Dec 2025
    return true;
  });

  const decExcluded = allShopifyOrders.length - filteredOrders.length;
  console.log(`After excluding Dec 2025: ${filteredOrders.length} orders (${decExcluded} excluded)`);

  // ─── For each order, explode into SKU-level demand using BOM ───
  const FAMILY_KEYS = [
    { family: 'MWL' }, { family: 'MLM' }, { family: 'WWL' }, { family: 'WLM' }, { family: 'LOW_CARB' },
  ];

  const demandBySku = {}; // sku_id → total quantity

  for (const order of filteredOrders) {
    const orderTags = order.tags || '';

    // Parse each line item to count meals per family (same logic as sync)
    let familyCounts = { MWL: 0, MLM: 0, WWL: 0, WLM: 0, LOW_CARB: 0 };
    let byoItems = [];

    for (const li of (order.line_items || [])) {
      const qty = li.quantity || 0;
      if (isExcluded(li)) continue;

      if (isBYOItem(li, orderTags, byoProductIds)) {
        // BYO: try to match individual meal to a SKU
        const titleLower = (li.title || '').toLowerCase();
        if (/^(men|women|male|female|ladies).*(meal|pack)/i.test(li.title || '')) continue;
        if (titleLower.includes('build your own') || titleLower.includes('byo')) continue;
        
        const titleNorm = normalizeName(li.title);
        const matchedSku = skuByMealNameNorm[titleNorm];
        if (matchedSku) {
          demandBySku[matchedSku.id] = (demandBySku[matchedSku.id] || 0) + qty;
        }
        continue;
      }

      // Fixed pack: match by variant/product ID
      const variantId = String(li.variant_id || '');
      const productId = String(li.product_id || '');
      let matched = packageLookup.byVariant[variantId];
      if (!matched && packageLookup.byProduct[productId]) {
        const lineSku = (li.sku || '').toLowerCase();
        matched = packageLookup.byProduct[productId].find(p => p.shopify_sku && p.shopify_sku.toLowerCase() === lineSku);
      }

      if (matched) {
        const mealCount = matched.pack_size * qty;
        if (familyCounts[matched.package_family] !== undefined) {
          familyCounts[matched.package_family] += mealCount;
        }
      }
    }

    // Explode fixed pack family counts into SKU demand via BOM
    for (const { family } of FAMILY_KEYS) {
      const mealCount = familyCounts[family];
      if (mealCount === 0) continue;

      const familyPkgs = packagesByFamily[family] || [];
      if (familyPkgs.length === 0) continue;

      // Find best matching package
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
  }

  // ─── Calculate effective weeks (excluding Dec 2025 = 31 days) ───
  const totalDays = Math.ceil((now - sixMonthsAgo) / (1000 * 60 * 60 * 24));
  const effectiveDays = totalDays - 31; // Subtract December 2025
  const effectiveWeeks = Math.max(1, effectiveDays / 7);

  console.log(`Effective period: ${effectiveDays} days (~${effectiveWeeks.toFixed(1)} weeks)`);
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
      notes: `Avg weekly demand: ${avgWeekly.toFixed(1)} units. Total demand: ${Math.round(totalDemand)} over ${effectiveWeeks.toFixed(0)} weeks from ${filteredOrders.length} Shopify orders (excl. Dec 2025). +${SAFETY_BUFFER_PCT}% safety buffer.`,
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
    description: `Par level recommendations calculated from ${filteredOrders.length} Shopify orders (6 months, excl. Dec 2025). ${recommendations.length} SKUs with suggested changes.`,
  });

  return Response.json({
    success: true,
    shopify_orders_fetched: allShopifyOrders.length,
    orders_after_filtering: filteredOrders.length,
    dec_2025_excluded: decExcluded,
    total_skus: skus.filter(s => s.is_active !== false).length,
    skus_with_demand: Object.keys(demandBySku).length,
    recommendations_generated: recommendations.length,
    old_pending_cleared: existingRecs.length,
    effective_weeks: Math.round(effectiveWeeks),
    safety_buffer_pct: SAFETY_BUFFER_PCT,
  });
});