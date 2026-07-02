import { shopifyFetch, getSupabase, corsHeaders, json } from '../_shared/shopify.ts';
import {
  getSyncState, markRunning, markComplete, markError, markCancelled, shouldCancel,
} from '../_shared/sync-state.ts';
import { chainNext } from '../_shared/chain.ts';
import { startSyncLog, finishSyncLog } from '../_shared/sync-log.ts';
import { upsertDraftReturnFromRefund } from '../_shared/returns.ts';
import {
  loadClassificationRules, classifyLineItem, deriveOrderFinancialLines,
  refundCancelledQtyByLineId, effectiveLineQty,
  type ClassificationRule,
} from '../_shared/order-classification.ts';
import { loadPackageSkus, isPackageSku } from '../_shared/packaging.ts';

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
  subtotal_price?: string;
  total_tax?: string;
  total_discounts?: string;
  total_tip_received?: string;
  shipping_address?: { city?: string };
  shipping_lines?: ShopifyShippingLine[];
  // deno-lint-ignore no-explicit-any
  discount_applications?: any[];
  // deno-lint-ignore no-explicit-any
  discount_codes?: any[];
  line_items: ShopifyLineItem[];
  // deno-lint-ignore no-explicit-any
  refunds?: any[];
  cancelled_at?: string | null;
  closed_at?: string | null;
  fulfillments?: ShopifyFulfillment[];
}

interface ShopifyFulfillment {
  status?: string;
  created_at?: string;
  tracking_number?: string | null;
  tracking_company?: string | null;
  tracking_url?: string | null;
  // deno-lint-ignore no-explicit-any
  tracking_urls?: any[];
}

// Pull courier / tracking from the most recent fulfilment, when present.
// Returns only keys that have a value so a re-sync never wipes existing data.
function fulfilmentFields(o: ShopifyOrder): Record<string, unknown> {
  const f = (o.fulfillments || []).filter(x => x && x.status !== 'cancelled');
  if (!f.length) return {};
  const latest = f[f.length - 1];
  const out: Record<string, unknown> = {};
  if (latest.tracking_company) out.courier = latest.tracking_company;
  if (latest.tracking_number) out.tracking_number = latest.tracking_number;
  const url = latest.tracking_url || (Array.isArray(latest.tracking_urls) ? latest.tracking_urls[0] : null);
  if (url) out.tracking_url = url;
  // shipped_at is intentionally NOT set here — the in-app packing flow owns it
  // (and dispatch KPIs depend on it). We only enrich courier/tracking metadata.
  return out;
}

interface ShopifyShippingLine {
  id?: number | string;
  title?: string;
  price?: string;
  // deno-lint-ignore no-explicit-any
  tax_lines?: any[];
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
  product_type?: string;
  gift_card?: boolean;
  // deno-lint-ignore no-explicit-any
  discount_allocations?: any[];
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

// sales_orders.payment_status / fulfillment_status have CHECK constraints that
// differ from the shopify_orders columns. Coerce to the allowed value sets.
const SALES_PAYMENT_ALLOWED = ['paid','pending','partially_paid','refunded','voided','authorized','partially_refunded'];
function mapSalesPaymentStatus(s: string | null): string {
  return s && SALES_PAYMENT_ALLOWED.includes(s) ? s : 'pending';
}
function mapSalesFulfilmentStatus(s: string | null): string {
  return s === 'fulfilled' ? 'fulfilled' : s === 'partial' ? 'partial' : 'unfulfilled';
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

    // Mirror into sales_orders. A Shopify cancellation overrides lifecycle so the
    // cancelled status shows correctly (deduct_fulfilled_stock ignores non-fulfilled).
    const lifecycleState = o.cancelled_at
      ? 'cancelled'
      : mapLifecycleState(o.financial_status, o.fulfillment_status);
    const shopifyOrderId = String(o.id);
    const salesPayload = {
      shopify_order_id: shopifyOrderId,
      external_id: shopifyOrderId,
      order_number: String(o.order_number || o.name || o.id),
      order_source: 'shopify',
      customer_name: customerName,
      customer_email: o.email || o.customer?.email || null,
      customer_phone: o.customer?.phone || null,
      order_date: o.created_at,
      lifecycle_state: lifecycleState,
      cancelled_at: o.cancelled_at || null,
      // Shopify "Archive" sets closed_at. An archived order is done with — it must
      // stop reserving stock even if it never reached fulfilled (recalc_committed_stock
      // excludes orders with closed_at set).
      closed_at: o.closed_at || null,
      payment_status: mapSalesPaymentStatus(o.financial_status),
      fulfillment_status: mapSalesFulfilmentStatus(o.fulfillment_status),
      total_amount: parseFloat(o.total_price || '0') || 0,
      subtotal_price: parseFloat(o.subtotal_price || '0') || 0,
      total_tax: parseFloat(o.total_tax || '0') || 0,
      total_discounts: parseFloat(o.total_discounts || '0') || 0,
      shipping_cost: (o.shipping_lines || []).reduce((s, sl) => s + (parseFloat(sl.price || '0') || 0), 0),
      tags: o.tags ? o.tags.replace(/,\s*/g, '|') : null,
      shipping_city: o.shipping_address?.city || null,
      updated_date: now,
      last_synced_at: now,
      raw_payload: o,
      ...fulfilmentFields(o),
    };
    const existingSales = existingSalesById.get(shopifyOrderId);
    if (existingSales) {
      salesToUpdate.push({ id: existingSales.id, payload: salesPayload });
    } else {
      salesToInsert.push({ id: crypto.randomUUID(), ...salesPayload, created_date: now });
    }
  }

  // Inserts and updates MUST be separate calls. A single mixed upsert makes
  // supabase-js union the keys across the batch, so created_date (present only on
  // the insert rows) gets added to the column list for the update rows too and is
  // sent as an explicit NULL → NOT NULL violation. Keep the two row-sets apart so
  // each batch has a uniform column set.
  if (toInsert.length) {
    const { error: soInsErr } = await supabase.from('shopify_orders').insert(toInsert);
    if (soInsErr) {
      await markError(supabase, SOURCE_KEY, `shopify_orders insert: ${soInsErr.message}`);
      if (syncLogId) await finishSyncLog(supabase, syncLogId, 'failed', { records_fetched: totalProcessed });
      return json({ status: 'error', error: `DB error: ${soInsErr.message}`, processedThisPage: 0, totalProcessed, hasMore: false });
    }
  }
  if (toUpdate.length) {
    const { error: soUpdErr } = await supabase
      .from('shopify_orders')
      .upsert(toUpdate.map(u => ({ id: u.id, ...u.payload })), { onConflict: 'id' });
    if (soUpdErr) {
      await markError(supabase, SOURCE_KEY, `shopify_orders update: ${soUpdErr.message}`);
      if (syncLogId) await finishSyncLog(supabase, syncLogId, 'failed', { records_fetched: totalProcessed });
      return json({ status: 'error', error: `DB error: ${soUpdErr.message}`, processedThisPage: 0, totalProcessed, hasMore: false });
    }
  }

  // sales_orders — same rule: never mix inserts and updates in one upsert.
  if (salesToInsert.length) {
    const { error: siErr } = await supabase.from('sales_orders').insert(salesToInsert);
    if (siErr) console.error('sales_orders insert error:', siErr.message);
  }
  if (salesToUpdate.length) {
    const { error: suErr } = await supabase
      .from('sales_orders')
      .upsert(salesToUpdate.map(u => ({ id: u.id, ...u.payload })), { onConflict: 'id' });
    if (suErr) console.error('sales_orders update error:', suErr.message);
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

  // Snapshot existing lines BEFORE delete so we can detect real order edits
  // (added / removed / qty-changed). Best-effort: failures must not break sync.
  const priorLinesByOrder = new Map<string, Map<string, number>>();
  try {
    if (affectedSalesIds.length) {
      const { data: priorLines } = await supabase
        .from('sales_order_lines')
        .select('sales_order_id, sku, qty')
        .in('sales_order_id', affectedSalesIds)
        .eq('source_platform', 'shopify');
      for (const pl of priorLines || []) {
        const oid = pl.sales_order_id as string;
        if (!priorLinesByOrder.has(oid)) priorLinesByOrder.set(oid, new Map());
        const m = priorLinesByOrder.get(oid)!;
        const sku = String(pl.sku || '');
        m.set(sku, (m.get(sku) || 0) + Number(pl.qty || 0)); // aggregate dup SKUs
      }
    }
  } catch (e) {
    console.error('[sync-shopify-orders] prior-lines snapshot failed:', (e as Error).message);
  }

  if (affectedSalesIds.length) {
    await supabase.from('sales_order_lines').delete()
      .in('sales_order_id', affectedSalesIds)
      .eq('source_platform', 'shopify');
    // Replace previously-synced order-level financial lines (shipping/discount/
    // voucher/refund/etc). Manual lines (source='manual') are preserved.
    await supabase.from('sales_order_financial_lines').delete()
      .in('sales_order_id', affectedSalesIds)
      .eq('source', 'shopify');
  }

  // Load classification rules once for this page.
  const rules: ClassificationRule[] = await loadClassificationRules(supabase);
  // Known package SKUs (data-driven; from the pack_boms explosion map).
  const packageSkus = await loadPackageSkus(supabase);

  // Only real product lines become inventory-tracked sales_order_lines.
  function detectLineType(title: string): string {
    const t = (title || '').toLowerCase();
    if (t.includes('low carb')) return 'low_carb_package';
    if (t.includes('lean muscle') || t.includes('weight loss') || t.includes('meals')) return 'goal_package';
    return 'standalone';
  }

  const allLines: Record<string, unknown>[] = [];
  const allSalesLines: Record<string, unknown>[] = [];
  const allFinancialLines: Record<string, unknown>[] = [];

  for (const o of orders) {
    const ourOrderId = orderIdMap.get(String(o.id));
    const ourSalesId = salesIdMap.get(String(o.id));
    const orderNumber = String(o.order_number || o.name || o.id);
    // Units removed via a restock_type='cancel' refund (never shipped).
    const cancelledByLineId = refundCancelledQtyByLineId(o);

    for (const l of (o.line_items || [])) {
      // Raw staging keeps EVERY line item (mapping/audit), product or not.
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

      if (!ourSalesId) continue;

      const { category, label, matchedRuleId } = classifyLineItem(l, rules);
      const unitPrice = parseFloat(l.price || '0') || 0;
      const lineTotal = unitPrice * (l.quantity || 0);

      if (category === 'inventory_product') {
        const lineType = detectLineType(l.title || '');
        // Data-driven first: any SKU with an active pack_boms row IS a package,
        // regardless of the title. Fall back to the title heuristic otherwise.
        const isPackage = isPackageSku(l.sku, packageSkus) || lineType !== 'standalone';
        // Net out cancel-refunded units. A line refunded to zero is kept for audit
        // but marked 'cancelled' so it no longer commits or deducts stock.
        const netQty = effectiveLineQty(l, cancelledByLineId);
        allSalesLines.push({
          id: crypto.randomUUID(),
          sales_order_id: ourSalesId,
          external_id: String(l.id),
          shopify_variant_id: l.variant_id ? String(l.variant_id) : null,
          sku: l.sku || '',
          name: l.title || 'Untitled',
          variant_title: l.variant_title || null,
          qty: netQty,
          unit_price: unitPrice,
          line_total: unitPrice * netQty,
          is_package_parent: isPackage,
          is_package_component: false,
          parent_line_id: null,
          line_type: lineType,
          status: netQty > 0 ? 'active' : 'cancelled',
          source_platform: 'shopify',
          last_synced_at: now,
          raw_payload: l,
          created_date: now,
          updated_date: now,
        });
      } else {
        // Non-inventory line item (e.g. a "Local pickup"/"Free shipping"/gift
        // card line) → order-level financial line, no stock, no product master.
        // Discounts reduce revenue; everything else here is a charge.
        const sign = (category === 'discount' || category === 'voucher'
          || category === 'store_credit' || category === 'refund') ? -1 : 1;
        allFinancialLines.push({
          id: crypto.randomUUID(),
          sales_order_id: ourSalesId,
          shopify_order_id: String(o.id),
          order_number: orderNumber,
          category,
          label: label || (l.title || 'Untitled'),
          amount: Math.abs(lineTotal),
          sign,
          tax_amount: 0,
          source: 'shopify',
          external_ref: String(l.id),
          matched_rule_id: matchedRuleId,
          raw_payload: l,
          created_date: now,
          updated_date: now,
        });
      }
    }

    // Order-level financial lines from structural fields (shipping_lines,
    // total_discounts, tips, shipping-only/manual refunds).
    if (ourSalesId) {
      for (const d of deriveOrderFinancialLines(o, rules)) {
        allFinancialLines.push({
          id: crypto.randomUUID(),
          sales_order_id: ourSalesId,
          shopify_order_id: String(o.id),
          order_number: orderNumber,
          category: d.category,
          label: d.label,
          amount: d.amount,
          sign: d.sign,
          tax_amount: d.tax_amount,
          source: d.source,
          external_ref: d.external_ref,
          matched_rule_id: d.matched_rule_id,
          raw_payload: d.raw_payload,
          created_date: now,
          updated_date: now,
        });
      }
    }
  }

  if (allLines.length) await supabase.from('shopify_order_lines').insert(allLines);
  if (allSalesLines.length) {
    // Upsert (not insert): a concurrent re-import of the same order (scheduled
    // sync racing the order's webhook) would otherwise interleave with the
    // delete-then-insert above and duplicate every line. The unique index on
    // (sales_order_id, external_id) — migration 103 — makes the losing racer's
    // rows conflict; ignoreDuplicates turns that into a no-op instead of an error.
    const { error: slErr } = await supabase.from('sales_order_lines')
      .upsert(allSalesLines, { onConflict: 'sales_order_id,external_id', ignoreDuplicates: true });
    if (slErr) console.error('sales_order_lines upsert error:', slErr.message);
  }
  if (allFinancialLines.length) {
    const { error: flErr } = await supabase.from('sales_order_financial_lines').insert(allFinancialLines);
    if (flErr) console.error('sales_order_financial_lines insert error:', flErr.message);
  }

  // Audit timeline events: 'imported' for brand-new orders, 'edited' only when
  // the line set actually changed vs the prior snapshot (so routine re-syncs do
  // not spam the timeline). Fully guarded — never breaks the sync.
  try {
    const newSalesIds = new Set(salesToInsert.map(r => r.id as string));
    // Build new line snapshot per order from allSalesLines.
    const newLinesByOrder = new Map<string, Map<string, number>>();
    for (const l of allSalesLines) {
      const oid = l.sales_order_id as string;
      if (!newLinesByOrder.has(oid)) newLinesByOrder.set(oid, new Map());
      const m = newLinesByOrder.get(oid)!;
      const sku = String(l.sku || '');
      m.set(sku, (m.get(sku) || 0) + Number(l.qty || 0));
    }
    const events: Record<string, unknown>[] = [];
    for (const o of orders) {
      const sid = salesIdMap.get(String(o.id));
      if (!sid) continue;
      const orderNumber = String(o.order_number || o.name || o.id);
      if (newSalesIds.has(sid)) {
        events.push({
          id: crypto.randomUUID(), sales_order_id: sid, shopify_order_id: String(o.id),
          order_number: orderNumber, event_type: 'imported',
          description: 'Imported from Shopify', actor: 'shopify-sync',
          metadata: { financial_status: o.financial_status, fulfillment_status: o.fulfillment_status },
          created_date: now, updated_date: now,
        });
        continue;
      }
      // Existing order — diff prior vs new lines.
      const prior = priorLinesByOrder.get(sid) || new Map<string, number>();
      const next = newLinesByOrder.get(sid) || new Map<string, number>();
      const added: string[] = [], removed: string[] = [], changed: string[] = [];
      for (const [sku, q] of next) {
        if (!prior.has(sku)) added.push(`${sku} x${q}`);
        else if (prior.get(sku) !== q) changed.push(`${sku}: ${prior.get(sku)}→${q}`);
      }
      for (const [sku, q] of prior) {
        if (!next.has(sku)) removed.push(`${sku} x${q}`);
      }
      if (added.length || removed.length || changed.length) {
        events.push({
          id: crypto.randomUUID(), sales_order_id: sid, shopify_order_id: String(o.id),
          order_number: orderNumber, event_type: 'edited',
          description: 'Order lines updated from Shopify', actor: 'shopify-sync',
          metadata: { added, removed, changed }, created_date: now, updated_date: now,
        });
      }
    }
    if (events.length) {
      const { error: evErr } = await supabase.from('sales_order_events').insert(events);
      if (evErr) console.error('[sync-shopify-orders] events insert:', evErr.message);
    }
  } catch (e) {
    console.error('[sync-shopify-orders] audit events failed:', (e as Error).message);
  }

  // Import any Shopify refunds on these orders as Draft Returns (no stock movement).
  // Runs after sales_order_lines exist so the helper can map line items → products.
  for (const o of orders) {
    if (!o.refunds?.length) continue;
    for (const refund of o.refunds) {
      try {
        await upsertDraftReturnFromRefund(supabase, refund, o.id);
      } catch (e) {
        console.error('upsertDraftReturnFromRefund error:', (e as Error).message);
      }
    }
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
