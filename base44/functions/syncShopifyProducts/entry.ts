import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me();
  if (!user) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const storeDomain = Deno.env.get('SHOPIFY_STORE_DOMAIN');
  const accessToken = Deno.env.get('SHOPIFY_ACCESS_TOKEN');

  if (!storeDomain || !accessToken) {
    return Response.json({ error: 'Shopify credentials not configured' }, { status: 400 });
  }

  // Fetch all products from Shopify (including drafts)
  let allProducts = [];
  let pageUrl = `https://${storeDomain}/admin/api/2024-01/products.json?limit=250&status=any`;

  while (pageUrl) {
    const res = await fetch(pageUrl, {
      headers: {
        'X-Shopify-Access-Token': accessToken,
        'Content-Type': 'application/json',
      },
    });

    if (!res.ok) {
      const errorText = await res.text();
      console.error('Shopify API error:', res.status, errorText);
      return Response.json({ error: `Shopify API error: ${res.status}` }, { status: 502 });
    }

    const data = await res.json();
    allProducts = allProducts.concat(data.products || []);

    // Check for pagination
    const linkHeader = res.headers.get('Link');
    pageUrl = null;
    if (linkHeader) {
      const nextMatch = linkHeader.match(/<([^>]+)>;\s*rel="next"/);
      if (nextMatch) {
        pageUrl = nextMatch[1];
      }
    }
  }

  console.log(`Fetched ${allProducts.length} products from Shopify`);

  // Get existing SKUs to avoid duplicates
  const existingSkus = await base44.asServiceRole.entities.SKU.filter({});
  const existingByCode = {};
  existingSkus.forEach(s => { existingByCode[s.sku_code] = s; });

  // Get existing meals for matching
  const existingMeals = await base44.asServiceRole.entities.Meal.filter({});
  const mealsByName = {};
  existingMeals.forEach(m => { mealsByName[m.meal_name.toLowerCase().trim()] = m; });

  let created = 0;
  let updated = 0;
  let skipped = 0;
  const syncedSkus = [];

  for (const product of allProducts) {
    const productTags = (product.tags || '').toLowerCase();
    const productTitle = product.title || '';

    for (const variant of (product.variants || [])) {
      const sku = variant.sku;
      if (!sku || sku.trim() === '') {
        skipped++;
        continue;
      }

      // Try to determine package type from tags/title
      let packageType = null;
      const titleLower = productTitle.toLowerCase();
      const variantTitle = (variant.title || '').toLowerCase();
      const combined = `${titleLower} ${variantTitle} ${productTags}`;

      if (combined.includes('low carb') || combined.includes('low-carb') || combined.includes('lowcarb')) {
        packageType = 'LOW_CARB';
      } else if (combined.includes('men') && combined.includes('lean')) {
        packageType = 'MLM';
      } else if (combined.includes('women') && combined.includes('lean')) {
        packageType = 'WLM';
      } else if (combined.includes('women') && combined.includes('weight')) {
        packageType = 'WWL';
      } else if (combined.includes('men') && combined.includes('weight')) {
        packageType = 'MWL';
      } else if (productTags.includes('byo') || titleLower.includes('build your own')) {
        packageType = 'MWL';
      }

      // Try to extract meal name from product title
      // Clean up common prefixes/suffixes
      let mealName = productTitle
        .replace(/\s*-\s*(MWL|MLM|WLM|WWL|LOW.?CARB|BYO).*/i, '')
        .replace(/\s*\(.*\)/, '')
        .trim();

      // Match to existing meal
      let mealId = null;
      const matchedMeal = mealsByName[mealName.toLowerCase().trim()];
      if (matchedMeal) {
        mealId = matchedMeal.id;
      }

      const skuData = {
        sku_code: sku.trim(),
        meal_name: mealName || productTitle,
        meal_id: mealId || '',
        package_type: packageType || '',
        display_name: `${productTitle}${variant.title && variant.title !== 'Default Title' ? ' - ' + variant.title : ''}`,
        is_active: product.status === 'active',
        portion_size_grams: variant.grams || 0,
      };

      if (existingByCode[sku.trim()]) {
        // Update existing
        await base44.asServiceRole.entities.SKU.update(existingByCode[sku.trim()].id, skuData);
        updated++;
      } else {
        // Create new
        await base44.asServiceRole.entities.SKU.create(skuData);
        created++;
      }

      syncedSkus.push({
        sku: sku.trim(),
        product: productTitle,
        variant: variant.title,
        package_type: packageType,
        status: product.status,
      });
    }
  }

  // Audit log
  await base44.asServiceRole.entities.AuditLog.create({
    action: 'sync',
    entity_type: 'SKU',
    description: `Synced SKUs from Shopify: ${created} created, ${updated} updated, ${skipped} skipped (no SKU code)`,
  });

  return Response.json({
    success: true,
    total_products: allProducts.length,
    created,
    updated,
    skipped,
    synced_skus: syncedSkus,
  });
});