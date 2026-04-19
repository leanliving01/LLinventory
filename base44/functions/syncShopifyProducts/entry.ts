import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

async function withRetry(fn, retries = 4) {
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (err) {
      if (err.status === 429 && i < retries - 1) {
        const waitTime = (i + 1) * 3000;
        console.log(`Rate limited, waiting ${waitTime / 1000}s...`);
        await delay(waitTime);
      } else {
        throw err;
      }
    }
  }
}

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me();
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const storeDomain = Deno.env.get('SHOPIFY_STORE_DOMAIN');
  const accessToken = Deno.env.get('SHOPIFY_ACCESS_TOKEN');
  if (!storeDomain || !accessToken) {
    return Response.json({ error: 'Shopify credentials not configured' }, { status: 400 });
  }

  // ─── 1. Fetch all Shopify products (paginated) ───
  let allProducts = [];
  let pageUrl = `https://${storeDomain}/admin/api/2024-01/products.json?limit=250&status=any`;

  while (pageUrl) {
    const res = await fetch(pageUrl, {
      headers: { 'X-Shopify-Access-Token': accessToken, 'Content-Type': 'application/json' },
    });
    if (!res.ok) {
      const errorText = await res.text();
      console.error('Shopify API error:', res.status, errorText);
      return Response.json({ error: `Shopify API error: ${res.status}` }, { status: 502 });
    }
    const data = await res.json();
    allProducts = allProducts.concat(data.products || []);
    const linkHeader = res.headers.get('Link') || '';
    const nextMatch = linkHeader.match(/<([^>]+)>;\s*rel="next"/);
    pageUrl = nextMatch ? nextMatch[1] : null;
  }

  console.log(`Fetched ${allProducts.length} total products from Shopify`);

  // ─── 2. Filter to BYO meal products (tagged with both "BYO" and "Meals") ───
  const byoProducts = allProducts.filter(p => {
    const tags = (p.tags || '').toLowerCase().split(',').map(t => t.trim());
    return tags.includes('byo') && tags.includes('meals');
  });

  console.log(`Found ${byoProducts.length} BYO meal products`);

  // ─── 3. Load existing Meals and SKUs from Base44 ───
  const [existingMeals, existingSkus] = await Promise.all([
    base44.asServiceRole.entities.Meal.filter({}),
    base44.asServiceRole.entities.SKU.filter({}),
  ]);

  // Map meals by name (lowercase trimmed) for lookup
  const mealsByName = {};
  existingMeals.forEach(m => {
    mealsByName[m.meal_name.toLowerCase().trim()] = m;
  });

  // Map existing SKUs by meal_id + package_type for dedup
  const skuByMealAndType = {};
  existingSkus.forEach(s => {
    if (s.meal_id && s.package_type) {
      skuByMealAndType[`${s.meal_id}_${s.package_type}`] = s;
    }
  });

  // ─── 4. Process each BYO product ───
  let created = 0, updated = 0, skipped = 0;
  const matched = [];
  const unmatched = [];

  for (const product of byoProducts) {
    const productTitle = (product.title || '').trim();
    const mealKey = productTitle.toLowerCase().trim();

    // Look up the Meal entity by exact name match
    const meal = mealsByName[mealKey];
    if (!meal) {
      unmatched.push({ shopify_title: productTitle, reason: 'No matching Meal entity found' });
      skipped++;
      continue;
    }

    // Determine package_type from family_type
    const packageType = meal.family_type === 'low_carb' ? 'LOW_CARB' : 'MWL';

    // Determine portion size based on package type
    const portionGrams = packageType === 'LOW_CARB' ? 330 : 350;

    // Generate a consistent SKU code
    const skuPrefix = packageType === 'LOW_CARB' ? 'LC-BYO' : 'MWL-BYO';
    // Use meal ID suffix for uniqueness
    const skuCodeSuffix = meal.id.slice(-4).toUpperCase();
    const skuCode = `${skuPrefix}-${skuCodeSuffix}`;

    const displayName = `${productTitle} (${packageType === 'LOW_CARB' ? 'LC' : 'MWL'} ${portionGrams}g)`;

    const lookupKey = `${meal.id}_${packageType}`;
    const existingSku = skuByMealAndType[lookupKey];

    const skuData = {
      sku_code: existingSku ? existingSku.sku_code : skuCode,
      meal_id: meal.id,
      meal_name: meal.meal_name,
      package_type: packageType,
      portion_size_grams: portionGrams,
      display_name: displayName,
      is_active: product.status === 'active',
    };

    if (existingSku) {
      // Update existing SKU — preserve the existing sku_code
      await withRetry(() => base44.asServiceRole.entities.SKU.update(existingSku.id, {
        meal_name: skuData.meal_name,
        display_name: skuData.display_name,
        is_active: skuData.is_active,
      }));
      updated++;
      matched.push({ shopify_title: productTitle, sku_code: existingSku.sku_code, action: 'updated', package_type: packageType });
    } else {
      // Create new SKU
      await withRetry(() => base44.asServiceRole.entities.SKU.create(skuData));
      created++;
      matched.push({ shopify_title: productTitle, sku_code: skuCode, action: 'created', package_type: packageType });
    }

    // Small delay to avoid rate limits
    await delay(300);
  }

  // ─── 5. Audit log ───
  await base44.asServiceRole.entities.AuditLog.create({
    action: 'sync',
    entity_type: 'SKU',
    description: `BYO SKU sync from Shopify: ${created} created, ${updated} updated, ${skipped} unmatched out of ${byoProducts.length} BYO products`,
  });

  return Response.json({
    success: true,
    total_shopify_products: allProducts.length,
    byo_products_found: byoProducts.length,
    created,
    updated,
    skipped,
    matched,
    unmatched,
  });
});