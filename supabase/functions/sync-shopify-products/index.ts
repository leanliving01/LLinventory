import { shopifyFetch, getSupabase, corsHeaders, json } from '../_shared/shopify.ts';
import {
  getSyncState, markRunning, markComplete, markError, markCancelled, shouldCancel,
} from '../_shared/sync-state.ts';
import { chainNext } from '../_shared/chain.ts';
import { startSyncLog, finishSyncLog } from '../_shared/sync-log.ts';

const SOURCE_KEY = 'shopify_products';
const FN_NAME = 'sync-shopify-products';
const PAGE_SIZE = 250;

interface ShopifyProductsResponse {
  products: ShopifyProduct[];
}

interface ShopifyProduct {
  id: number;
  title: string;
  handle: string;
  product_type?: string;
  vendor?: string;
  status: string;
  variants: ShopifyVariant[];
  updated_at: string;
}

interface ShopifyVariant {
  id: number;
  product_id: number;
  title: string;
  sku: string;
  price: string;
  barcode?: string;
}

interface MealInfo {
  packageType: string;
  mealName: string;
  familyType: string;
}

// Derive meal metadata from a product SKU and Shopify title.
// Returns null for non-meal products (e.g. packing materials).
function deriveMealInfo(sku: string, title: string, productType?: string): MealInfo | null {
  // Goal-based meals: MWL1-15, MLM1-15, WLM1-15, WWL1-15
  for (const code of ['MWL', 'MLM', 'WLM', 'WWL']) {
    if (sku.startsWith(code) && /^\d+$/.test(sku.slice(code.length))) {
      // Strip variant suffix (e.g. " WLM" or " WLM12") from product name to get base meal name
      const mealName = title.replace(new RegExp(`\\s+${code}\\d*\\s*$`), '').trim();
      return { packageType: code, mealName, familyType: 'goal_related' };
    }
  }
  // Low Carb / Smart Carb: alpha-only SKU codes (PBBS, CZA, ZUB, CAEPL, LHCCG, etc.)
  if (productType === 'Smart Carb' || /^[A-Z]+$/.test(sku)) {
    return { packageType: 'LOW_CARB', mealName: title, familyType: 'low_carb' };
  }
  return null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders() });

  let body: { mode?: 'start' | 'continue' | 'cancel'; fullResync?: boolean } = {};
  try { body = await req.json(); } catch { /* empty body ok */ }
  const mode = body.mode || 'start';
  const supabase = getSupabase();

  if (mode === 'cancel') {
    await markCancelled(supabase, SOURCE_KEY);
    return json({ status: 'cancelled', processedThisPage: 0, totalProcessed: 0, hasMore: false });
  }

  let pageInfo: string | null = null;
  let totalProcessed = 0;
  let updatedAtMin: string | undefined;

  const priorState = await getSyncState(supabase, SOURCE_KEY);

  let syncLogId: string | null = null;

  if (mode === 'start') {
    if (!body.fullResync && priorState?.last_sync_at) {
      updatedAtMin = priorState.last_sync_at;
    }
    syncLogId = await startSyncLog(supabase, SOURCE_KEY, body.fullResync ? 'manual' : 'scheduled');
    await markRunning(supabase, SOURCE_KEY, JSON.stringify({ pageInfo: null, since: updatedAtMin || null, logId: syncLogId }), 0);
  } else {
    try {
      const parsed = JSON.parse(priorState?.last_cursor || '{}');
      pageInfo = parsed.pageInfo || null;
      updatedAtMin = parsed.since || undefined;
      syncLogId = parsed.logId || null;
    } catch {
      pageInfo = priorState?.last_cursor && priorState.last_cursor !== 'first' ? priorState.last_cursor : null;
    }
    totalProcessed = priorState?.records_synced || 0;
  }

  if (await shouldCancel(supabase, SOURCE_KEY)) {
    await markCancelled(supabase, SOURCE_KEY);
    return json({ status: 'cancelled', processedThisPage: 0, totalProcessed, hasMore: false });
  }

  // Build params — page_info is exclusive with updated_at_min (Shopify requirement)
  const params: Record<string, string> = { limit: String(PAGE_SIZE) };
  if (pageInfo) {
    params.page_info = pageInfo;
  } else if (updatedAtMin) {
    params.updated_at_min = updatedAtMin;
  }

  const res = await shopifyFetch<ShopifyProductsResponse>('/products.json', params);

  if (res.status === 429) {
    const retryAfter = res.retryAfter || 4;
    await markError(supabase, SOURCE_KEY, `rate_limited: retry in ${retryAfter}s`);
    await markRunning(supabase, SOURCE_KEY, pageInfo || 'first', 0);
    EdgeRuntime.waitUntil(chainNext(FN_NAME, { mode: 'continue' }, retryAfter));
    return json({ status: 'rate_limited', processedThisPage: 0, totalProcessed, hasMore: true, rateLimit: { retryAfterSeconds: retryAfter } });
  }

  if (!res.ok) {
    await markError(supabase, SOURCE_KEY, `Shopify ${res.status}: ${(res.errorText || '').slice(0, 200)}`);
    return json({ status: 'error', error: `Shopify API ${res.status}`, processedThisPage: 0, totalProcessed, hasMore: false });
  }

  const products = res.data?.products || [];
  const nearLimit = res.apiCallLimit && (res.apiCallLimit.used / res.apiCallLimit.max) > 0.8;
  const nextDelay = nearLimit ? 10 : 1;

  if (products.length === 0) {
    await markComplete(supabase, SOURCE_KEY, 0);
    return json({ status: 'completed', processedThisPage: 0, totalProcessed, hasMore: false });
  }

  const now = new Date().toISOString();

  // Check source-of-truth setting: should we overwrite product names from Shopify?
  const { data: nameSetting } = await supabase
    .from('settings')
    .select('value')
    .eq('key', 'shopify_product_name_source')
    .maybeSingle();
  const updateNamesFromShopify = nameSetting ? nameSetting.value !== 'false' : true; // default on

  // Pre-fetch existing products by shopify_product_id OR SKU
  const shopifyIds = products.map(p => String(p.id));
  const skus = products.flatMap(p => (p.variants || []).map(v => v.sku).filter(Boolean));

  const [{ data: byShopifyId }, { data: bySku }] = await Promise.all([
    supabase.from('products').select('id, sku, shopify_product_id').in('shopify_product_id', shopifyIds),
    supabase.from('products').select('id, sku, shopify_product_id').in('sku', skus.length ? skus : ['__none__']),
  ]);

  const existingByShopifyId = new Map<string, { id: string; sku: string }>();
  const existingBySku = new Map<string, { id: string; sku: string; shopify_product_id: string | null }>();
  for (const p of byShopifyId || []) existingByShopifyId.set(p.shopify_product_id as string, { id: p.id as string, sku: p.sku as string });
  for (const p of bySku || []) existingBySku.set(p.sku as string, { id: p.id as string, sku: p.sku as string, shopify_product_id: p.shopify_product_id as string | null });

  // Process each product variant → upsert into products table
  let updated = 0;
  let created = 0;

  // Collect meal info for skus/meals sync (keyed by sku_code)
  const mealInfoBySku = new Map<string, MealInfo>();

  for (const p of products) {
    for (const v of (p.variants || [])) {
      if (!v.sku) continue;

      // Track meal info for this variant (used after products loop)
      const info = deriveMealInfo(v.sku, p.title, p.product_type);
      if (info) mealInfoBySku.set(v.sku, info);

      // Match priority: shopify_product_id → sku
      let match = existingByShopifyId.get(String(p.id));
      if (!match && existingBySku.has(v.sku)) {
        const bs = existingBySku.get(v.sku)!;
        match = { id: bs.id, sku: bs.sku };
        // Backfill shopify IDs on existing product
        await supabase.from('products').update({
          shopify_product_id: String(p.id),
          shopify_variant_id: String(v.id),
          updated_date: now,
        }).eq('id', bs.id);
        updated++;
      } else if (match) {
        await supabase.from('products').update({
          ...(updateNamesFromShopify ? { name: p.title } : {}),
          shopify_variant_id: String(v.id),
          barcode: v.barcode || null,
          updated_date: now,
        }).eq('id', match.id);
        updated++;
      } else {
        // No match — create as finished_meal default (user can re-categorize)
        const { error } = await supabase.from('products').insert({
          id: crypto.randomUUID(),
          sku: v.sku,
          name: p.title,
          type: 'finished_meal',
          stock_uom: 'pcs',
          shopify_product_id: String(p.id),
          shopify_variant_id: String(v.id),
          barcode: v.barcode || null,
          created_date: now,
          updated_date: now,
        });
        if (!error) created++;
      }
    }
  }

  // Sync meals and skus tables for recognised meal products
  if (mealInfoBySku.size > 0) {
    await syncMealsAndSkus(supabase, mealInfoBySku, now);
  }

  const processedThisPage = products.length;
  const newTotal = totalProcessed + processedThisPage;
  await markRunning(
    supabase, SOURCE_KEY,
    JSON.stringify({ pageInfo: res.nextPageInfo || null, since: updatedAtMin || null, logId: syncLogId }),
    processedThisPage,
  );

  const hasMore = !!res.nextPageInfo;

  if (!hasMore) {
    await markComplete(supabase, SOURCE_KEY, 0);
    if (syncLogId) await finishSyncLog(supabase, syncLogId, 'completed', { records_fetched: newTotal, records_created: created, records_updated: updated });
    return json({ status: 'completed', processedThisPage, totalProcessed: newTotal, hasMore: false, debug: { created, updated } });
  }

  EdgeRuntime.waitUntil(chainNext(FN_NAME, { mode: 'continue' }, nextDelay));
  return json({
    status: nearLimit ? 'rate_limited' : 'running',
    processedThisPage,
    totalProcessed: newTotal,
    hasMore: true,
    rateLimit: nearLimit ? { retryAfterSeconds: nextDelay } : undefined,
    debug: { created, updated, apiCallLimit: res.apiCallLimit },
  });
});

// Upsert meals and skus rows for all recognised meal products on this page.
async function syncMealsAndSkus(
  supabase: ReturnType<typeof getSupabase>,
  mealInfoBySku: Map<string, MealInfo>,
  now: string,
) {
  // 1. Gather unique meal names
  const uniqueMealNames = [...new Set([...mealInfoBySku.values()].map(i => i.mealName))];

  // 2. Fetch existing meals
  const { data: existingMeals } = await supabase
    .from('meals')
    .select('id, meal_name')
    .in('meal_name', uniqueMealNames);

  const mealIdByName = new Map<string, string>();
  for (const m of existingMeals || []) mealIdByName.set(m.meal_name as string, m.id as string);

  // 3. Insert missing meals
  const missingNames = uniqueMealNames.filter(n => !mealIdByName.has(n));
  if (missingNames.length > 0) {
    const newMealRows = missingNames.map(meal_name => {
      const info = [...mealInfoBySku.values()].find(i => i.mealName === meal_name)!;
      return {
        id: crypto.randomUUID(),
        meal_name,
        family_type: info.familyType,
        is_active: true,
        created_date: now,
        updated_date: now,
      };
    });
    const { data: inserted } = await supabase.from('meals').insert(newMealRows).select('id, meal_name');
    for (const m of inserted || []) mealIdByName.set(m.meal_name as string, m.id as string);
  }

  // 4. Fetch existing skus by sku_code to decide insert vs update
  const skuCodes = [...mealInfoBySku.keys()];
  const { data: existingSkus } = await supabase
    .from('skus')
    .select('id, sku_code')
    .in('sku_code', skuCodes);

  const existingSkuIds = new Map<string, string>(); // sku_code → id
  for (const s of existingSkus || []) existingSkuIds.set(s.sku_code as string, s.id as string);

  // 5. Insert new skus / update existing ones
  const toInsert = [];
  const toUpdate = [];

  for (const [sku_code, info] of mealInfoBySku) {
    const meal_id = mealIdByName.get(info.mealName) || null;
    const row = {
      sku_code,
      meal_id,
      meal_name: info.mealName,
      package_type: info.packageType,
      display_name: info.mealName,
      is_active: true,
      updated_date: now,
    };
    const existingId = existingSkuIds.get(sku_code);
    if (existingId) {
      toUpdate.push({ id: existingId, ...row });
    } else {
      toInsert.push({ id: crypto.randomUUID(), ...row, created_date: now });
    }
  }

  if (toInsert.length > 0) await supabase.from('skus').insert(toInsert);
  for (const row of toUpdate) {
    const { id, ...fields } = row;
    await supabase.from('skus').update(fields).eq('id', id);
  }
}
