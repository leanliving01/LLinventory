import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me();
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const storeDomain = Deno.env.get('SHOPIFY_STORE_DOMAIN');
  const accessToken = Deno.env.get('SHOPIFY_ACCESS_TOKEN');

  // Step 1: Get BYO product IDs
  const byoProductIds = new Set();
  const byoProductNames = {};
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
        byoProductIds.add(String(p.id));
        byoProductNames[String(p.id)] = p.title;
      }
    });
    const linkHeader = prodRes.headers.get('Link') || '';
    const nextMatch = linkHeader.match(/<([^>]+)>;\s*rel="next"/);
    prodUrl = nextMatch ? nextMatch[1] : null;
  }

  // Step 2: Get ALL orders and find ones with BYO line items
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

  // Find orders containing BYO products
  const byoOrders = [];
  for (const order of allOrders) {
    const byoLines = (order.line_items || []).filter(li => byoProductIds.has(String(li.product_id)));
    if (byoLines.length > 0) {
      byoOrders.push({
        order_number: order.name,
        tags: order.tags,
        byo_line_items: byoLines.map(li => ({
          title: li.title,
          variant_title: li.variant_title,
          product_id: String(li.product_id),
          quantity: li.quantity,
        })),
        all_line_items: (order.line_items || []).map(li => ({
          title: li.title,
          product_id: String(li.product_id),
          quantity: li.quantity,
          is_byo: byoProductIds.has(String(li.product_id)),
        })),
      });
    }
  }

  return Response.json({
    total_orders: allOrders.length,
    byo_product_count: byoProductIds.size,
    byo_product_names: byoProductNames,
    orders_with_byo_items: byoOrders.length,
    byo_orders: byoOrders.slice(0, 10),
  });
});