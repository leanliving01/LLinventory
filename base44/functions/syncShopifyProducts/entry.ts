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

// ─── Manual mapping: Base44 meal_name → Shopify product title ───
// This ensures 100% accurate matching despite naming differences.
// When a new meal is added to Shopify, add an entry here.
// Map covers BOTH old Base44 names AND already-renamed Shopify names (idempotent)
const MEAL_NAME_MAP = {
  // Old Base44 names → Shopify titles
  'beef and beans + green beans + brown rice': 'Beef & Beans',
  'beef trinchado + white basmati rice + stirfry': 'Beef Trinchado + (white basmati rice + stir-fry)',
  'chicken breast, potato wedges, creamy spinach': 'Chicken breast, Potato Wedges, Creamy spinach (Swt Chilli Sauce)',
  'cottage pie + sweet potato mash + creamy spinach': 'Cottage Pie + (Sweet potato Mash + Creamy spinach)',
  'keto butter chicken + cauliflower + spinach': 'Keto Butter Chicken + (cauliflower + spinach)',
  'lean mince, pasta shells, corn': 'Lean Mince \u2013 Pasta Shells and Corn',
  'steak, brown rice, carrots': 'Steak \u2013 Brown Rice and Carrots',
  'steak, sweet potato, broccoli': 'Steak \u2013 Sweet Potato and Broccoli',
  'sweet chilli chicken + (brown rice + stirfry)': 'Sweet Chilli Chicken + (brown rice + stir-fry)',

  // Already-renamed names (so re-running the sync still matches)
  'beef & beans': 'Beef & Beans',
  'beef trinchado + (white basmati rice + stir-fry)': 'Beef Trinchado + (white basmati rice + stir-fry)',
  'chicken breast, potato wedges, creamy spinach (swt chilli sauce)': 'Chicken breast, Potato Wedges, Creamy spinach (Swt Chilli Sauce)',
  'cottage pie + (sweet potato mash + creamy spinach)': 'Cottage Pie + (Sweet potato Mash + Creamy spinach)',
  'keto butter chicken + (cauliflower + spinach)': 'Keto Butter Chicken + (cauliflower + spinach)',
  'lean mince \u2013 pasta shells and corn': 'Lean Mince \u2013 Pasta Shells and Corn',
  'steak \u2013 brown rice and carrots': 'Steak \u2013 Brown Rice and Carrots',
  'steak \u2013 sweet potato and broccoli': 'Steak \u2013 Sweet Potato and Broccoli',
  'sweet chilli chicken + (brown rice + stir-fry)': 'Sweet Chilli Chicken + (brown rice + stir-fry)',

  // Names that already match Shopify exactly
  'chicken breast, butternut, stir-fry': 'Chicken breast, Butternut, Stir-fry',
  'chicken breast, sweet potato, mixed veg': 'Chicken breast, Sweet potato, Mixed veg',
  'chicken curry + (white rice + butternut)': 'Chicken Curry + (white rice + butternut)',
  'lean mince, white basmati rice, broccoli': 'Lean mince, White basmati rice, Broccoli',
  'lean mince, white basmati rice, green beans': 'Lean mince, White basmati rice, Green beans',
};

// Build reverse map: Shopify title (lowercase) → target Shopify title
const SHOPIFY_TITLE_LOOKUP = {};
Object.values(MEAL_NAME_MAP).forEach(shopifyTitle => {
  SHOPIFY_TITLE_LOOKUP[shopifyTitle.toLowerCase().trim()] = shopifyTitle;
});

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me();
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const storeDomain = Deno.env.get('SHOPIFY_STORE_DOMAIN');
  const accessToken = Deno.env.get('SHOPIFY_ACCESS_TOKEN');
  if (!storeDomain || !accessToken) {
    return Response.json({ error: 'Shopify credentials not configured' }, { status: 400 });
  }

  // ─── 1. Fetch active Shopify products (paginated) ───
  let allProducts = [];
  let pageUrl = `https://${storeDomain}/admin/api/2024-01/products.json?limit=250&status=active`;

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

  // ─── 2. Filter to BYO meal products (tagged "BYO Meals" AND "Meals") ───
  const byoMealProducts = allProducts.filter(p => {
    const tags = (p.tags || '').split(',').map(t => t.trim().toLowerCase());
    return tags.includes('byo meals') && tags.includes('meals');
  });

  console.log(`Found ${byoMealProducts.length} BYO meal products`);

  // Build lookup: Shopify title (lowercase) → Shopify product
  const shopifyByTitle = {};
  byoMealProducts.forEach(p => {
    shopifyByTitle[p.title.toLowerCase().trim()] = p;
  });

  // ─── 3. Load existing Meals and SKUs from Base44 ───
  const [existingMeals, existingSkus] = await Promise.all([
    base44.asServiceRole.entities.Meal.filter({}),
    base44.asServiceRole.entities.SKU.filter({}),
  ]);

  // Map existing SKUs by meal_id + package_type for dedup
  const skuByMealAndType = {};
  existingSkus.forEach(s => {
    if (s.meal_id && s.package_type) {
      skuByMealAndType[`${s.meal_id}_${s.package_type}`] = s;
    }
  });

  // ─── 4. Process each Base44 meal: rename if needed, then sync SKU ───
  let mealsRenamed = 0, skusCreated = 0, skusUpdated = 0, skipped = 0;
  const results = [];
  const unmatchedMeals = [];
  const unmatchedShopify = [];

  for (const meal of existingMeals) {
    const mealKey = meal.meal_name.toLowerCase().trim();
    const mappedShopifyTitle = MEAL_NAME_MAP[mealKey];

    if (!mappedShopifyTitle) {
      // No mapping exists for this meal (e.g. low carb meals without Shopify counterparts)
      unmatchedMeals.push({ meal_name: meal.meal_name, reason: 'No mapping in MEAL_NAME_MAP' });
      skipped++;
      continue;
    }

    // Find the Shopify product by the mapped title
    const shopifyProduct = shopifyByTitle[mappedShopifyTitle.toLowerCase().trim()];
    if (!shopifyProduct) {
      unmatchedMeals.push({ meal_name: meal.meal_name, mapped_to: mappedShopifyTitle, reason: 'Shopify product not found (maybe inactive or deleted)' });
      skipped++;
      continue;
    }

    // ─── 4a. Rename Base44 meal to match Shopify title ───
    const shopifyTitle = shopifyProduct.title.trim();
    if (meal.meal_name !== shopifyTitle) {
      console.log(`Renaming meal: "${meal.meal_name}" → "${shopifyTitle}"`);
      await withRetry(() => base44.asServiceRole.entities.Meal.update(meal.id, { meal_name: shopifyTitle }));
      mealsRenamed++;
      await delay(300);

      // Also update meal_name and display_name on ALL existing SKUs for this meal
      const relatedSkus = existingSkus.filter(s => s.meal_id === meal.id);
      for (const sku of relatedSkus) {
        const updatedDisplayName = `${shopifyTitle} (${sku.package_type === 'LOW_CARB' ? 'LC' : sku.package_type} ${sku.portion_size_grams}g)`;
        console.log(`  Updating SKU ${sku.sku_code}: meal_name → "${shopifyTitle}"`);
        await withRetry(() => base44.asServiceRole.entities.SKU.update(sku.id, {
          meal_name: shopifyTitle,
          display_name: updatedDisplayName,
        }));
        await delay(200);
      }
    }

    // ─── 4b. Create/update SKU for this meal ───
    const packageType = meal.family_type === 'low_carb' ? 'LOW_CARB' : 'MWL';
    const portionGrams = packageType === 'LOW_CARB' ? 330 : 350;
    const skuPrefix = packageType === 'LOW_CARB' ? 'LC-BYO' : 'MWL-BYO';
    const skuCodeSuffix = meal.id.slice(-4).toUpperCase();
    const skuCode = `${skuPrefix}-${skuCodeSuffix}`;
    const displayName = `${shopifyTitle} (${packageType === 'LOW_CARB' ? 'LC' : 'MWL'} ${portionGrams}g)`;

    const lookupKey = `${meal.id}_${packageType}`;
    const existingSku = skuByMealAndType[lookupKey];

    if (existingSku) {
      await withRetry(() => base44.asServiceRole.entities.SKU.update(existingSku.id, {
        meal_name: shopifyTitle,
        display_name: displayName,
        is_active: true,
      }));
      skusUpdated++;
      results.push({ shopify_title: shopifyTitle, sku_code: existingSku.sku_code, action: 'updated', package_type: packageType });
    } else {
      await withRetry(() => base44.asServiceRole.entities.SKU.create({
        sku_code: skuCode,
        meal_id: meal.id,
        meal_name: shopifyTitle,
        package_type: packageType,
        portion_size_grams: portionGrams,
        display_name: displayName,
        is_active: true,
      }));
      skusCreated++;
      results.push({ shopify_title: shopifyTitle, sku_code: skuCode, action: 'created', package_type: packageType });
    }

    await delay(300);
  }

  // Check for Shopify BYO meal products that weren't matched to any Base44 meal
  const matchedShopifyTitles = new Set(Object.values(MEAL_NAME_MAP).map(t => t.toLowerCase().trim()));
  byoMealProducts.forEach(p => {
    if (!matchedShopifyTitles.has(p.title.toLowerCase().trim())) {
      unmatchedShopify.push({ shopify_title: p.title, reason: 'No Base44 meal mapped to this product' });
    }
  });

  // ─── 5. Audit log ───
  await base44.asServiceRole.entities.AuditLog.create({
    action: 'sync',
    entity_type: 'Meal',
    description: `Shopify meal sync: ${mealsRenamed} meals renamed, ${skusCreated} SKUs created, ${skusUpdated} SKUs updated, ${skipped} skipped`,
  });

  return Response.json({
    success: true,
    total_shopify_products: allProducts.length,
    byo_meal_products: byoMealProducts.length,
    meals_renamed: mealsRenamed,
    skus_created: skusCreated,
    skus_updated: skusUpdated,
    skipped,
    results,
    unmatched_base44_meals: unmatchedMeals,
    unmatched_shopify_products: unmatchedShopify,
  });
});