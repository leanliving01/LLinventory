import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me();
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const storeDomain = Deno.env.get('SHOPIFY_STORE_DOMAIN');
  const accessToken = Deno.env.get('SHOPIFY_ACCESS_TOKEN');

  let allProducts = [];
  let pageUrl = `https://${storeDomain}/admin/api/2024-01/products.json?limit=250`;
  while (pageUrl) {
    const res = await fetch(pageUrl, {
      headers: { 'X-Shopify-Access-Token': accessToken, 'Content-Type': 'application/json' },
    });
    if (!res.ok) return Response.json({ error: `Shopify error: ${res.status}` }, { status: 502 });
    const data = await res.json();
    allProducts = allProducts.concat(data.products || []);
    const linkHeader = res.headers.get('Link') || '';
    const nextMatch = linkHeader.match(/<([^>]+)>;\s*rel="next"/);
    pageUrl = nextMatch ? nextMatch[1] : null;
  }

  // Filter to package products (Men's/Women's weight loss/lean muscle, Low Carb Package)
  const packageKeywords = ['weight loss', 'lean muscle', 'low carb package', 'smart carb'];
  const packages = allProducts.filter(p => {
    const title = (p.title || '').toLowerCase();
    return packageKeywords.some(kw => title.includes(kw));
  });

  const result = packages.map(p => ({
    product_id: String(p.id),
    title: p.title,
    tags: p.tags,
    variants: (p.variants || []).map(v => ({
      variant_id: String(v.id),
      title: v.title,
      sku: v.sku,
      price: v.price,
    })),
  }));

  return Response.json({ packages: result });
});