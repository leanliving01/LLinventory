import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * Fetches ALL Shopify products tagged "BYO Meals" and compares SKUs
 * against our Product entity. Returns ONLY items where SKU differs.
 */
Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me();
  if (!user || user.role !== 'admin') {
    return Response.json({ error: 'Forbidden' }, { status: 403 });
  }

  const storeDomain = Deno.env.get('SHOPIFY_STORE_DOMAIN');
  const accessToken = Deno.env.get('SHOPIFY_ACCESS_TOKEN');

  let allProducts = [];
  let pageUrl = `https://${storeDomain}/admin/api/2024-01/products.json?limit=250&status=active`;
  while (pageUrl) {
    const res = await fetch(pageUrl, {
      headers: { 'X-Shopify-Access-Token': accessToken },
    });
    if (!res.ok) return Response.json({ error: `Shopify ${res.status}` }, { status: 502 });
    const data = await res.json();
    allProducts.push(...(data.products || []));
    const link = res.headers.get('Link') || '';
    const next = link.match(/<([^>]+)>;\s*rel="next"/);
    pageUrl = next ? next[1] : null;
  }

  const byoMeals = allProducts.filter(p => {
    const tags = (p.tags || '').split(',').map(t => t.trim().toLowerCase());
    return tags.includes('byo meals');
  });

  const ourProducts = [];
  let skip = 0;
  while (true) {
    const batch = await base44.asServiceRole.entities.Product.filter(
      { type: 'finished_meal', status: 'active' }, 'sku', 500, skip
    );
    if (!batch || batch.length === 0) break;
    ourProducts.push(...batch);
    if (batch.length < 500) break;
    skip += 500;
  }

  const ourByName = {};
  ourProducts.forEach(p => { ourByName[p.name.toLowerCase().trim()] = p; });

  // Only return items where SKU actually differs
  const changes = [];
  for (const sp of byoMeals) {
    const variants = sp.variants || [];
    const nameKey = sp.title.toLowerCase().trim();
    const ourMatch = ourByName[nameKey];
    if (!ourMatch) continue;

    for (const v of variants) {
      const shopifySku = (v.sku || '').trim();
      if (shopifySku && shopifySku !== ourMatch.sku) {
        changes.push({
          meal_name: sp.title,
          shopify_sku_new: shopifySku,
          our_sku_current: ourMatch.sku,
          our_product_id: ourMatch.id,
          shopify_variant_id: String(v.id),
        });
      }
    }
  }

  // Also check PackBom impact for each change
  const packBoms = await base44.asServiceRole.entities.PackBom.filter({ active: true });

  const enriched = changes.map(c => {
    const bomImpact = [];
    for (const bom of packBoms) {
      const inComp = (bom.component_skus || []).includes(c.our_sku_current);
      let inOv = false;
      try { inOv = c.our_sku_current in JSON.parse(bom.sku_overrides || '{}'); } catch {}
      const inDis = (bom.disabled_skus || []).includes(c.our_sku_current);
      if (inComp || inOv || inDis) {
        bomImpact.push(bom.package_sku);
      }
    }
    return { ...c, affected_pack_boms: bomImpact };
  });

  return Response.json({
    total_byo_meals_in_shopify: byoMeals.length,
    sku_changes_found: enriched.length,
    changes: enriched,
  });
});