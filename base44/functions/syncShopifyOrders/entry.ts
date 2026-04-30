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

    // Match by Shopify variant_id (most precise) or product_id + pack size
    const variantId = String(li.variant_id || '');
    const productId = String(li.product_id || '');
    
    // Try exact variant match first
    let matched = packageLookup.byVariant[variantId];
    
    // Fallback: match by product_id (all variants share a product_id per family)
    if (!matched && packageLookup.byProduct[productId]) {
      // Multiple variants share same product_id — use SKU to disambiguate
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
    // If no match, the line item is silently skipped (not a known package)
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

async function withRetry(fn, retries = 4) {
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (err) {
      if (err.status === 429 && i < retries - 1) {
        const waitTime = (i + 1) * 3000;
        console.log(`Rate limited, waiting ${waitTime/1000}s...`);
        await delay(waitTime);
      } else {
        throw err;
      }
    }
  }
}

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me();
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const action = body.action || 'batch'; // 'fetch' or 'batch'

  const storeDomain = Deno.env.get('SHOPIFY_STORE_DOMAIN');
  const accessToken = Deno.env.get('SHOPIFY_ACCESS_TOKEN');
  if (!storeDomain || !accessToken) return Response.json({ error: 'Shopify credentials not configured' }, { status: 400 });

  // ─── Load PackageProduct master data for ID-based matching ───
  const packages = await base44.asServiceRole.entities.PackageProduct.filter({});
  const packageLookup = buildPackageLookup(packages);
  console.log(`Loaded ${packages.length} package products for ID matching`);

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
  console.log(`Loaded ${byoProductIds.size} BYO product IDs`);

  // ─── STEP 1: Frontend calls with action='fetch' to get all Shopify orders ───
  if (action === 'fetch') {
    let allOrders = [];
    let pageUrl = `https://${storeDomain}/admin/api/2024-01/orders.json?status=open&financial_status=paid&fulfillment_status=unfulfilled&limit=250`;

    while (pageUrl) {
      const res = await fetch(pageUrl, {
        headers: { 'X-Shopify-Access-Token': accessToken, 'Content-Type': 'application/json' },
      });
      if (!res.ok) return Response.json({ error: `Shopify API error: ${res.status}` }, { status: 502 });
      const data = await res.json();
      allOrders = allOrders.concat(data.orders || []);
      const linkHeader = res.headers.get('Link') || '';
      const nextMatch = linkHeader.match(/<([^>]+)>;\s*rel="next"/);
      pageUrl = nextMatch ? nextMatch[1] : null;
    }

    // Parse all orders using ID-based matching
    const parsed = allOrders.map(o => parseOrder(o, byoProductIds, packageLookup));

    // Get existing orders for dedup mapping
    const existingOrders = await base44.asServiceRole.entities.ShopifyOrder.filter({});
    const existingMap = {};
    existingOrders.forEach(o => {
      if (o.shopify_order_id) existingMap[o.shopify_order_id] = o.id;
      if (o.order_number) existingMap[o.order_number] = o.id;
    });

    // Tag each with existing ID or null
    const orders = parsed.map(p => ({
      ...p,
      _existingId: existingMap[p.shopify_order_id] || existingMap[p.order_number] || null,
    }));

    return Response.json({ total: orders.length, orders });
  }

  // ─── STEP 2: Frontend calls with action='batch' to process a chunk ───
  if (action === 'batch') {
    const ordersToProcess = body.orders || [];
    let created = 0, updated = 0;

    const toCreate = ordersToProcess.filter(o => !o._existingId);
    const toUpdate = ordersToProcess.filter(o => o._existingId);

    if (toCreate.length > 0) {
      const createData = toCreate.map(({ _existingId, ...rest }) => rest);
      await withRetry(() => base44.asServiceRole.entities.ShopifyOrder.bulkCreate(createData));
      created = toCreate.length;
      await delay(1000);
    }

    for (let i = 0; i < toUpdate.length; i++) {
      const { _existingId, shopify_order_id, order_number, order_date, ...updateData } = toUpdate[i];
      await withRetry(() => base44.asServiceRole.entities.ShopifyOrder.update(_existingId, updateData));
      updated++;
      if ((i + 1) % 5 === 0) await delay(1500);
    }

    return Response.json({ created, updated, processed: ordersToProcess.length });
  }

  // ─── STEP 3: action='reconcile' — mark locally-unfulfilled orders that Shopify has fulfilled ───
  if (action === 'reconcile') {
    // Get all local ShopifyOrder records that are still unfulfilled
    const localUnfulfilled = await base44.asServiceRole.entities.ShopifyOrder.filter(
      { paid_status: 'paid', fulfilment_status: 'unfulfilled' }, '-order_date', 500
    );
    if (localUnfulfilled.length === 0) {
      return Response.json({ reconciled: 0, message: 'No unfulfilled orders to reconcile' });
    }

    // Build a set of Shopify order IDs that are CURRENTLY open+unfulfilled on Shopify
    // (we already fetched these in 'fetch' — caller passes them)
    const openShopifyIds = new Set((body.open_shopify_ids || []).map(String));

    let reconciled = 0;
    for (const local of localUnfulfilled) {
      const sid = local.shopify_order_id;
      if (!sid) continue;
      // If this order is NOT in the open list from Shopify, it's been fulfilled/cancelled/refunded
      if (!openShopifyIds.has(sid)) {
        // Query Shopify for the actual current status
        const orderUrl = `https://${storeDomain}/admin/api/2024-01/orders/${sid}.json?fields=id,financial_status,fulfillment_status,cancelled_at`;
        const res = await fetch(orderUrl, {
          headers: { 'X-Shopify-Access-Token': accessToken, 'Content-Type': 'application/json' },
        });
        if (res.ok) {
          const { order: shopOrder } = await res.json();
          const fs = shopOrder?.fulfillment_status || '';
          const fin = (shopOrder?.financial_status || '').toLowerCase();
          const cancelled = !!shopOrder?.cancelled_at;

          let newFulfilment = 'unfulfilled';
          let newPaid = local.paid_status;
          if (cancelled) { newPaid = 'refunded'; newFulfilment = 'restocked'; }
          else if (fin === 'refunded') { newPaid = 'refunded'; }
          else if (fs === 'fulfilled') { newFulfilment = 'fulfilled'; }
          else if (fs === 'partial') { newFulfilment = 'partial'; }

          if (newFulfilment !== 'unfulfilled' || newPaid !== local.paid_status) {
            await withRetry(() => base44.asServiceRole.entities.ShopifyOrder.update(local.id, {
              fulfilment_status: newFulfilment,
              paid_status: newPaid,
              synced_at: new Date().toISOString(),
            }));
            reconciled++;
          }
        }
        // Rate-limit Shopify API calls
        if (reconciled % 3 === 0) await delay(1000);
      }
    }

    return Response.json({ reconciled, checked: localUnfulfilled.length });
  }

  return Response.json({ error: 'Unknown action. Use fetch, batch, or reconcile.' }, { status: 400 });
});