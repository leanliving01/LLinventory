import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

async function withRetry(fn, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try { return await fn(); } catch (err) {
      if (err.status === 429 && i < retries - 1) { await delay((i + 1) * 3000); } else { throw err; }
    }
  }
}

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

function parseOrderToHistorical(order, byoProductIds, packageLookup, skuByMealNameNorm) {
  const orderTags = order.tags || '';
  let mwlMeals = 0, mlmMeals = 0, wwlMeals = 0, wlmMeals = 0, lcMeals = 0, totalMeals = 0;
  const byoItems = [];

  for (const li of (order.line_items || [])) {
    const qty = li.quantity || 0;
    if (isExcluded(li)) continue;

    if (isBYOItem(li, orderTags, byoProductIds)) {
      const titleLower = (li.title || '').toLowerCase();
      if (/^(men|women|male|female|ladies).*(meal|pack)/i.test(li.title || '')) continue;
      if (titleLower.includes('build your own') || titleLower.includes('byo')) continue;

      const titleNorm = normalizeName(li.title);
      const matchedSku = skuByMealNameNorm[titleNorm];
      if (matchedSku) {
        byoItems.push({ sku_id: matchedSku.id, quantity: qty });
        totalMeals += qty;
      }
      continue;
    }

    const variantId = String(li.variant_id || '');
    const productId = String(li.product_id || '');
    let matched = packageLookup.byVariant[variantId];
    if (!matched && packageLookup.byProduct[productId]) {
      const lineSku = (li.sku || '').toLowerCase();
      matched = packageLookup.byProduct[productId].find(p => p.shopify_sku && p.shopify_sku.toLowerCase() === lineSku);
    }

    if (matched) {
      const mealCount = matched.pack_size * qty;
      totalMeals += mealCount;
      switch (matched.package_family) {
        case 'MWL': mwlMeals += mealCount; break;
        case 'MLM': mlmMeals += mealCount; break;
        case 'WWL': wwlMeals += mealCount; break;
        case 'WLM': wlmMeals += mealCount; break;
        case 'LOW_CARB': lcMeals += mealCount; break;
      }
    }
  }

  return {
    shopify_order_id: String(order.id),
    order_number: order.name || `#${order.order_number}`,
    order_date: order.created_at,
    mwl_meals: mwlMeals,
    mlm_meals: mlmMeals,
    wwl_meals: wwlMeals,
    wlm_meals: wlmMeals,
    lc_meals: lcMeals,
    byo_items: byoItems.length > 0 ? JSON.stringify(byoItems) : '',
    total_meals: totalMeals,
    synced_at: new Date().toISOString(),
  };
}

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me();
  if (!user || user.role !== 'admin') {
    return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
  }

  const storeDomain = Deno.env.get('SHOPIFY_STORE_DOMAIN');
  const accessToken = Deno.env.get('SHOPIFY_ACCESS_TOKEN');
  if (!storeDomain || !accessToken) {
    return Response.json({ error: 'Shopify credentials not configured' }, { status: 400 });
  }

  // Load master data for order parsing
  const [packages, skus] = await Promise.all([
    base44.asServiceRole.entities.PackageProduct.filter({}),
    base44.asServiceRole.entities.SKU.filter({}),
  ]);

  const packageLookup = buildPackageLookup(packages);

  // Build BYO meal name → SKU lookup
  const skuByMealNameNorm = {};
  skus.forEach(s => {
    if (s.is_active === false || !s.meal_name) return;
    const key = normalizeName(s.meal_name);
    if (!skuByMealNameNorm[key] || s.package_type === 'MWL' || (s.package_type === 'LOW_CARB' && skuByMealNameNorm[key].package_type !== 'MWL')) {
      skuByMealNameNorm[key] = s;
    }
  });

  // Fetch BYO product IDs from Shopify
  const byoProductIds = new Set();
  const apiHeaders = { 'X-Shopify-Access-Token': accessToken, 'Content-Type': 'application/json' };
  let prodUrl = `https://${storeDomain}/admin/api/2024-01/products.json?limit=250&status=active`;
  while (prodUrl) {
    const prodRes = await fetch(prodUrl, { headers: apiHeaders });
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
  console.log(`Loaded ${byoProductIds.size} BYO product IDs, ${packages.length} packages`);

  // Load existing historical orders — build a Set of shopify_order_id for dedup
  const existingHistorical = await base44.asServiceRole.entities.HistoricalOrder.filter({});
  const existingIds = new Set();
  existingHistorical.forEach(h => {
    if (h.shopify_order_id) existingIds.add(h.shopify_order_id);
  });
  console.log(`Existing historical orders: ${existingIds.size}`);

  // Fetch ALL paid orders from Shopify in 2-week chunks (as far back as API allows)
  const now = new Date();
  const sixMonthsAgo = new Date(now);
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

  const chunkRanges = [];
  const chunkCursor = new Date(sixMonthsAgo);
  while (chunkCursor < now) {
    const chunkStart = new Date(chunkCursor);
    chunkCursor.setDate(chunkCursor.getDate() + 14);
    const chunkEnd = chunkCursor < now ? new Date(chunkCursor) : new Date(now);
    chunkRanges.push({ start: chunkStart.toISOString(), end: chunkEnd.toISOString() });
  }

  let totalFetched = 0;
  let totalNew = 0;

  for (const range of chunkRanges) {
    let pageUrl = `https://${storeDomain}/admin/api/2024-01/orders.json?status=any&financial_status=paid&created_at_min=${range.start}&created_at_max=${range.end}&limit=250`;

    while (pageUrl) {
      const res = await fetch(pageUrl, { headers: apiHeaders });
      if (!res.ok) {
        console.error(`Shopify API error for chunk ${range.start.slice(0, 10)}: ${res.status}`);
        break;
      }
      const data = await res.json();
      const orders = data.orders || [];
      totalFetched += orders.length;

      // Parse and filter to only new orders (not already in historical archive)
      const newOrders = [];
      for (const order of orders) {
        const sid = String(order.id);
        if (existingIds.has(sid)) continue; // Already archived — skip
        const parsed = parseOrderToHistorical(order, byoProductIds, packageLookup, skuByMealNameNorm);
        if (parsed.total_meals > 0) {
          newOrders.push(parsed);
          existingIds.add(sid); // Mark as seen so we don't create duplicates within this run
        }
      }

      // Bulk create new historical orders
      if (newOrders.length > 0) {
        for (let i = 0; i < newOrders.length; i += 25) {
          const batch = newOrders.slice(i, i + 25);
          await withRetry(() => base44.asServiceRole.entities.HistoricalOrder.bulkCreate(batch));
          await delay(500);
        }
        totalNew += newOrders.length;
      }

      const linkHeader = res.headers.get('Link') || '';
      const nextMatch = linkHeader.match(/<([^>]+)>;\s*rel="next"/);
      pageUrl = nextMatch ? nextMatch[1] : null;
      await delay(300);
    }
  }

  console.log(`Sync complete: ${totalFetched} fetched from Shopify, ${totalNew} new orders archived`);

  // Audit log
  await base44.asServiceRole.entities.AuditLog.create({
    action: 'sync',
    entity_type: 'HistoricalOrder',
    description: `Historical order sync: ${totalFetched} orders from Shopify, ${totalNew} new orders archived. Total in archive: ${existingIds.size}.`,
  });

  return Response.json({
    success: true,
    shopify_orders_fetched: totalFetched,
    new_orders_archived: totalNew,
    total_in_archive: existingIds.size,
    previously_archived: existingIds.size - totalNew,
  });
});