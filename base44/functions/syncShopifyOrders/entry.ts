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

function getMealType(productTitle, variantTitle) {
  const title = (productTitle || '').toLowerCase();
  const variant = (variantTitle || '').toLowerCase();
  if (title.includes('low carb') || title.includes('smart carb') || title.includes('low-carb')) return 'LOW_CARB';
  // IMPORTANT: Check women BEFORE men — "women" contains "men" as a substring
  if (title.includes('lean muscle') && (title.includes("women") || title.includes("woman") || title.includes("female") || title.includes("ladies"))) return 'WLM';
  if (title.includes('weight loss') && (title.includes("women") || title.includes("woman") || title.includes("female") || title.includes("ladies"))) return 'WWL';
  if (title.includes('lean muscle') && (title.includes("men") || title.includes("man") || title.includes("male"))) return 'MLM';
  if (title.includes('weight loss') && (title.includes("men") || title.includes("man") || title.includes("male"))) return 'MWL';
  if (variant.includes('lean muscle')) {
    if (variant.includes("women") || variant.includes("female") || variant.includes("ladies")) return 'WLM';
    if (variant.includes("men") || variant.includes("male")) return 'MLM';
  }
  if (variant.includes('weight loss')) {
    if (variant.includes("women") || variant.includes("female") || variant.includes("ladies")) return 'WWL';
    if (variant.includes("men") || variant.includes("male")) return 'MWL';
  }
  return null;
}

function getPackSize(variantTitle) {
  const v = (variantTitle || '').toLowerCase();
  if (v.includes('60') || v.includes('ultimate')) return 60;
  if (v.includes('30') || v.includes('serious')) return 30;
  if (v.includes('15') || v.includes('starter')) return 15;
  const match = v.match(/(\d+)\s*(meal|pack)/i);
  if (match) return parseInt(match[1], 10);
  return 0;
}

function isBYOItem(lineItem, orderTags, byoProductIds) {
  const title = (lineItem.title || '').toLowerCase();
  const tags = (orderTags || '').toLowerCase();
  const tagList = tags.split(',').map(t => t.trim());
  const productId = String(lineItem.product_id || '');
  if (byoProductIds.has(productId)) return true;
  return title.includes('build your own') || title.includes('byo') || tagList.includes('byo meals') || tagList.includes('byo');
}

function parseOrder(order, byoProductIds) {
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
    const mealType = getMealType(li.title, li.variant_title);
    const packSize = getPackSize(li.variant_title);
    if (mealType && packSize > 0) {
      const mealCount = packSize * qty;
      totalMeals += mealCount;
      switch (mealType) {
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

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

async function withRetry(fn, retries = 4) {
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (err) {
      if (err.status === 429 && i < retries - 1) {
        const waitTime = (i + 1) * 3000; // 3s, 6s, 9s, 12s
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

  // ─── STEP 0: Fetch BYO product IDs (products tagged "BYO Meals") ───
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

    // Parse all orders in memory
    const parsed = allOrders.map(o => parseOrder(o, byoProductIds));

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
  const ordersToProcess = body.orders || [];
  let created = 0, updated = 0;

  // Separate creates and updates
  const toCreate = ordersToProcess.filter(o => !o._existingId);
  const toUpdate = ordersToProcess.filter(o => o._existingId);

  // Bulk create new orders
  if (toCreate.length > 0) {
    const createData = toCreate.map(({ _existingId, ...rest }) => rest);
    await withRetry(() => base44.asServiceRole.entities.ShopifyOrder.bulkCreate(createData));
    created = toCreate.length;
    await delay(1000);
  }

  // Update existing orders one by one with delays
  for (let i = 0; i < toUpdate.length; i++) {
    const { _existingId, shopify_order_id, order_number, order_date, ...updateData } = toUpdate[i];
    await withRetry(() => base44.asServiceRole.entities.ShopifyOrder.update(_existingId, updateData));
    updated++;
    // Delay every 5 updates
    if ((i + 1) % 5 === 0) await delay(1500);
  }

  return Response.json({ created, updated, processed: ordersToProcess.length });
});