import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * previewSkuChanges — DRY RUN only
 *
 * Pulls active products from Shopify, compares SKUs against our Product entity,
 * and returns a list of SKU changes that WOULD happen on next sync.
 * Does NOT modify any data.
 */

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function fetchShopifyPage(url, accessToken) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    const res = await fetch(url, {
      headers: { 'X-Shopify-Access-Token': accessToken, 'Content-Type': 'application/json' },
    });
    if (res.status === 429) {
      const retryAfter = parseFloat(res.headers.get('retry-after') || '2');
      await sleep(retryAfter * 1000);
      continue;
    }
    if (!res.ok) throw new Error(`Shopify ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const data = await res.json();
    const linkHeader = res.headers.get('link') || '';
    const nextMatch = linkHeader.match(/<([^>]+)>;\s*rel="next"/);
    return { items: data.products || [], nextUrl: nextMatch ? nextMatch[1] : '' };
  }
  throw new Error('Shopify rate limit exceeded');
}

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me();
  if (!user || user.role !== 'admin') {
    return Response.json({ error: 'Forbidden' }, { status: 403 });
  }

  const storeDomain = Deno.env.get('SHOPIFY_STORE_DOMAIN');
  const accessToken = Deno.env.get('SHOPIFY_ACCESS_TOKEN');

  // Step 1: Build lookup of ALL our current products by shopify_variant_id and by external_id
  const allProducts = [];
  let skip = 0;
  while (true) {
    const batch = await base44.asServiceRole.entities.Product.filter({ status: 'active' }, 'sku', 500, skip);
    if (!batch || batch.length === 0) break;
    allProducts.push(...batch);
    if (batch.length < 500) break;
    skip += 500;
    await sleep(300);
  }

  // Index by variant ID and by SKU for matching
  const byVariantId = {};
  const byExternalId = {};
  const bySku = {};
  for (const p of allProducts) {
    if (p.shopify_variant_id) byVariantId[p.shopify_variant_id] = p;
    if (p.external_id) byExternalId[p.external_id] = p;
    if (p.sku) bySku[p.sku.toLowerCase()] = p;
  }

  // Step 2: Pull products from Shopify
  const skuChanges = [];
  let url = `https://${storeDomain}/admin/api/2024-01/products.json?limit=50&status=active`;

  while (url) {
    const { items: products, nextUrl } = await fetchShopifyPage(url, accessToken);

    for (const product of products) {
      for (const variant of (product.variants || [])) {
        const shopifySku = (variant.sku || '').trim();
        if (!shopifySku) continue;

        const variantId = String(variant.id);

        // Find existing product in our DB (same matching logic as bulkSyncProducts)
        const existing = byVariantId[variantId] || byExternalId[variantId] || bySku[shopifySku.toLowerCase()];

        if (existing && existing.sku && existing.sku !== shopifySku) {
          skuChanges.push({
            product_name: product.title + (product.variants.length > 1 ? ` - ${variant.title}` : ''),
            our_product_id: existing.id,
            old_sku: existing.sku,
            new_sku: shopifySku,
            shopify_variant_id: variantId,
          });
        }
      }
    }

    url = nextUrl || '';
    if (url) await sleep(500);
  }

  // Step 3: For each changed SKU, check impact on PackBoms and active SalesOrderLines
  const allPackBoms = await base44.asServiceRole.entities.PackBom.filter({ active: true });

  // Bulk-fetch all SalesOrderLines for paid_unfulfilled orders
  const paidOrders = [];
  skip = 0;
  while (true) {
    const batch = await base44.asServiceRole.entities.SalesOrder.filter(
      { lifecycle_state: 'paid_unfulfilled' }, 'id', 500, skip
    );
    if (!batch || batch.length === 0) break;
    paidOrders.push(...batch);
    if (batch.length < 500) break;
    skip += 500;
    await sleep(300);
  }
  const paidOrderIds = new Set(paidOrders.map(o => o.id));

  const allLines = [];
  skip = 0;
  while (true) {
    const batch = await base44.asServiceRole.entities.SalesOrderLine.list('id', 500, skip);
    if (!batch || batch.length === 0) break;
    allLines.push(...batch);
    if (batch.length < 500) break;
    skip += 500;
    await sleep(300);
  }

  // Enrich each SKU change with impact details
  const results = skuChanges.map(change => {
    // PackBom impact
    const affectedPackBoms = [];
    for (const bom of allPackBoms) {
      const inComponents = (bom.component_skus || []).includes(change.old_sku);
      let inOverrides = false;
      try {
        const ov = JSON.parse(bom.sku_overrides || '{}');
        inOverrides = change.old_sku in ov;
      } catch { /* */ }
      const inDisabled = (bom.disabled_skus || []).includes(change.old_sku);
      if (inComponents || inOverrides || inDisabled) {
        affectedPackBoms.push({
          package_sku: bom.package_sku,
          in_components: inComponents,
          in_overrides: inOverrides,
          in_disabled: inDisabled,
        });
      }
    }

    // SalesOrderLine impact
    const affectedLines = allLines.filter(l =>
      l.sku === change.old_sku && paidOrderIds.has(l.sales_order_id)
    );

    return {
      ...change,
      affected_pack_boms: affectedPackBoms,
      affected_order_lines: affectedLines.length,
    };
  });

  return Response.json({
    status: 'preview',
    total_products_scanned: allProducts.length,
    sku_changes_detected: results.length,
    changes: results,
  });
});