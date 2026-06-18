import { shopifyFetch, getSupabase, corsHeaders, json } from '../_shared/shopify.ts';
import {
  getSyncState, markRunning, markComplete, markError, markCancelled, shouldCancel,
} from '../_shared/sync-state.ts';
import { chainNext } from '../_shared/chain.ts';
import { startSyncLog, finishSyncLog } from '../_shared/sync-log.ts';
import { loadClassificationRules, classifyLineItem } from '../_shared/order-classification.ts';

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

  // Build params — page_info is exclusive with updated_at_min (Shopify requirement).
  // Cursor pages don't allow extra filters; status is set only on the first page.
  // Include drafts so newly-added products appear before they're published
  // (Shopify REST default is status=active only).
  const params: Record<string, string> = { limit: String(PAGE_SIZE) };
  if (pageInfo) {
    params.page_info = pageInfo;
  } else {
    if (updatedAtMin) params.updated_at_min = updatedAtMin;
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

  // Resolve the default VAT rate (decimal, e.g. 0.15). Shopify variant.price is
  // VAT-INCLUSIVE for this store, but the catalog stores/displays excl-VAT prices.
  const { data: vatRow } = await supabase
    .from('tax_rates')
    .select('rate')
    .eq('is_default', true)
    .eq('active', true)
    .order('rate', { ascending: false })
    .limit(1)
    .maybeSingle();
  const vatRate = vatRow?.rate && vatRow.rate > 0 ? Number(vatRow.rate) : 0.15;
  const exclVatPrice = (raw: string | undefined): number | null => {
    const inc = parseFloat(raw || '');
    if (!Number.isFinite(inc) || inc <= 0) return null;
    return Math.round((inc / (1 + vatRate)) * 100) / 100;
  };

  // Pre-fetch existing products by shopify_variant_id (primary), sku, or shopify_product_id (legacy).
  // Variant ID is the most stable identifier — it stays the same even when a SKU is added or changed.
  const variantIds = products.flatMap(p => (p.variants || []).map(v => String(v.id)));
  const shopifyIds = products.map(p => String(p.id));
  const skus = products.flatMap(p => (p.variants || []).map(v => v.sku).filter(Boolean));

  const [{ data: byVariantId }, { data: byShopifyId }, { data: bySku }] = await Promise.all([
    supabase.from('products').select('id, sku, type, shopify_variant_id').in('shopify_variant_id', variantIds.length ? variantIds : ['__none__']),
    supabase.from('products').select('id, sku, type, shopify_product_id').in('shopify_product_id', shopifyIds),
    supabase.from('products').select('id, sku, type, shopify_product_id').in('sku', skus.length ? skus : ['__none__']),
  ]);

  const existingByVariantId = new Map<string, { id: string; sku: string; type: string | null }>();
  const existingByShopifyId = new Map<string, { id: string; sku: string; type: string | null }>();
  const existingBySku = new Map<string, { id: string; sku: string; type: string | null; shopify_product_id: string | null }>();
  for (const r of byVariantId || []) existingByVariantId.set(r.shopify_variant_id as string, { id: r.id as string, sku: r.sku as string, type: (r.type as string | null) ?? null });
  for (const r of byShopifyId || []) existingByShopifyId.set(r.shopify_product_id as string, { id: r.id as string, sku: r.sku as string, type: (r.type as string | null) ?? null });
  for (const r of bySku || []) existingBySku.set(r.sku as string, { id: r.id as string, sku: r.sku as string, type: (r.type as string | null) ?? null, shopify_product_id: r.shopify_product_id as string | null });

  // Classification rules — used to SKIP non-inventory catalog items (shipping,
  // pickup, vouchers, store credit, refund products) so they never become
  // inventory products.
  const rules = await loadClassificationRules(supabase);

  // Process each product variant → upsert into products table.
  // Every Shopify variant becomes its own inventory record so that multi-variant
  // packages (e.g. 15/30/60 meal packs) each have their own SKU, price, and BOM.
  let updated = 0;
  let created = 0;
  let skippedNonInventory = 0;
  const insertErrors: Array<{ name: string; shopify_id: string; error: string }> = [];

  // Collect meal info for skus/meals sync (keyed by sku_code)
  const mealInfoBySku = new Map<string, MealInfo>();

  for (const p of products) {
    const isMultiVariant = (p.variants || []).length > 1;

    for (const v of (p.variants || [])) {
      const hasSku = Boolean(v.sku);

      // Non-inventory classification — only run when SKU is available.
      // SKU-less variants default to inventory_product so they are always created.
      if (hasSku) {
        const cls = classifyLineItem(
          { title: p.title, sku: v.sku, product_type: p.product_type },
          rules,
        );
        const isNonInventory = cls.category !== 'inventory_product';
        const alreadyExists = existingByVariantId.has(String(v.id)) || existingByShopifyId.has(String(p.id)) || existingBySku.has(v.sku);
        if (isNonInventory && !alreadyExists) {
          skippedNonInventory++;
          continue;
        }
      }

      // Track meal info for SKU-bearing variants
      if (hasSku) {
        const info = deriveMealInfo(v.sku, p.title, p.product_type);
        if (info) mealInfoBySku.set(v.sku, info);
      }

      // VAT-exclusive selling price derived from Shopify's (VAT-inclusive) variant price.
      const exclPrice = exclVatPrice(v.price);

      // For multi-variant products, append the variant title to distinguish records
      // (e.g. "WINTER WARMER RANGE - 15 Meals"). Single-variant products use product title only.
      const variantSuffix = isMultiVariant && v.title && v.title !== 'Default Title' ? ` - ${v.title}` : '';
      const productName = `${p.title}${variantSuffix}`;

      // Match priority:
      // 1. shopify_variant_id — stays stable even when SKU is changed in either system
      // 2. sku — for products set up before variant IDs were tracked
      // 3. shopify_product_id — legacy fallback for single-variant products only
      let match: { id: string; sku: string; type: string | null } | undefined;
      let linkedOnly = false;

      match = existingByVariantId.get(String(v.id));

      if (!match && hasSku && existingBySku.has(v.sku)) {
        const bs = existingBySku.get(v.sku)!;
        match = { id: bs.id, sku: bs.sku, type: bs.type };
        // Backfill shopify IDs; minimal update so we don't overwrite user edits
        await supabase.from('products').update({
          shopify_product_id: String(p.id),
          shopify_variant_id: String(v.id),
          ...(exclPrice !== null ? { price: exclPrice } : {}),
          updated_date: now,
        }).eq('id', bs.id);
        updated++;
        linkedOnly = true;
      }

      if (!match && !isMultiVariant) {
        const legacy = existingByShopifyId.get(String(p.id));
        if (legacy) match = legacy;
      }

      if (match && !linkedOnly) {
        await supabase.from('products').update({
          ...(updateNamesFromShopify ? { name: productName } : {}),
          shopify_product_id: String(p.id),
          shopify_variant_id: String(v.id),
          barcode: v.barcode || null,
          ...(hasSku ? { sku: v.sku } : {}),
          ...(exclPrice !== null ? { price: exclPrice } : {}),
          updated_date: now,
        }).eq('id', match.id);
        updated++;
      } else if (!match) {
        // Create one record per variant.
        // Use placeholder SKU if Shopify has none — user can assign real SKU later from
        // inventory UI or Shopify; next sync will keep it via the variant_id match.
        const effectiveSku = v.sku || `SHOPIFY-${v.id}`;
        const { error } = await supabase.from('products').insert({
          id: crypto.randomUUID(),
          sku: effectiveSku,
          name: productName,
          type: 'finished_meal',
          stock_uom: 'pcs',
          shopify_product_id: String(p.id),
          shopify_variant_id: String(v.id),
          barcode: v.barcode || null,
          ...(exclPrice !== null ? { price: exclPrice } : {}),
          price_vat_corrected: true,
          created_date: now,
          updated_date: now,
        });
        if (!error) {
          created++;
        } else {
          insertErrors.push({ name: productName, shopify_id: String(p.id), error: error.message });
        }
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
    return json({ status: 'completed', processedThisPage, totalProcessed: newTotal, hasMore: false, debug: { created, updated, skippedNonInventory, insertErrors } });
  }

  EdgeRuntime.waitUntil(chainNext(FN_NAME, { mode: 'continue' }, nextDelay));
  return json({
    status: nearLimit ? 'rate_limited' : 'running',
    processedThisPage,
    totalProcessed: newTotal,
    hasMore: true,
    rateLimit: nearLimit ? { retryAfterSeconds: nextDelay } : undefined,
    debug: { created, updated, skippedNonInventory, insertErrors, apiCallLimit: res.apiCallLimit },
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
