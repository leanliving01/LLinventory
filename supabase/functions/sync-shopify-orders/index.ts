import { shopifyFetch, getSupabase, corsHeaders, json } from '../_shared/shopify.ts';
import {
  getSyncState, markRunning, markComplete, markError, markCancelled, shouldCancel,
} from '../_shared/sync-state.ts';
import { chainNext } from '../_shared/chain.ts';
import { startSyncLog, finishSyncLog } from '../_shared/sync-log.ts';

const SOURCE_KEY = 'shopify_orders';
const FN_NAME = 'sync-shopify-orders';
const PAGE_SIZE = 250;

interface ShopifyOrdersResponse { orders: ShopifyOrder[]; }

interface ShopifyOrder {
  id: number;
  order_number?: number | string;
  name?: string;
  customer?: { first_name?: string; last_name?: string; email?: string; phone?: string };
  email?: string;
  financial_status: string | null;
  fulfillment_status: string | null;
  tags?: string;
  created_at: string;
  total_price?: string;
  shipping_address?: { city?: string };
  line_items: ShopifyLineItem[];
}

interface ShopifyLineItem {
  id: number;
  title: string;
  variant_title?: string;
  quantity: number;
  sku?: string;
  price?: string;
  product_id?: number;
  variant_id?: number;
}

function mapLifecycleState(financial: string | null, fulfilment: string | null): string {
  if (financial === 'refunded' || financial === 'voided') return 'refunded';
  if (financial === 'paid' || financial === 'partially_refunded') {
    return fulfilment === 'fulfilled' ? 'fulfilled' : 'paid_unfulfilled';
  }
  return 'pending_payment';
}

function mapPaidStatus(s: string | null): string {
  switch (s) {
    case 'paid':                  return 'paid';
    case 'pending':               return 'unpaid';
    case 'partially_paid':        return 'partially_paid';
    case 'refunded':              return 'refunded';
    case 'partially_refunded':    return 'partially_paid';
    default:                      return 'unpaid';
  }
}

function mapFulfilmentStatus(s: string | null): string {
  switch (s) {
    case 'fulfilled':  return 'fulfilled';
    case 'partial':    return 'partial';
    case 'restocked':  return 'restocked';
    default:           return 'unfulfilled';
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders() });

  let body: { mode?: 'start' | 'continue' | 'cancel'; fullResync?: boolean; sinceDate?: string } = {};
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
    if (priorState?.sync_status === 'running' && !body.fullResync) {
      // Auto-clear if the running lock is stale (>30 min) — prevents permanent deadlock
      const staleCutoff = new Date(Date.now() - 30 * 60 * 1000);
      const lockedAt = priorState.updated_date ? new Date(priorState.updated_date) : null;
      if (!lockedAt || lockedAt < staleCutoff) {
        console.log('[sync-shopify-orders] Stale running lock detected — auto-clearing and restarting');
        await markCancelled(supabase, SOURCE_KEY);
      } else {
        return json({ status: 'error', error: 'Sync already in progress — wait for it to finish or cancel it first.', processedThisPage: 0, totalProcessed: priorState.records_synced || 0, hasMore: false });
      }
    }
    if (body.sinceDate) {
      // Explicit date window from UI (e.g. "Sync last 30 days")
      updatedAtMin = body.sinceDate;
    } else if (!body.fullResync && priorState?.last_sync_at) {
      // Apply a 5-minute look-back buffer to catch orders that fell in the gap
      // between the previous Shopify API call and when markComplete saved the timestamp.
      const lookback = new Date(priorState.last_sync_at);
      lookback.setMinutes(lookback.getMinutes() - 5);
      updatedAtMin = lookback.toISOString();
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

  // Shopify cursor pagination: page_info must be the ONLY filter param (+ limit)
  const params: Record<string, string> = { limit: String(PAGE_SIZE) };
  if (pageInfo) {
    params.page_info = pageInfo;
  } else {
    params.status = 'any';
    if (updatedAtMin) params.updated_at_min = updatedAtMin;
  }

  const res = await shopifyFetch<ShopifyOrdersResponse>('/orders.json', params);

  if (res.status === 429) {
    const retryAfter = res.retryAfter || 4;
    await markError(supabase, SOURCE_KEY, `rate_limited: retry in ${retryAfter}s`);
    await markRunning(supabase, SOURCE_KEY, JSON.stringify({ pageInfo: pageInfo || null, since: updatedAtMin || null, logId: syncLogId }), 0);
    EdgeRuntime.waitUntil(chainNext(FN_NAME, { mode: 'continue' }, retryAfter));
    return json({ status: 'rate_limited', processedThisPage: 0, totalProcessed, hasMore: true, rateLimit: { retryAfterSeconds: retryAfter } });
  }

  if (!res.ok) {
    await markError(supabase, SOURCE_KEY, `Shopify ${res.status}: ${(res.errorText || '').slice(0, 200)}`);
    return json({ status: 'error', error: `Shopify API ${res.status}`, processedThisPage: 0, totalProcessed, hasMore: false });
  }

  const orders = res.data?.orders || [];
  const nearLimit = res.apiCallLimit && (res.apiCallLimit.used / res.apiCallLimit.max) > 0.8;
  const nextDelay = nearLimit ? 10 : 1;

  if (orders.length === 0) {
    await markComplete(supabase, SOURCE_KEY, 0);
    return json({ status: 'completed', processedThisPage: 0, totalProcessed, hasMore: false });
  }

  const now = new Date().toISOString();

  const shopifyOrderIds = orders.map(o => String(o.id));
  const { data: existingRows } = await supabase
    .from('shopify_orders').select('id, shopify_order_id')
    .in('shopify_order_id', shopifyOrderIds);
  const existingByShopifyId = new Map<string, string>();
  for (const e of existingRows || []) existingByShopifyId.set(e.shopify_order_id as string, e.id as string);

  const toInsert: Record<string, unknown>[] = [];
  const toUpdate: Array<{ id: string; payload: Record<string, unknown> }> = [];
  const orderIdMap = new Map<string, string>();

  // Prepare sales_orders lookup (to preserve packing status on update)
  const salesOrderIds = orders.map(o => String(o.id));
  const { data: existingSalesRows } = await supabase
    .from('sales_orders').select('id, shopify_order_id, status')
    .in('shopify_order_id', salesOrderIds);
  const existingSalesById = new Map<string, { id: string; status: string }>();
  for (const r of existingSalesRows || []) {
    existingSalesById.set(r.shopify_order_id as string, { id: r.id as string, status: r.status as string });
  }

  const salesToInsert: Record<string, unknown>[] = [];
  const salesToUpdate: Array<{ id: string; payload: Record<string, unknown> }> = [];

  for (const o of orders) {
    const customerName = [o.customer?.first_name, o.customer?.last_name].filter(Boolean).join(' ') || null;
    // shopify_orders columns only — no total_amount (not in that table), no demand_calculated on updates
    const payload = {
      shopify_order_id: String(o.id),
      order_number: String(o.order_number || o.name || o.id),
      customer_name: customerName,
      paid_status: mapPaidStatus(o.financial_status),
      fulfilment_status: mapFulfilmentStatus(o.fulfillment_status),
      tags: o.tags || null,
      order_date: o.created_at,
      synced_at: now,
      updated_date: now,
    };
    const existingId = existingByShopifyId.get(String(o.id));
    if (existingId) {
      toUpdate.push({ id: existingId, payload });
      orderIdMap.set(String(o.id), existingId);
    } else {
      const newId = crypto.randomUUID();
      // demand_calculated only set false on brand-new orders — never overwritten on updates
      toInsert.push({ id: newId, ...payload, created_date: now, demand_calculated: false });
      orderIdMap.set(String(o.id), newId);
    }

    // Mirror into sales_orders
    const lifecycleState = mapLifecycleState(o.financial_status, o.fulfillment_status);
    const shopifyOrderId = String(o.id);
    const salesPayload = {
      shopify_order_id: shopifyOrderId,
      external_id: shopifyOrderId,
      order_number: String(o.order_number || o.name || o.id),
      customer_name: customerName,
      customer_email: o.email || o.customer?.email || null,
      customer_phone: o.customer?.phone || null,
      order_date: o.created_at,
      lifecycle_state: lifecycleState,
      total_amount: parseFloat(o.total_price || '0') || 0,
      tags: o.tags ? o.tags.replace(/,\s*/g, '|') : null,
      shipping_city: o.shipping_address?.city || null,
      updated_date: now,
      last_synced_at: now,
    };
    const existingSales = existingSalesById.get(shopifyOrderId);
    if (existingSales) {
      salesToUpdate.push({ id: existingSales.id, payload: salesPayload });
    } else {
      salesToInsert.push({ id: crypto.randomUUID(), ...salesPayload, created_date: now });
    }
  }

  // Bulk upsert shopify_orders (single query instead of N sequential updates)
  const allOrderRows = [
    ...toInsert,
    ...toUpdate.map(u => ({ id: u.id, ...u.payload })),
  ];
  if (allOrderRows.length) {
    const { error: soErr } = await supabase.from('shopify_orders').upsert(allOrderRows, { onConflict: 'id' });
    if (soErr) {
      await markError(supabase, SOURCE_KEY, `shopify_orders upsert: ${soErr.message}`);
      if (syncLogId) await finishSyncLog(supabase, syncLogId, 'failed', { records_fetched: totalProcessed });
      return json({ status: 'error', error: `DB error: ${soErr.message}`, processedThisPage: 0, totalProcessed, hasMore: false });
    }
  }

  // Bulk upsert sales_orders
  const allSalesRows = [
    ...salesToInsert,
    ...salesToUpdate.map(u => ({ id: u.id, ...u.payload })),
  ];
  if (allSalesRows.length) {
    const { error: siErr } = await supabase.from('sales_orders').upsert(allSalesRows, { onConflict: 'id' });
    if (siErr) console.error('sales_orders upsert error:', siErr.message);
  }

  // Build salesIdMap: shopify_order_id → our sales_order id
  const salesIdMap = new Map<string, string>();
  for (const r of salesToInsert) salesIdMap.set(r.shopify_order_id as string, r.id as string);
  for (const o of orders) {
    const ex = existingSalesById.get(String(o.id));
    if (ex) salesIdMap.set(String(o.id), ex.id);
  }

  // Bulk replace line items for these orders
  const affectedIds = Array.from(orderIdMap.values());
  if (affectedIds.length) {
    await supabase.from('shopify_order_lines').delete().in('shopify_order_id', affectedIds);
  }

  // Also clear and replace sales_order_lines for affected sales_orders
  const affectedSalesIds = Array.from(salesIdMap.values()).filter(Boolean);
  if (affectedSalesIds.length) {
    await supabase.from('sales_order_lines').delete()
      .in('sales_order_id', affectedSalesIds)
      .eq('source_platform', 'shopify');
  }

  function detectLineType(title: string): string {
    const t = (title || '').toLowerCase();
    if (t.includes('low carb')) return 'low_carb_package';
    if (t.includes('lean muscle') || t.includes('weight loss') || t.includes('meals')) return 'goal_package';
    return 'standalone';
  }

  const allLines: Record<string, unknown>[] = [];
  const allSalesLines: Record<string, unknown>[] = [];

  for (const o of orders) {
    const ourOrderId = orderIdMap.get(String(o.id));
    const ourSalesId = salesIdMap.get(String(o.id));
    if (!o.line_items?.length) continue;

    for (const l of o.line_items) {
      if (ourOrderId) {
        allLines.push({
          id: crypto.randomUUID(),
          shopify_order_id: ourOrderId,
          shopify_line_item_id: String(l.id),
          sku: l.sku || null,
          product_title: l.title || 'Untitled',
          variant_title: l.variant_title || null,
          quantity: l.quantity || 0,
          is_mapped: false,
          raw_payload: l,
          created_date: now,
          updated_date: now,
        });
      }

      if (ourSalesId) {
        const lineType = detectLineType(l.title || '');
        const isPackage = lineType !== 'standalone';
        const unitPrice = parseFloat(l.price || '0') || 0;
        allSalesLines.push({
          id: crypto.randomUUID(),
          sales_order_id: ourSalesId,
          external_id: String(l.id),
          shopify_variant_id: l.variant_id ? String(l.variant_id) : null,
          sku: l.sku || '',
          name: l.title || 'Untitled',
          variant_title: l.variant_title || null,
          qty: l.quantity || 0,
          unit_price: unitPrice,
          line_total: unitPrice * (l.quantity || 0),
          is_package_parent: isPackage,
          is_package_component: false,
          parent_line_id: null,
          line_type: lineType,
          status: 'active',
          source_platform: 'shopify',
          last_synced_at: now,
          raw_payload: l,
          created_date: now,
          updated_date: now,
        });
      }
    }
  }

  if (allLines.length) await supabase.from('shopify_order_lines').insert(allLines);
  if (allSalesLines.length) {
    const { error: slErr } = await supabase.from('sales_order_lines').insert(allSalesLines);
    if (slErr) console.error('sales_order_lines insert error:', slErr.message);
  }

  const processedThisPage = orders.length;
  const newTotal = totalProcessed + processedThisPage;
  await markRunning(
    supabase, SOURCE_KEY,
    JSON.stringify({ pageInfo: res.nextPageInfo || null, since: updatedAtMin || null, logId: syncLogId }),
    processedThisPage,
  );

  const hasMore = !!res.nextPageInfo;
  if (!hasMore) {
    await markComplete(supabase, SOURCE_KEY, processedThisPage);
    if (syncLogId) await finishSyncLog(supabase, syncLogId, 'completed', { records_fetched: newTotal });
    return json({ status: 'completed', processedThisPage, totalProcessed: newTotal, hasMore: false });
  }

  EdgeRuntime.waitUntil(chainNext(FN_NAME, { mode: 'continue' }, nextDelay));
  return json({
    status: nearLimit ? 'rate_limited' : 'running',
    processedThisPage,
    totalProcessed: newTotal,
    hasMore: true,
    rateLimit: nearLimit ? { retryAfterSeconds: nextDelay } : undefined,
    debug: { apiCallLimit: res.apiCallLimit },
  });
});
