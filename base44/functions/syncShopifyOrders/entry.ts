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
  if (title.includes('lean muscle') && (title.includes("men") || title.includes("man") || title.includes("male"))) return 'MLM';
  if (title.includes('weight loss') && (title.includes("men") || title.includes("man") || title.includes("male"))) return 'MWL';
  if (title.includes('lean muscle') && (title.includes("women") || title.includes("woman") || title.includes("female") || title.includes("ladies"))) return 'WLM';
  if (title.includes('weight loss') && (title.includes("women") || title.includes("woman") || title.includes("female") || title.includes("ladies"))) return 'WWL';

  if (variant.includes('lean muscle')) {
    if (variant.includes("men") || variant.includes("male")) return 'MLM';
    if (variant.includes("women") || variant.includes("female") || variant.includes("ladies")) return 'WLM';
  }
  if (variant.includes('weight loss')) {
    if (variant.includes("men") || variant.includes("male")) return 'MWL';
    if (variant.includes("women") || variant.includes("female") || variant.includes("ladies")) return 'WWL';
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

function isBYOItem(lineItem, orderTags) {
  const title = (lineItem.title || '').toLowerCase();
  const tags = (orderTags || '').toLowerCase();
  return title.includes('build your own') || title.includes('byo') || tags.includes('byo meals');
}

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

// Parse one Shopify order into our order data
function parseOrder(order) {
  const orderTags = order.tags || '';
  let mwlMeals = 0, mlmMeals = 0, wwlMeals = 0, wlmMeals = 0, lcMeals = 0, byoMeals = 0, totalMeals = 0;
  let orderIsByo = false;

  for (const li of (order.line_items || [])) {
    const qty = li.quantity || 0;
    if (isExcluded(li)) continue;

    if (isBYOItem(li, orderTags)) {
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

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me();
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const storeDomain = Deno.env.get('SHOPIFY_STORE_DOMAIN');
  const accessToken = Deno.env.get('SHOPIFY_ACCESS_TOKEN');
  if (!storeDomain || !accessToken) return Response.json({ error: 'Shopify credentials not configured' }, { status: 400 });

  // Fetch ALL paid unfulfilled orders from Shopify (handle pagination)
  let allShopifyOrders = [];
  let pageUrl = `https://${storeDomain}/admin/api/2024-01/orders.json?status=open&financial_status=paid&fulfillment_status=unfulfilled&limit=250`;

  while (pageUrl) {
    const res = await fetch(pageUrl, {
      headers: { 'X-Shopify-Access-Token': accessToken, 'Content-Type': 'application/json' },
    });
    if (!res.ok) {
      return Response.json({ error: `Shopify API error: ${res.status}` }, { status: 502 });
    }
    const data = await res.json();
    allShopifyOrders = allShopifyOrders.concat(data.orders || []);

    // Check for next page via Link header
    const linkHeader = res.headers.get('Link') || '';
    const nextMatch = linkHeader.match(/<([^>]+)>;\s*rel="next"/);
    pageUrl = nextMatch ? nextMatch[1] : null;
  }

  console.log(`Fetched ${allShopifyOrders.length} orders from Shopify`);

  // Load existing orders in one call
  const existingOrders = await base44.asServiceRole.entities.ShopifyOrder.filter({});
  const existingMap = {};
  existingOrders.forEach(o => {
    if (o.shopify_order_id) existingMap[o.shopify_order_id] = o;
    if (o.order_number) existingMap[o.order_number] = o;
  });

  // Parse all orders in memory (no API calls)
  const toCreate = [];
  const toUpdate = [];

  for (const order of allShopifyOrders) {
    const parsed = parseOrder(order);
    const existing = existingMap[parsed.shopify_order_id] || existingMap[parsed.order_number];

    if (existing) {
      toUpdate.push({ id: existing.id, data: parsed });
    } else {
      toCreate.push(parsed);
    }
  }

  console.log(`To create: ${toCreate.length}, to update: ${toUpdate.length}`);

  // Bulk create new orders in batches of 50
  let created = 0;
  for (let i = 0; i < toCreate.length; i += 50) {
    const batch = toCreate.slice(i, i + 50);
    await base44.asServiceRole.entities.ShopifyOrder.bulkCreate(batch);
    created += batch.length;
    console.log(`Created batch ${Math.floor(i/50)+1}: ${batch.length} orders`);
    if (i + 50 < toCreate.length) await delay(500);
  }

  // Update existing orders in batches of 10 with delays
  let updated = 0;
  for (let i = 0; i < toUpdate.length; i++) {
    const { id, data } = toUpdate[i];
    // Don't send shopify_order_id/order_number on updates
    const { shopify_order_id, order_number, order_date, ...updateData } = data;
    await base44.asServiceRole.entities.ShopifyOrder.update(id, updateData);
    updated++;
    // Delay every 10 updates
    if ((i + 1) % 10 === 0) {
      console.log(`Updated ${i+1}/${toUpdate.length} orders`);
      await delay(500);
    }
  }

  // Audit log
  await base44.asServiceRole.entities.AuditLog.create({
    action: 'sync',
    entity_type: 'ShopifyOrder',
    description: `Synced ${allShopifyOrders.length} Shopify orders (${created} new, ${updated} updated)`,
  });

  return Response.json({
    success: true,
    total: allShopifyOrders.length,
    created,
    updated,
  });
});