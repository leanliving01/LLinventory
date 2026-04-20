import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

// ─── BYO product ID set ───
const BYO_PRODUCT_IDS = new Set();

function isExcluded(lineItem) {
  const title = (lineItem.title || '').toLowerCase();
  const sku = (lineItem.sku || '').toLowerCase();
  if (title.includes('supplement')) return true;
  if (title.includes('low calorie sauce') || title.includes('sauce')) return true;
  if (title.includes('90-day reset') || title.includes('90 day reset')) return true;
  if (sku === 'l90c2') return true;
  if (title.includes('dry ice') || title.includes('cooler box') || title.includes('delivery')) return true;
  if (title.includes('snack') && !title.includes('meal')) return true;
  return false;
}

function isBYOItem(lineItem, orderTags) {
  const title = (lineItem.title || '').toLowerCase();
  const tags = (orderTags || '').toLowerCase();
  const tagList = tags.split(',').map(t => t.trim());
  const productId = String(lineItem.product_id || '');
  if (BYO_PRODUCT_IDS.has(productId)) return true;
  return title.includes('build your own') || title.includes('byo') || tagList.includes('byo meals') || tagList.includes('byo');
}

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me();
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const storeDomain = Deno.env.get('SHOPIFY_STORE_DOMAIN');
  const accessToken = Deno.env.get('SHOPIFY_ACCESS_TOKEN');

  // Load BYO product IDs
  let prodUrl = `https://${storeDomain}/admin/api/2024-01/products.json?limit=250&status=active`;
  while (prodUrl) {
    const prodRes = await fetch(prodUrl, {
      headers: { 'X-Shopify-Access-Token': accessToken, 'Content-Type': 'application/json' },
    });
    if (!prodRes.ok) break;
    const prodData = await prodRes.json();
    (prodData.products || []).forEach(p => {
      const tags = (p.tags || '').split(',').map(t => t.trim().toLowerCase());
      if (tags.includes('byo meals') || tags.includes('byo')) {
        BYO_PRODUCT_IDS.add(String(p.id));
      }
    });
    const linkHeader = prodRes.headers.get('Link') || '';
    const nextMatch = linkHeader.match(/<([^>]+)>;\s*rel="next"/);
    prodUrl = nextMatch ? nextMatch[1] : null;
  }

  // Get ALL orders
  let allOrders = [];
  let pageUrl = `https://${storeDomain}/admin/api/2024-01/orders.json?status=open&financial_status=paid&fulfillment_status=unfulfilled&limit=250`;
  while (pageUrl) {
    const res = await fetch(pageUrl, {
      headers: { 'X-Shopify-Access-Token': accessToken, 'Content-Type': 'application/json' },
    });
    if (!res.ok) break;
    const data = await res.json();
    allOrders = allOrders.concat(data.orders || []);
    const linkHeader = res.headers.get('Link') || '';
    const nextMatch = linkHeader.match(/<([^>]+)>;\s*rel="next"/);
    pageUrl = nextMatch ? nextMatch[1] : null;
  }

  // Process and find BYO orders
  const byoOrders = [];
  let totalByo = 0;

  for (const order of allOrders) {
    const orderTags = order.tags || '';
    let byoMeals = 0;
    for (const li of (order.line_items || [])) {
      if (isExcluded(li)) continue;
      if (isBYOItem(li, orderTags)) {
        byoMeals += li.quantity || 0;
      }
    }
    if (byoMeals > 0) {
      totalByo += byoMeals;
      byoOrders.push({
        order_number: order.name,
        customer: order.customer ? `${order.customer.first_name || ''} ${order.customer.last_name || ''}`.trim() : '',
        byo_meals: byoMeals,
        total_line_items: (order.line_items || []).length,
      });
    }
  }

  return Response.json({
    byo_product_ids_count: BYO_PRODUCT_IDS.size,
    total_orders: allOrders.length,
    orders_with_byo: byoOrders.length,
    total_byo_meals: totalByo,
    byo_orders: byoOrders,
  });
});