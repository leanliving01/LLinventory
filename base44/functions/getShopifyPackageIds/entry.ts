import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me();
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const storeDomain = Deno.env.get('SHOPIFY_STORE_DOMAIN');
  const accessToken = Deno.env.get('SHOPIFY_ACCESS_TOKEN');

  // Get Women's Weight Loss specifically
  const res = await fetch(`https://${storeDomain}/admin/api/2024-01/products/8544785694999.json`, {
    headers: { 'X-Shopify-Access-Token': accessToken, 'Content-Type': 'application/json' },
  });
  const data = await res.json();
  const variants = (data.product?.variants || []).map(v => ({ vid: String(v.id), t: v.title }));
  return Response.json({ title: data.product?.title, variants });
});