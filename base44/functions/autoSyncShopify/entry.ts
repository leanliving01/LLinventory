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

async function withRetry(fn, label = 'operation', retries = 4) {
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const status = err.status || err.response?.status;
      const isRetryable = status === 429 || status === 500 || status === 502 || status === 503;
      if (isRetryable && attempt < retries - 1) {
        const waitTime = Math.min((attempt + 1) * 3000, 15000);
        console.warn(`[Retry ${attempt + 1}/${retries}] ${label} failed (${status}), waiting ${waitTime / 1000}s...`);
        await delay(waitTime);
      } else {
        console.error(`[FAIL] ${label} after ${attempt + 1} attempts: ${err.message || err}`);
        throw err;
      }
    }
  }
}

// Paginated Shopify fetch with retry
async function fetchAllShopifyOrders(storeDomain, accessToken) {
  let allOrders = [];
  let pageUrl = `https://${storeDomain}/admin/api/2024-01/orders.json?status=open&financial_status=paid&fulfillment_status=unfulfilled&limit=250`;
  let pageNum = 0;

  while (pageUrl) {
    pageNum++;
    const res = await withRetry(async () => {
      const r = await fetch(pageUrl, {
        headers: { 'X-Shopify-Access-Token': accessToken, 'Content-Type': 'application/json' },
      });
      if (!r.ok) {
        const err = new Error(`Shopify API ${r.status}`);
        err.status = r.status;
        throw err;
      }
      return r;
    }, `Shopify orders page ${pageNum}`);

    const data = await res.json();
    allOrders = allOrders.concat(data.orders || []);

    const linkHeader = res.headers.get('Link') || '';
    const nextMatch = linkHeader.match(/<([^>]+)>;\s*rel="next"/);
    pageUrl = nextMatch ? nextMatch[1] : null;

    if (pageUrl) await delay(500); // Respect rate limits
  }

  return allOrders;
}

async function fetchBYOProductIds(storeDomain, accessToken) {
  const byoProductIds = new Set();
  let prodUrl = `https://${storeDomain}/admin/api/2024-01/products.json?limit=250&status=active`;

  while (prodUrl) {
    const prodRes = await withRetry(async () => {
      const r = await fetch(prodUrl, {
        headers: { 'X-Shopify-Access-Token': accessToken, 'Content-Type': 'application/json' },
      });
      if (!r.ok) {
        const err = new Error(`Shopify products API ${r.status}`);
        err.status = r.status;
        throw err;
      }
      return r;
    }, 'Shopify BYO products');

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

    if (prodUrl) await delay(500);
  }

  return byoProductIds;
}

Deno.serve(async (req) => {
  const startTime = Date.now();
  const base44 = createClientFromRequest(req);
  const errors = [];

  const storeDomain = Deno.env.get('SHOPIFY_STORE_DOMAIN');
  const accessToken = Deno.env.get('SHOPIFY_ACCESS_TOKEN');
  if (!storeDomain || !accessToken) {
    return Response.json({ error: 'Shopify not configured' }, { status: 400 });
  }

  try {
    // 1. Load package master data
    const packages = await withRetry(
      () => base44.asServiceRole.entities.PackageProduct.filter({}),
      'Load PackageProducts'
    );
    const packageLookup = buildPackageLookup(packages);
    console.log(`[Sync] Loaded ${packages.length} package products`);

    // 2. Fetch BYO product IDs
    const byoProductIds = await fetchBYOProductIds(storeDomain, accessToken);
    console.log(`[Sync] Loaded ${byoProductIds.size} BYO product IDs`);

    // 3. Fetch ALL Shopify orders (paginated)
    const shopifyOrders = await fetchAllShopifyOrders(storeDomain, accessToken);
    console.log(`[Sync] Fetched ${shopifyOrders.length} Shopify orders`);

    // 4. Load existing orders for dedup
    const existing = await withRetry(
      () => base44.asServiceRole.entities.ShopifyOrder.filter({}),
      'Load existing orders'
    );
    const existingMap = {};
    existing.forEach(o => {
      if (o.shopify_order_id) existingMap[o.shopify_order_id] = o;
      if (o.order_number) existingMap[o.order_number] = o;
    });

    // 5. Parse and diff
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

    // 6. Batch create (chunks of 25)
    let createdCount = 0;
    for (let i = 0; i < toCreate.length; i += 25) {
      const batch = toCreate.slice(i, i + 25);
      await withRetry(
        () => base44.asServiceRole.entities.ShopifyOrder.bulkCreate(batch),
        `Create orders batch ${Math.floor(i / 25) + 1}`
      );
      createdCount += batch.length;
      await delay(1000);
    }

    // 7. Update changed orders
    let updatedCount = 0;
    for (const { id, data } of toUpdate) {
      const { shopify_order_id, order_number, order_date, ...updateData } = data;
      await withRetry(
        () => base44.asServiceRole.entities.ShopifyOrder.update(id, updateData),
        `Update order ${data.order_number}`
      );
      updatedCount++;
      if (updatedCount % 5 === 0) await delay(1500);
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`[Sync] Complete in ${elapsed}s: ${createdCount} created, ${updatedCount} updated, ${shopifyOrders.length} total`);

    // 8. Write audit log for significant syncs
    if (createdCount > 0 || updatedCount > 0) {
      await base44.asServiceRole.entities.AuditLog.create({
        action: 'sync',
        entity_type: 'ShopifyOrder',
        description: `Auto-sync: ${createdCount} new, ${updatedCount} updated (${shopifyOrders.length} total orders, ${elapsed}s)`,
      }).catch(() => {});
    }

    return Response.json({
      success: true,
      created: createdCount,
      updated: updatedCount,
      total_orders: shopifyOrders.length,
      elapsed_seconds: Number(elapsed),
      errors: errors.length > 0 ? errors : undefined,
    });

  } catch (err) {
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.error(`[Sync FAILED] ${err.message} after ${elapsed}s`);

    // Log failure to audit
    await base44.asServiceRole.entities.AuditLog.create({
      action: 'sync',
      entity_type: 'ShopifyOrder',
      description: `Auto-sync FAILED: ${err.message} (after ${elapsed}s)`,
    }).catch(() => {});

    return Response.json({
      success: false,
      error: err.message,
      elapsed_seconds: Number(elapsed),
    }, { status: 500 });
  }
});