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
    if (!res.ok) return Response.json({ error: `Shopify API error: ${res.status}` }, { status: 502 });
    const data = await res.json();
    allProducts = allProducts.concat(data.products || []);
    const linkHeader = res.headers.get('Link') || '';
    const nextMatch = linkHeader.match(/<([^>]+)>;\s*rel="next"/);
    pageUrl = nextMatch ? nextMatch[1] : null;
  }

  // Show products tagged "Meals" (not "BYO Meals")
  const mealsTagged = allProducts.filter(p => {
    const tags = (p.tags || '').split(',').map(t => t.trim().toLowerCase());
    return tags.includes('meals');
  });

  // Show products tagged "BYO Meals"
  const byoMealsTagged = allProducts.filter(p => {
    const tags = (p.tags || '').split(',').map(t => t.trim().toLowerCase());
    return tags.includes('byo meals');
  });

  // Non-BYO products
  const nonByo = allProducts.filter(p => {
    const tags = (p.tags || '').split(',').map(t => t.trim().toLowerCase());
    return !tags.includes('byo meals');
  });

  return Response.json({
    total: allProducts.length,
    meals_tag_products: mealsTagged.map(p => ({ title: p.title, tags: p.tags, status: p.status })),
    byo_meals_tag_products_count: byoMealsTagged.length,
    byo_meals_sample: byoMealsTagged.slice(0, 5).map(p => ({ title: p.title, tags: p.tags })),
    non_byo_products: nonByo.map(p => ({
      title: p.title,
      tags: p.tags,
      status: p.status,
      variants: (p.variants || []).map(v => ({ title: v.title, sku: v.sku })),
    })),
  });
});