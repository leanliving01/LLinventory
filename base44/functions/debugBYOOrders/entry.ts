import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me();
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const storeDomain = Deno.env.get('SHOPIFY_STORE_DOMAIN');
  const accessToken = Deno.env.get('SHOPIFY_ACCESS_TOKEN');

  // Step 1: Get BYO product IDs
  const byoProductIds = new Set();
  let prodUrl = `https://${storeDomain}/admin/api/2024-01/products.json?limit=250&status=active`;
  while (prodUrl) {
    const prodRes = await fetch(prodUrl, {
      headers: { 'X-Shopify-Access-Token': accessToken, 'Content-Type': 'application/json' },
    });
    if (!prodRes.ok) {
      return Response.json({ error: `Product fetch error: ${prodRes.status}` }, { status: 502 });
    }
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
  }

  console.log(`Found ${byoProductIds.size} BYO product IDs:`, [...byoProductIds]);

  // Step 2: Get a few orders and check their line items
  const orderRes = await fetch(
    `https://${storeDomain}/admin/api/2024-01/orders.json?status=open&financial_status=paid&fulfillment_status=unfulfilled&limit=10`,
    { headers: { 'X-Shopify-Access-Token': accessToken, 'Content-Type': 'application/json' } }
  );
  const { orders } = await orderRes.json();

  const orderDetails = orders.map(o => ({
    order_number: o.name,
    tags: o.tags,
    line_items: (o.line_items || []).map(li => ({
      title: li.title,
      variant_title: li.variant_title,
      product_id: String(li.product_id),
      quantity: li.quantity,
      is_byo_product: byoProductIds.has(String(li.product_id)),
      sku: li.sku,
    })),
  }));

  return Response.json({
    byo_product_count: byoProductIds.size,
    byo_product_ids_sample: [...byoProductIds].slice(0, 10),
    orders: orderDetails,
  });
});