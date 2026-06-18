// shopify-history-import
// Pulls full order history via Shopify GraphQL Bulk Operations API.
// The REST orders endpoint only returns the last ~60 days; bulk operations
// export everything as a downloadable JSONL file.
//
// Phases (pass mode in request body):
//   start  → trigger bulk operation, chain to poll
//   poll   → check operation status, chain to import when done
//   import → stream JSONL in 2 MB chunks, insert orders into DB, chain until done

import { getSupabase, corsHeaders, json, SHOPIFY_TOKEN, shopifyBaseUrl } from '../_shared/shopify.ts';
import {
  getSyncState, markRunning, markComplete, markError,
} from '../_shared/sync-state.ts';
import { chainNext } from '../_shared/chain.ts';
import {
  loadClassificationRules, classifyLineItem, type ClassificationRule,
} from '../_shared/order-classification.ts';

const SOURCE_KEY  = 'shopify_history_import';
const FN_NAME     = 'shopify-history-import';
const CHUNK_BYTES = 2 * 1024 * 1024; // 2 MB per invocation
const ORDER_BATCH = 50;

// ── GraphQL helpers ──────────────────────────────────────────────────────────

function gqlUrl(): string {
  return shopifyBaseUrl() + '/graphql.json';
}

async function shopifyGql(query: string): Promise<unknown> {
  const res = await fetch(gqlUrl(), {
    method: 'POST',
    headers: {
      'X-Shopify-Access-Token': SHOPIFY_TOKEN,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query }),
  });
  if (!res.ok) throw new Error(`GraphQL HTTP ${res.status}: ${await res.text()}`);
  return res.json();
}

// ── Status mappers ────────────────────────────────────────────────────────────

function mapPaidStatus(gql: string): string {
  const l = (gql || '').toLowerCase();
  if (l === 'pending')            return 'unpaid';
  if (l === 'partially_refunded') return 'refunded';
  return l || 'unpaid';
}

function mapSalesPayment(gql: string): string {
  const allowed = ['paid','pending','partially_paid','refunded','voided','authorized','partially_refunded'];
  const l = (gql || '').toLowerCase();
  return allowed.includes(l) ? l : 'pending';
}

function mapFulfilment(gql: string): string {
  const l = (gql || '').toLowerCase();
  if (l === 'fulfilled')      return 'fulfilled';
  if (l.includes('partial'))  return 'partial';
  return 'unfulfilled';
}

function mapLifecycle(financialGql: string, fulfilmentGql: string, cancelledAt: string | null): string {
  if (cancelledAt) return 'cancelled';
  const f = (financialGql || '').toLowerCase();
  if (f === 'refunded' || f === 'voided') return 'refunded';
  if (f === 'paid' || f === 'partially_refunded') {
    return (fulfilmentGql || '').toLowerCase() === 'fulfilled' ? 'fulfilled' : 'paid_unfulfilled';
  }
  return 'pending_payment';
}

function detectLineType(title: string): string {
  const t = (title || '').toLowerCase();
  if (t.includes('low carb'))                                                         return 'low_carb_package';
  if (t.includes('lean muscle') || t.includes('weight loss') || t.includes('meals')) return 'goal_package';
  return 'standalone';
}

function legacyId(gid: string): string { return (gid || '').split('/').pop() || gid; }

// ── JSONL record types ────────────────────────────────────────────────────────

interface GqlOrder {
  id: string;
  legacyResourceId: string;
  name: string;
  createdAt: string;
  cancelledAt?: string | null;
  displayFinancialStatus: string;
  displayFulfillmentStatus: string;
  tags?: string[] | string | null;
  email?: string | null;
  totalPriceSet?:     { shopMoney?: { amount?: string } };
  subtotalPriceSet?:  { shopMoney?: { amount?: string } };
  totalTaxSet?:       { shopMoney?: { amount?: string } };
  totalDiscountsSet?: { shopMoney?: { amount?: string } };
  customer?: { firstName?: string; lastName?: string; email?: string; phone?: string };
  shippingAddress?: { city?: string };
  fulfillments?: Array<{
    status?: string;
    createdAt?: string;
    trackingInfo?: Array<{ company?: string | null; number?: string; url?: string }>;
  }>;
}

interface GqlLineItem {
  id: string;
  __parentId: string;
  title?: string;
  variantTitle?: string;
  quantity?: number;
  sku?: string | null;
  originalUnitPriceSet?: { shopMoney?: { amount?: string } };
}

interface GqlShippingLine {
  id: string;
  __parentId: string;
  title?: string;
  originalPriceSet?: { shopMoney?: { amount?: string } };
}

interface PendingOrder {
  order: GqlOrder;
  lineItems: GqlLineItem[];
  shippingLines: GqlShippingLine[];
}

interface ImportCursor {
  phase: 'poll' | 'import';
  bulk_op_id?: string;
  jsonl_url?: string;
  byte_offset?: number;
  orders_imported?: number;
  file_size?: number;
  pending?: PendingOrder | null;
}

// ── DB batch insert ───────────────────────────────────────────────────────────

// deno-lint-ignore no-explicit-any
type SB = any;

async function flushBatch(
  supabase: SB,
  batch: PendingOrder[],
  rules: ClassificationRule[],
): Promise<void> {
  if (!batch.length) return;
  const now = new Date().toISOString();

  const shopifyIds = batch.map(b => b.order.legacyResourceId);

  const { data: existingSO } = await supabase
    .from('shopify_orders').select('id, shopify_order_id').in('shopify_order_id', shopifyIds);
  const existingSOMap = new Map<string, string>();
  for (const e of existingSO || []) existingSOMap.set(e.shopify_order_id, e.id);

  const { data: existingSales } = await supabase
    .from('sales_orders').select('id, shopify_order_id').in('shopify_order_id', shopifyIds);
  const existingSalesMap = new Map<string, string>();
  for (const e of existingSales || []) existingSalesMap.set(e.shopify_order_id, e.id);

  const toInsertSO: Record<string, unknown>[] = [];
  const toUpdateSO: Array<{ id: string; payload: Record<string, unknown> }> = [];
  const toInsertSales: Record<string, unknown>[] = [];
  const toUpdateSales: Array<{ id: string; payload: Record<string, unknown> }> = [];
  const orderIdMap = new Map<string, string>();
  const salesIdMap = new Map<string, string>();

  for (const { order, shippingLines } of batch) {
    const shopifyId  = order.legacyResourceId;
    const orderNum   = (order.name || '').replace(/^#/, '') || shopifyId;
    const custName   = [order.customer?.firstName, order.customer?.lastName].filter(Boolean).join(' ') || null;
    const shippingCost = shippingLines.reduce((s, sl) =>
      s + (parseFloat(sl.originalPriceSet?.shopMoney?.amount || '0') || 0), 0);

    // Tracking from last active fulfillment
    const active = (order.fulfillments || []).filter(f => f.status !== 'CANCELLED');
    const lastF  = active[active.length - 1];
    const trackingNumber = lastF?.trackingInfo?.[0]?.number  || null;
    const trackingUrl    = lastF?.trackingInfo?.[0]?.url     || null;
    const courier        = lastF?.trackingInfo?.[0]?.company || null;

    const paidStatus  = mapPaidStatus(order.displayFinancialStatus);
    const fulStatus   = mapFulfilment(order.displayFulfillmentStatus);
    const lifecycle   = mapLifecycle(order.displayFinancialStatus, order.displayFulfillmentStatus, order.cancelledAt || null);

    const tagsStr = Array.isArray(order.tags)
      ? (order.tags.length ? order.tags.join('|') : null)
      : (order.tags ? String(order.tags).replace(/,\s*/g, '|') : null);

    const soPld = {
      shopify_order_id:  shopifyId,
      order_number:      orderNum,
      customer_name:     custName,
      paid_status:       paidStatus,
      fulfilment_status: fulStatus,
      tags:              tagsStr,
      order_date:        order.createdAt,
      synced_at:         now,
      updated_date:      now,
    };
    const existingSOId = existingSOMap.get(shopifyId);
    const soId = existingSOId || crypto.randomUUID();
    if (existingSOId) toUpdateSO.push({ id: existingSOId, payload: soPld });
    else              toInsertSO.push({ id: soId, ...soPld, created_date: now, demand_calculated: false });
    orderIdMap.set(shopifyId, soId);

    const salesPld = {
      shopify_order_id:   shopifyId,
      external_id:        shopifyId,
      order_number:       orderNum,
      order_source:       'shopify',
      customer_name:      custName,
      customer_email:     order.customer?.email || order.email || null,
      customer_phone:     order.customer?.phone || null,
      order_date:         order.createdAt,
      lifecycle_state:    lifecycle,
      cancelled_at:       order.cancelledAt || null,
      payment_status:     mapSalesPayment(order.displayFinancialStatus),
      fulfillment_status: fulStatus,
      total_amount:       parseFloat(order.totalPriceSet?.shopMoney?.amount     || '0') || 0,
      subtotal_price:     parseFloat(order.subtotalPriceSet?.shopMoney?.amount  || '0') || 0,
      total_tax:          parseFloat(order.totalTaxSet?.shopMoney?.amount       || '0') || 0,
      total_discounts:    parseFloat(order.totalDiscountsSet?.shopMoney?.amount || '0') || 0,
      shipping_cost:      shippingCost,
      shipping_city:      order.shippingAddress?.city || null,
      tags:               tagsStr,
      updated_date:       now,
      last_synced_at:     now,
      ...(trackingNumber ? { tracking_number: trackingNumber } : {}),
      ...(trackingUrl    ? { tracking_url: trackingUrl }        : {}),
      ...(courier        ? { courier }                          : {}),
    };
    const existingSalesId = existingSalesMap.get(shopifyId);
    const salesId = existingSalesId || crypto.randomUUID();
    if (existingSalesId) toUpdateSales.push({ id: existingSalesId, payload: salesPld });
    else                 toInsertSales.push({ id: salesId, ...salesPld, created_date: now });
    salesIdMap.set(shopifyId, salesId);
  }

  if (toInsertSO.length) {
    const { error } = await supabase.from('shopify_orders').insert(toInsertSO);
    if (error) console.error('[history-import] shopify_orders insert:', error.message);
  }
  if (toUpdateSO.length) {
    const { error } = await supabase.from('shopify_orders')
      .upsert(toUpdateSO.map(u => ({ id: u.id, ...u.payload })), { onConflict: 'id' });
    if (error) console.error('[history-import] shopify_orders update:', error.message);
  }
  if (toInsertSales.length) {
    const { error } = await supabase.from('sales_orders').insert(toInsertSales);
    if (error) console.error('[history-import] sales_orders insert:', error.message);
  }
  if (toUpdateSales.length) {
    const { error } = await supabase.from('sales_orders')
      .upsert(toUpdateSales.map(u => ({ id: u.id, ...u.payload })), { onConflict: 'id' });
    if (error) console.error('[history-import] sales_orders update:', error.message);
  }

  // Rebuild line items for all affected orders
  const affectedSOIds    = Array.from(orderIdMap.values()).filter(Boolean);
  const affectedSalesIds = Array.from(salesIdMap.values()).filter(Boolean);
  if (affectedSOIds.length)    await supabase.from('shopify_order_lines').delete().in('shopify_order_id', affectedSOIds);
  if (affectedSalesIds.length) await supabase.from('sales_order_lines').delete()
    .in('sales_order_id', affectedSalesIds).eq('source_platform', 'shopify');

  const allShopifyLines: Record<string, unknown>[] = [];
  const allSalesLines:   Record<string, unknown>[] = [];

  for (const { order, lineItems } of batch) {
    const shopifyId = order.legacyResourceId;
    const soId      = orderIdMap.get(shopifyId);
    const salesId   = salesIdMap.get(shopifyId);

    for (const l of lineItems) {
      if (soId) {
        allShopifyLines.push({
          id: crypto.randomUUID(),
          shopify_order_id:    soId,
          shopify_line_item_id: legacyId(l.id),
          sku:          l.sku || null,
          product_title: l.title || 'Untitled',
          variant_title: l.variantTitle || null,
          quantity:      l.quantity || 0,
          is_mapped:     false,
          raw_payload:   l,
          created_date:  now,
          updated_date:  now,
        });
      }
      if (!salesId) continue;

      const { category } = classifyLineItem({
        title: l.title, sku: l.sku || undefined,
      }, rules);
      if (category !== 'inventory_product') continue;

      const lineType  = detectLineType(l.title || '');
      const unitPrice = parseFloat(l.originalUnitPriceSet?.shopMoney?.amount || '0') || 0;
      allSalesLines.push({
        id: crypto.randomUUID(),
        sales_order_id:     salesId,
        external_id:        legacyId(l.id),
        shopify_variant_id: null,
        sku:                l.sku || '',
        name:               l.title || 'Untitled',
        variant_title:      l.variantTitle || null,
        qty:                l.quantity || 0,
        unit_price:         unitPrice,
        line_total:         unitPrice * (l.quantity || 0),
        is_package_parent:  lineType !== 'standalone',
        is_package_component: false,
        parent_line_id:     null,
        line_type:          lineType,
        status:             'active',
        source_platform:    'shopify',
        last_synced_at:     now,
        raw_payload:        l,
        created_date:       now,
        updated_date:       now,
      });
    }
  }

  if (allShopifyLines.length) await supabase.from('shopify_order_lines').insert(allShopifyLines);
  if (allSalesLines.length) {
    const { error } = await supabase.from('sales_order_lines').insert(allSalesLines);
    if (error) console.error('[history-import] sales_order_lines insert:', error.message);
  }
}

// ── Main handler ──────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders() });

  let body: { mode?: string; sinceDate?: string } = {};
  try { body = await req.json(); } catch { /* ok */ }

  const supabase = getSupabase();
  const mode = body.mode || 'start';

  // ── start ──────────────────────────────────────────────────────────────────
  if (mode === 'start') {
    const since = body.sinceDate || (() => {
      const d = new Date();
      d.setMonth(d.getMonth() - 16);
      return d.toISOString().slice(0, 10);
    })();

    console.log(`[history-import] Starting bulk operation since ${since}`);

    const mutation = `
      mutation {
        bulkOperationRunQuery(
          query: """
          {
            orders(query: "created_at:>${since}") {
              edges {
                node {
                  id
                  legacyResourceId
                  name
                  createdAt
                  cancelledAt
                  displayFinancialStatus
                  displayFulfillmentStatus
                  tags
                  email
                  totalPriceSet { shopMoney { amount } }
                  subtotalPriceSet { shopMoney { amount } }
                  totalTaxSet { shopMoney { amount } }
                  totalDiscountsSet { shopMoney { amount } }
                  customer { firstName lastName email phone }
                  shippingAddress { city }
                  fulfillments {
                    status
                    createdAt
                    trackingInfo { company number url }
                  }
                  shippingLines {
                    edges {
                      node {
                        id
                        title
                        originalPriceSet { shopMoney { amount } }
                      }
                    }
                  }
                  lineItems {
                    edges {
                      node {
                        id
                        title
                        variantTitle
                        quantity
                        sku
                        originalUnitPriceSet { shopMoney { amount } }
                      }
                    }
                  }
                }
              }
            }
          }
          """
        ) {
          bulkOperation { id status }
          userErrors { field message }
        }
      }
    `;

    // deno-lint-ignore no-explicit-any
    const gqlRes = await shopifyGql(mutation) as any;
    const bulkOp = gqlRes?.data?.bulkOperationRunQuery?.bulkOperation;
    const errors = gqlRes?.data?.bulkOperationRunQuery?.userErrors;

    if (errors?.length) {
      const msg = errors.map((e: { message: string }) => e.message).join('; ');
      await markError(supabase, SOURCE_KEY, `Bulk op start error: ${msg}`);
      return json({ status: 'error', error: msg });
    }
    if (!bulkOp?.id) {
      await markError(supabase, SOURCE_KEY, 'No bulk operation ID returned');
      return json({ status: 'error', error: 'No bulk operation ID returned' });
    }

    const cursor: ImportCursor = { phase: 'poll', bulk_op_id: bulkOp.id };
    await markRunning(supabase, SOURCE_KEY, JSON.stringify(cursor), 0);
    EdgeRuntime.waitUntil(chainNext(FN_NAME, { mode: 'poll' }, 30));
    return json({ status: 'running', bulk_op_id: bulkOp.id, message: 'Bulk operation started; polling in 30s' });
  }

  // ── poll ───────────────────────────────────────────────────────────────────
  if (mode === 'poll') {
    const priorState = await getSyncState(supabase, SOURCE_KEY);
    let cursor: ImportCursor = { phase: 'poll' };
    try { cursor = JSON.parse(priorState?.last_cursor || '{}'); } catch { /* ok */ }

    const statusQuery = `{
      currentBulkOperation {
        id status errorCode objectCount fileSize url
      }
    }`;
    // deno-lint-ignore no-explicit-any
    const gqlRes = await shopifyGql(statusQuery) as any;
    const op = gqlRes?.data?.currentBulkOperation;

    console.log(`[history-import] Bulk op: ${op?.status}, objects: ${op?.objectCount}`);

    if (!op) {
      await markError(supabase, SOURCE_KEY, 'No current bulk operation found');
      return json({ status: 'error', error: 'No current bulk operation' });
    }
    if (op.status === 'FAILED') {
      await markError(supabase, SOURCE_KEY, `Bulk op failed: ${op.errorCode}`);
      return json({ status: 'error', error: `Bulk op failed: ${op.errorCode}` });
    }
    if (op.status !== 'COMPLETED') {
      await markRunning(supabase, SOURCE_KEY, JSON.stringify(cursor), 0);
      EdgeRuntime.waitUntil(chainNext(FN_NAME, { mode: 'poll' }, 30));
      return json({ status: 'running', op_status: op.status, objectCount: op.objectCount });
    }

    if (!op.url) {
      await markError(supabase, SOURCE_KEY, 'Bulk op completed but no download URL');
      return json({ status: 'error', error: 'No download URL' });
    }

    const importCursor: ImportCursor = {
      phase: 'import', jsonl_url: op.url,
      byte_offset: 0, orders_imported: 0,
      file_size: op.fileSize ? Number(op.fileSize) : undefined,
      pending: null,
    };
    await markRunning(supabase, SOURCE_KEY, JSON.stringify(importCursor), 0);
    EdgeRuntime.waitUntil(chainNext(FN_NAME, { mode: 'import' }, 1));
    return json({ status: 'running', message: 'Bulk op complete; starting JSONL import', objectCount: op.objectCount });
  }

  // ── import ─────────────────────────────────────────────────────────────────
  if (mode === 'import') {
    try {
    const priorState = await getSyncState(supabase, SOURCE_KEY);
    let cursor: ImportCursor = { phase: 'import' };
    try { cursor = JSON.parse(priorState?.last_cursor || '{}'); } catch { /* ok */ }

    if (!cursor.jsonl_url) {
      await markError(supabase, SOURCE_KEY, 'Missing JSONL URL in cursor');
      return json({ status: 'error', error: 'Missing JSONL URL' });
    }

    const byteOffset     = cursor.byte_offset     ?? 0;
    const ordersImported = cursor.orders_imported  ?? 0;
    const endByte        = byteOffset + CHUNK_BYTES - 1;

    const resp = await fetch(cursor.jsonl_url, {
      headers: { 'Range': `bytes=${byteOffset}-${endByte}` },
    });

    if (resp.status !== 206 && resp.status !== 200) {
      await markError(supabase, SOURCE_KEY, `JSONL fetch error: HTTP ${resp.status}`);
      return json({ status: 'error', error: `JSONL fetch ${resp.status}` });
    }

    const chunkText = await resp.text();

    // Determine if this is the last chunk from Content-Range total
    const contentRange = resp.headers.get('Content-Range') || '';
    const totalMatch   = contentRange.match(/\/(\d+)$/);
    const totalBytes   = totalMatch ? parseInt(totalMatch[1]) : null;

    // Split into lines; if chunk doesn't end with \n, last element is partial
    const lines = chunkText.split('\n');
    const maybeIncomplete = chunkText.endsWith('\n') ? '' : (lines.pop() || '');

    const rules = await loadClassificationRules(supabase);

    let pending: PendingOrder | null = cursor.pending ?? null;
    const batch: PendingOrder[] = [];
    let ordersThisChunk = 0;

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line) continue;

      let obj: Record<string, unknown>;
      try { obj = JSON.parse(line); } catch { continue; }

      if (!obj.__parentId) {
        // New order — flush previous pending order
        if (pending) {
          batch.push(pending);
          if (batch.length >= ORDER_BATCH) {
            ordersThisChunk += batch.length;
            await flushBatch(supabase, batch.splice(0), rules);
          }
        }
        pending = { order: obj as unknown as GqlOrder, lineItems: [], shippingLines: [] };
      } else if (pending) {
        const id = String(obj.id || '');
        if (id.includes('/LineItem/') || obj.sku !== undefined || obj.quantity !== undefined) {
          pending.lineItems.push(obj as unknown as GqlLineItem);
        } else {
          pending.shippingLines.push(obj as unknown as GqlShippingLine);
        }
      }
    }

    // Flush non-pending orders from this chunk
    if (batch.length) {
      ordersThisChunk += batch.length;
      await flushBatch(supabase, batch, rules);
    }

    // Compute byte offset of last complete line
    const consumedText  = chunkText.slice(0, chunkText.length - maybeIncomplete.length);
    const consumedBytes = new TextEncoder().encode(consumedText).length;
    const newOffset     = byteOffset + consumedBytes;
    const newTotal      = ordersImported + ordersThisChunk;

    // Last chunk: resp.status === 200 (Range not supported) or we've reached total
    const isLastChunk = resp.status === 200 ||
      (totalBytes !== null && newOffset >= totalBytes) ||
      consumedBytes === 0;

    if (isLastChunk) {
      // Flush the pending order that was still accumulating
      if (pending) await flushBatch(supabase, [pending], rules);
      await markComplete(supabase, SOURCE_KEY, newTotal + (pending ? 1 : 0));
      console.log(`[history-import] Complete. Total: ${newTotal + (pending ? 1 : 0)} orders imported.`);
      return json({ status: 'completed', orders_imported: newTotal + (pending ? 1 : 0) });
    }

    const newCursor: ImportCursor = {
      phase: 'import',
      jsonl_url:       cursor.jsonl_url,
      byte_offset:     newOffset,
      orders_imported: newTotal,
      file_size:       cursor.file_size,
      pending:         pending ?? null,
    };
    await markRunning(supabase, SOURCE_KEY, JSON.stringify(newCursor), ordersThisChunk);

    EdgeRuntime.waitUntil(chainNext(FN_NAME, { mode: 'import' }, 1));
    return json({ status: 'running', byte_offset: newOffset, orders_imported: newTotal });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[history-import] import phase unhandled error:', msg);
      await markError(supabase, SOURCE_KEY, `Import phase error: ${msg}`);
      return json({ status: 'error', error: msg }, 500);
    }
  }

  return json({ status: 'error', error: `Unknown mode: ${mode}` }, 400);
});
