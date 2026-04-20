import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

// ─── Exclusion logic: skip non-meal items ───
function isExcluded(lineItem) {
  const title = (lineItem.title || '').toLowerCase();
  const sku = (lineItem.sku || '').toLowerCase();
  const tags = (lineItem.properties || []).map(p => String(p.value || '').toLowerCase()).join(' ');
  if (title.includes('supplement') || tags.includes('supplement')) return true;
  if (title.includes('low calorie sauce') || title.includes('sauce')) return true;
  if (title.includes('90-day reset') || title.includes('90 day reset')) return true;
  if (sku === 'l90c2') return true;
  if (title.includes('dry ice') || title.includes('cooler box') || title.includes('delivery')) return true;
  if (title.includes('snack') && !title.includes('meal')) return true;
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

// ─── ID-based matching using PackageProduct master data ───
function parseOrder(order, byoProductIds, packageLookup) {
  const orderTags = order.tags || '';
  let mwlMeals = 0, mlmMeals = 0, wwlMeals = 0, wlmMeals = 0, lcMeals = 0, byoMeals = 0, totalMeals = 0;
  let orderIsByo = false;

  for (const li of (order.line_items || [])) {
    const qty = li.quantity || 0;
    if (isExcluded(li)) continue;
    if (isBYOItem(li, orderTags, byoProductIds)) {
      orderIsByo = true;
      byoMeals += qty;
      totalMeals += qty;
      continue;
    }

    // Match by Shopify variant_id (most precise) or product_id + SKU
    const variantId = String(li.variant_id || '');
    const productId = String(li.product_id || '');
    
    let matched = packageLookup.byVariant[variantId];
    
    if (!matched && packageLookup.byProduct[productId]) {
      const lineSku = (li.sku || '').toLowerCase();
      matched = packageLookup.byProduct[productId].find(p => 
        p.shopify_sku && p.shopify_sku.toLowerCase() === lineSku
      );
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
    customer_name: order.customer ? `${order.customer.first_name || ''} ${order.customer.last_name || ''}`.trim() : '',
    paid_status: 'paid',
    fulfilment_status: 'unfulfilled',
    tags: orderTags,
    synced_at: new Date().toISOString(),
    total_meals: totalMeals,
    mwl_meals: mwlMeals,
    mlm_meals: mlmMeals,
    wwl_meals: wwlMeals,
    wlm_meals: wlmMeals,
    lc_meals: lcMeals,
    byo_meals: byoMeals,
    is_byo: orderIsByo,
    demand_calculated: false,
  };
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

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

async function withRetry(fn, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try { return await fn(); } catch (err) {
      if (err.status === 429 && i < retries - 1) { await delay((i + 1) * 3000); } else { throw err; }
    }
  }
}

// This function is called by automation — no user auth needed
Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);

  const storeDomain = Deno.env.get('SHOPIFY_STORE_DOMAIN');
  const accessToken = Deno.env.get('SHOPIFY_ACCESS_TOKEN');
  if (!storeDomain || !accessToken) return Response.json({ error: 'Not configured' }, { status: 400 });

  // ─── Load PackageProduct master data for ID-based matching ───
  const packages = await base44.asServiceRole.entities.PackageProduct.filter({});
  const packageLookup = buildPackageLookup(packages);
  console.log(`Auto-sync: loaded ${packages.length} package products for ID matching`);

  // ─── Fetch BYO product IDs (products tagged "BYO Meals") ───
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
        if (tags.includes('byo meals') || tags.includes('byo')) {
          byoProductIds.add(String(p.id));
        }
      });
      const linkHeader = prodRes.headers.get('Link') || '';
      const nextMatch = linkHeader.match(/<([^>]+)>;\s*rel="next"/);
      prodUrl = nextMatch ? nextMatch[1] : null;
    } else {
      prodUrl = null;
    }
  }
  console.log(`Auto-sync: loaded ${byoProductIds.size} BYO product IDs`);

  // Fetch orders
  const url = `https://${storeDomain}/admin/api/2024-01/orders.json?status=open&financial_status=paid&fulfillment_status=unfulfilled&limit=250`;
  const res = await fetch(url, {
    headers: { 'X-Shopify-Access-Token': accessToken, 'Content-Type': 'application/json' },
  });
  if (!res.ok) return Response.json({ error: `Shopify error: ${res.status}` }, { status: 502 });

  const { orders: shopifyOrders } = await res.json();
  console.log(`Auto-sync: fetched ${shopifyOrders.length} orders`);

  // Load existing
  const existing = await base44.asServiceRole.entities.ShopifyOrder.filter({});
  const existingMap = {};
  existing.forEach(o => {
    if (o.shopify_order_id) existingMap[o.shopify_order_id] = o;
    if (o.order_number) existingMap[o.order_number] = o;
  });

  const toCreate = [];
  const toUpdate = [];

  for (const order of shopifyOrders) {
    const parsed = parseOrder(order, byoProductIds, packageLookup);
    const ex = existingMap[parsed.shopify_order_id] || existingMap[parsed.order_number];
    if (ex) {
      if (ex.total_meals !== parsed.total_meals || ex.tags !== parsed.tags || ex.customer_name !== parsed.customer_name) {
        toUpdate.push({ id: ex.id, data: parsed });
      }
    } else {
      toCreate.push(parsed);
    }
  }

  if (toCreate.length > 0) {
    for (let i = 0; i < toCreate.length; i += 25) {
      await withRetry(() => base44.asServiceRole.entities.ShopifyOrder.bulkCreate(toCreate.slice(i, i + 25)));
      await delay(1000);
    }
  }

  for (let i = 0; i < toUpdate.length; i++) {
    const { id, data } = toUpdate[i];
    const { shopify_order_id, order_number, order_date, ...updateData } = data;
    await withRetry(() => base44.asServiceRole.entities.ShopifyOrder.update(id, updateData));
    if ((i + 1) % 5 === 0) await delay(1500);
  }

  console.log(`Auto-sync complete: ${toCreate.length} created, ${toUpdate.length} updated`);
  return Response.json({ created: toCreate.length, updated: toUpdate.length });
});