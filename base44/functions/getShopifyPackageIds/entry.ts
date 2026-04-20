import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me();
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const storeDomain = Deno.env.get('SHOPIFY_STORE_DOMAIN');
  const accessToken = Deno.env.get('SHOPIFY_ACCESS_TOKEN');

  // Get Women's packages for SKU lookup
  const [wwlRes, wlmRes] = await Promise.all([
    fetch(`https://${storeDomain}/admin/api/2024-01/products/8544785694999.json`, {
      headers: { 'X-Shopify-Access-Token': accessToken, 'Content-Type': 'application/json' },
    }),
    fetch(`https://${storeDomain}/admin/api/2024-01/products/8544861487383.json`, {
      headers: { 'X-Shopify-Access-Token': accessToken, 'Content-Type': 'application/json' },
    }),
  ]);
  const wwlData = await wwlRes.json();
  const wlmData = await wlmRes.json();

  return Response.json({
    wwl: (wwlData.product?.variants || []).map(v => ({ vid: String(v.id), sku: v.sku, t: v.title })),
    wlm: (wlmData.product?.variants || []).map(v => ({ vid: String(v.id), sku: v.sku, t: v.title })),
  });
});