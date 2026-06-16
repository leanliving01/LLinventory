// Shopify webhook receiver. Validates HMAC signature then upserts the order
// into shopify_orders + sales_orders using the same mapping as sync-shopify-orders.
import { getSupabase, corsHeaders, json } from '../_shared/shopify.ts';
import { upsertDraftReturnFromRefund, upsertDraftReturnFromReturn } from '../_shared/returns.ts';
import {
  loadClassificationRules, classifyLineItem, deriveOrderFinancialLines,
} from '../_shared/order-classification.ts';

const WEBHOOK_SECRET = Deno.env.get('SHOPIFY_WEBHOOK_SECRET') || '';

// Normalizes a Shopify returns/* webhook payload for upsertDraftReturnFromReturn.
// deno-lint-ignore no-explicit-any
function normalizeReturnWebhook(p: any) {
  const lineItems: any[] = p?.return_line_items || p?.returnLineItems || [];
  return {
    shopify_return_id: String(p?.id ?? ''),
    shopify_order_id: String(p?.order_id ?? p?.order?.id ?? ''),
    name: p?.name ?? null,
    status: p?.status ?? null,
    reason: p?.return_reason ?? null,
    created_at: p?.created_at ?? p?.requested_at ?? null,
    lines: lineItems.map((rli) => ({
      shopify_line_item_id: String(rli?.line_item_id ?? rli?.fulfillment_line_item?.line_item_id ?? rli?.fulfillmentLineItem?.lineItem?.id ?? ''),
      quantity: Number(rli?.quantity) || 0,
      value: null,
      reason: rli?.return_reason ?? rli?.return_reason_note ?? null,
    })),
  };
}

async function verifyHmac(rawBody: string, hmacHeader: string | null): Promise<boolean> {
  if (!hmacHeader || !WEBHOOK_SECRET) return false;
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(WEBHOOK_SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(rawBody));
  const computed = btoa(String.fromCharCode(...new Uint8Array(sig)));
  return computed === hmacHeader;
}

function mapPaidStatus(s: string | null): string {
  switch (s) {
    case 'paid': return 'paid';
    case 'pending': return 'unpaid';
    case 'partially_paid': return 'partially_paid';
    case 'refunded': return 'refunded';
    case 'partially_refunded': return 'partially_paid';
    default: return 'unpaid';
  }
}

function mapFulfilmentStatus(s: string | null): string {
  switch (s) {
    case 'fulfilled': return 'fulfilled';
    case 'partial': return 'partial';
    case 'restocked': return 'restocked';
    default: return 'unfulfilled';
  }
}

// sales_orders.payment_status / fulfillment_status CHECK-safe coercion (differs
// from the free-text shopify_orders columns).
const SALES_PAYMENT_ALLOWED = ['paid','pending','partially_paid','refunded','voided','authorized','partially_refunded'];
function mapSalesPaymentStatus(s: string | null): string {
  return s && SALES_PAYMENT_ALLOWED.includes(s) ? s : 'pending';
}
function mapSalesFulfilmentStatus(s: string | null): string {
  return s === 'fulfilled' ? 'fulfilled' : s === 'partial' ? 'partial' : 'unfulfilled';
}

function mapLifecycleState(financial: string | null, fulfilment: string | null): string {
  if (financial === 'refunded' || financial === 'voided') return 'refunded';
  if (financial === 'paid' || financial === 'partially_refunded') {
    return fulfilment === 'fulfilled' ? 'fulfilled' : 'paid_unfulfilled';
  }
  return 'pending_payment';
}

function detectLineType(title: string): string {
  const t = (title || '').toLowerCase();
  if (t.includes('low carb')) return 'low_carb_package';
  if (t.includes('lean muscle') || t.includes('weight loss') || t.includes('meals')) return 'goal_package';
  return 'standalone';
}

// Courier / tracking from the most recent (non-cancelled) fulfilment, when
// present. Only returns keys that have a value (never wipes existing data).
// deno-lint-ignore no-explicit-any
function fulfilmentFields(o: any): Record<string, unknown> {
  const f = (o?.fulfillments || []).filter((x: any) => x && x.status !== 'cancelled');
  if (!f.length) return {};
  const latest = f[f.length - 1];
  const out: Record<string, unknown> = {};
  if (latest.tracking_company) out.courier = latest.tracking_company;
  if (latest.tracking_number) out.tracking_number = latest.tracking_number;
  const url = latest.tracking_url || (Array.isArray(latest.tracking_urls) ? latest.tracking_urls[0] : null);
  if (url) out.tracking_url = url;
  return out;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders() });

  const rawBody = await req.text();
  const hmacHeader = req.headers.get('X-Shopify-Hmac-Sha256');
  const topic = req.headers.get('X-Shopify-Topic') || '';

  // Validate HMAC (skip in local dev if no secret configured)
  if (WEBHOOK_SECRET) {
    const valid = await verifyHmac(rawBody, hmacHeader);
    if (!valid) {
      return new Response('Unauthorized', { status: 401 });
    }
  }

  // Refund / native-return events → import as Draft Returns (no stock movement).
  if (topic.startsWith('refunds/') || topic.startsWith('returns/')) {
    let payload: Record<string, unknown>;
    try { payload = JSON.parse(rawBody); } catch { return new Response('bad json', { status: 400 }); }
    const supabase = getSupabase();
    try {
      if (topic.startsWith('refunds/')) {
        await upsertDraftReturnFromRefund(supabase, payload, (payload.order_id as number | string | undefined));
      } else {
        await upsertDraftReturnFromReturn(supabase, normalizeReturnWebhook(payload));
      }
    } catch (e) {
      console.error(`[webhook ${topic}] error:`, (e as Error).message);
    }
    await supabase.from('shopify_webhook_events').insert({
      id: crypto.randomUUID(),
      topic,
      shopify_order_id: String(payload.order_id ?? payload.id ?? ''),
      received_at: new Date().toISOString(),
      processed: true,
      created_date: new Date().toISOString(),
      updated_date: new Date().toISOString(),
    });
    return json({ status: 'ok', topic });
  }

  // Only process order events
  if (!topic.startsWith('orders/')) {
    return new Response('ignored', { status: 200 });
  }

  let o: Record<string, unknown>;
  try {
    o = JSON.parse(rawBody);
  } catch {
    return new Response('bad json', { status: 400 });
  }

  const supabase = getSupabase();
  const now = new Date().toISOString();

  const shopifyOrderId = String(o.id);
  const financialStatus = (o.financial_status as string) || null;
  const fulfillmentStatus = (o.fulfillment_status as string) || null;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const customer: Record<string, unknown> = (o.customer as any) || {};
  const customerName = [customer.first_name, customer.last_name].filter(Boolean).join(' ') || null;
  const lineItems: Array<Record<string, unknown>> = (o.line_items as Array<Record<string, unknown>>) || [];

  const orderPayload = {
    shopify_order_id: shopifyOrderId,
    order_number: String(o.order_number || o.name || o.id),
    customer_name: customerName,
    paid_status: mapPaidStatus(financialStatus),
    fulfilment_status: mapFulfilmentStatus(fulfillmentStatus),
    tags: (o.tags as string) || null,
    order_date: o.created_at as string,
    total_amount: parseFloat((o.total_price as string) || '0') || 0,
    synced_at: now,
    updated_date: now,
    demand_calculated: false,
  };

  // Upsert shopify_orders
  const { data: existingOrder } = await supabase
    .from('shopify_orders').select('id').eq('shopify_order_id', shopifyOrderId).maybeSingle();

  let ourOrderId: string;
  if (existingOrder) {
    ourOrderId = existingOrder.id as string;
    await supabase.from('shopify_orders').update(orderPayload).eq('id', ourOrderId);
  } else {
    ourOrderId = crypto.randomUUID();
    await supabase.from('shopify_orders').insert({ id: ourOrderId, ...orderPayload, created_date: now });
  }

  // Upsert sales_orders. Shopify cancellation overrides lifecycle state.
  const cancelledAt = (o.cancelled_at as string) || null;
  const lifecycleState = cancelledAt
    ? 'cancelled'
    : mapLifecycleState(financialStatus, fulfillmentStatus);
  const salesPayload = {
    shopify_order_id: shopifyOrderId,
    external_id: shopifyOrderId,
    order_number: String(o.order_number || o.name || o.id),
    customer_name: customerName,
    customer_email: (o.email || (customer.email as string)) || null,
    customer_phone: (customer.phone as string) || null,
    order_date: o.created_at as string,
    order_source: 'shopify',
    lifecycle_state: lifecycleState,
    cancelled_at: cancelledAt,
    payment_status: mapSalesPaymentStatus(financialStatus),
    fulfillment_status: mapSalesFulfilmentStatus(fulfillmentStatus),
    total_amount: parseFloat((o.total_price as string) || '0') || 0,
    subtotal_price: parseFloat((o.subtotal_price as string) || '0') || 0,
    total_tax: parseFloat((o.total_tax as string) || '0') || 0,
    total_discounts: parseFloat((o.total_discounts as string) || '0') || 0,
    shipping_cost: ((o.shipping_lines as Array<Record<string, unknown>>) || [])
      .reduce((s, sl) => s + (parseFloat((sl.price as string) || '0') || 0), 0),
    tags: o.tags ? (o.tags as string).replace(/,\s*/g, '|') : null,
    shipping_city: ((o.shipping_address as Record<string, unknown>)?.city as string) || null,
    updated_date: now,
    last_synced_at: now,
    raw_payload: o,
    ...fulfilmentFields(o),
  };

  const { data: existingSales } = await supabase
    .from('sales_orders').select('id, lifecycle_state, cancelled_at').eq('shopify_order_id', shopifyOrderId).maybeSingle();

  const isNewSalesOrder = !existingSales;
  const priorLifecycle = (existingSales?.lifecycle_state as string) || null;
  const priorCancelledAt = (existingSales?.cancelled_at as string) || null;
  let ourSalesId: string;
  if (existingSales) {
    ourSalesId = existingSales.id as string;
    await supabase.from('sales_orders').update(salesPayload).eq('id', ourSalesId);
  } else {
    ourSalesId = crypto.randomUUID();
    await supabase.from('sales_orders').insert({ id: ourSalesId, ...salesPayload, created_date: now });
  }

  // Snapshot existing lines BEFORE delete so we can log real edits (best-effort).
  const priorLines = new Map<string, number>();
  try {
    const { data: pl } = await supabase.from('sales_order_lines')
      .select('sku, qty').eq('sales_order_id', ourSalesId).eq('source_platform', 'shopify');
    for (const row of pl || []) {
      const sku = String(row.sku || '');
      priorLines.set(sku, (priorLines.get(sku) || 0) + Number(row.qty || 0)); // aggregate dup SKUs
    }
  } catch (e) {
    console.error('[webhook] prior-lines snapshot failed:', (e as Error).message);
  }

  // Replace line items
  await supabase.from('shopify_order_lines').delete().eq('shopify_order_id', ourOrderId);
  await supabase.from('sales_order_lines').delete()
    .eq('sales_order_id', ourSalesId)
    .eq('source_platform', 'shopify');
  // Replace synced order-level financial lines (manual lines preserved).
  await supabase.from('sales_order_financial_lines').delete()
    .eq('sales_order_id', ourSalesId)
    .eq('source', 'shopify');

  const orderNumber = String(o.order_number || o.name || o.id);
  const rules = await loadClassificationRules(supabase);
  const financialLines: Array<Record<string, unknown>> = [];
  const newLines = new Map<string, number>();
  let linesInsertOk = true;

  if (lineItems.length) {
    const orderLines = lineItems.map((l) => ({
      id: crypto.randomUUID(),
      shopify_order_id: ourOrderId,
      shopify_line_item_id: String(l.id),
      sku: (l.sku as string) || null,
      product_title: (l.title as string) || 'Untitled',
      variant_title: (l.variant_title as string) || null,
      quantity: (l.quantity as number) || 0,
      is_mapped: false,
      raw_payload: l,
      created_date: now,
      updated_date: now,
    }));

    // Only real product lines deduct stock; everything else → financial lines.
    const salesLines: Array<Record<string, unknown>> = [];
    for (const l of lineItems) {
      const { category, label, matchedRuleId } = classifyLineItem(l, rules);
      const unitPrice = parseFloat((l.price as string) || '0') || 0;
      const lineTotal = unitPrice * ((l.quantity as number) || 0);

      if (category === 'inventory_product') {
        const lineType = detectLineType((l.title as string) || '');
        const skuKey = (l.sku as string) || '';
        newLines.set(skuKey, (newLines.get(skuKey) || 0) + ((l.quantity as number) || 0));
        salesLines.push({
          id: crypto.randomUUID(),
          sales_order_id: ourSalesId,
          external_id: String(l.id),
          shopify_variant_id: l.variant_id ? String(l.variant_id) : null,
          sku: (l.sku as string) || '',
          name: (l.title as string) || 'Untitled',
          variant_title: (l.variant_title as string) || null,
          qty: (l.quantity as number) || 0,
          unit_price: unitPrice,
          line_total: lineTotal,
          is_package_parent: lineType !== 'standalone',
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
      } else {
        const sign = (category === 'discount' || category === 'voucher'
          || category === 'store_credit' || category === 'refund') ? -1 : 1;
        financialLines.push({
          id: crypto.randomUUID(),
          sales_order_id: ourSalesId,
          shopify_order_id: shopifyOrderId,
          order_number: orderNumber,
          category,
          label: label || ((l.title as string) || 'Untitled'),
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

    await supabase.from('shopify_order_lines').insert(orderLines);
    if (salesLines.length) {
      const { error: solErr } = await supabase.from('sales_order_lines').insert(salesLines);
      if (solErr) {
        console.error('[webhook] sales_order_lines insert failed:', solErr.message);
        linesInsertOk = false;
      }
    }
  }

  // Order-level financial lines from structural fields (shipping/discount/tip/refund).
  // deno-lint-ignore no-explicit-any
  for (const d of deriveOrderFinancialLines(o as any, rules)) {
    financialLines.push({
      id: crypto.randomUUID(),
      sales_order_id: ourSalesId,
      shopify_order_id: shopifyOrderId,
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
  if (financialLines.length) {
    const { error: flErr } = await supabase.from('sales_order_financial_lines').insert(financialLines);
    if (flErr) console.error('sales_order_financial_lines insert error:', flErr.message);
  }

  // Deduct physical stock the moment an order becomes fulfilled. Runs after the
  // line items above are written (the RPC reads sales_order_lines). Idempotent via
  // the sticky stock_deducted flag + stock_movements.reference_key, so it is safe
  // even though the 15-min cron also sweeps fulfilled orders.
  // Guard: skip if the lines insert failed — the cron sweep will retry once lines
  // are correctly synced.
  if (lifecycleState === 'fulfilled' && linesInsertOk) {
    const { error: deductErr } = await supabase.rpc('deduct_fulfilled_stock', { p_order_id: ourSalesId, p_limit: 1 });
    if (deductErr) console.error('deduct_fulfilled_stock error:', deductErr.message);
  }

  // Sales-order audit timeline events (best-effort; never break the webhook).
  try {
    const events: Record<string, unknown>[] = [];
    const base = {
      sales_order_id: ourSalesId, shopify_order_id: shopifyOrderId,
      order_number: orderNumber, actor: 'shopify-webhook',
      created_date: now, updated_date: now,
    };
    if (isNewSalesOrder) {
      events.push({ id: crypto.randomUUID(), ...base, event_type: 'imported',
        description: `Imported from Shopify (${topic})`,
        metadata: { topic, financial_status: financialStatus, fulfillment_status: fulfillmentStatus } });
    } else {
      const added: string[] = [], removed: string[] = [], changed: string[] = [];
      for (const [sku, q] of newLines) {
        if (!priorLines.has(sku)) added.push(`${sku} x${q}`);
        else if (priorLines.get(sku) !== q) changed.push(`${sku}: ${priorLines.get(sku)}→${q}`);
      }
      for (const [sku, q] of priorLines) if (!newLines.has(sku)) removed.push(`${sku} x${q}`);
      if (added.length || removed.length || changed.length) {
        events.push({ id: crypto.randomUUID(), ...base, event_type: 'edited',
          description: 'Order lines updated from Shopify', metadata: { added, removed, changed } });
      }
    }
    // Only log cancellation / fulfilment on the actual transition (not on every
    // webhook replay of an order already in that state).
    if (cancelledAt && !priorCancelledAt) {
      events.push({ id: crypto.randomUUID(), ...base, event_type: 'cancelled',
        description: 'Order cancelled in Shopify', metadata: { cancelled_at: cancelledAt } });
    }
    if (lifecycleState === 'fulfilled' && priorLifecycle !== 'fulfilled') {
      events.push({ id: crypto.randomUUID(), ...base, event_type: 'fulfilled',
        description: 'Order fulfilled (stock deducted)', metadata: { topic } });
    }
    if (events.length) await supabase.from('sales_order_events').insert(events);
  } catch (e) {
    console.error('[webhook] audit events failed:', (e as Error).message);
  }

  // Store raw event for audit
  await supabase.from('shopify_webhook_events').insert({
    id: crypto.randomUUID(),
    topic,
    shopify_order_id: shopifyOrderId,
    received_at: now,
    processed: true,
    created_date: now,
    updated_date: now,
  });

  return json({ status: 'ok', shopify_order_id: shopifyOrderId, topic });
});
