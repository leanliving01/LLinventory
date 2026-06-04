// Shopify webhook receiver. Validates HMAC signature then upserts the order
// into shopify_orders + sales_orders using the same mapping as sync-shopify-orders.
import { getSupabase, corsHeaders, json } from '../_shared/shopify.ts';

const WEBHOOK_SECRET = Deno.env.get('SHOPIFY_WEBHOOK_SECRET') || '';

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

  // Upsert sales_orders
  const lifecycleState = mapLifecycleState(financialStatus, fulfillmentStatus);
  const salesPayload = {
    shopify_order_id: shopifyOrderId,
    external_id: shopifyOrderId,
    order_number: String(o.order_number || o.name || o.id),
    customer_name: customerName,
    customer_email: (o.email || (customer.email as string)) || null,
    customer_phone: (customer.phone as string) || null,
    order_date: o.created_at as string,
    lifecycle_state: lifecycleState,
    total_amount: parseFloat((o.total_price as string) || '0') || 0,
    tags: o.tags ? (o.tags as string).replace(/,\s*/g, '|') : null,
    shipping_city: ((o.shipping_address as Record<string, unknown>)?.city as string) || null,
    updated_date: now,
    last_synced_at: now,
  };

  const { data: existingSales } = await supabase
    .from('sales_orders').select('id').eq('shopify_order_id', shopifyOrderId).maybeSingle();

  let ourSalesId: string;
  if (existingSales) {
    ourSalesId = existingSales.id as string;
    await supabase.from('sales_orders').update(salesPayload).eq('id', ourSalesId);
  } else {
    ourSalesId = crypto.randomUUID();
    await supabase.from('sales_orders').insert({ id: ourSalesId, ...salesPayload, created_date: now });
  }

  // Replace line items
  await supabase.from('shopify_order_lines').delete().eq('shopify_order_id', ourOrderId);
  await supabase.from('sales_order_lines').delete()
    .eq('sales_order_id', ourSalesId)
    .eq('source_platform', 'shopify');

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

    const salesLines = lineItems.map((l) => {
      const lineType = detectLineType((l.title as string) || '');
      const unitPrice = parseFloat((l.price as string) || '0') || 0;
      return {
        id: crypto.randomUUID(),
        sales_order_id: ourSalesId,
        external_id: String(l.id),
        shopify_variant_id: l.variant_id ? String(l.variant_id) : null,
        sku: (l.sku as string) || '',
        name: (l.title as string) || 'Untitled',
        variant_title: (l.variant_title as string) || null,
        qty: (l.quantity as number) || 0,
        unit_price: unitPrice,
        line_total: unitPrice * ((l.quantity as number) || 0),
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
      };
    });

    await supabase.from('shopify_order_lines').insert(orderLines);
    await supabase.from('sales_order_lines').insert(salesLines);
  }

  // Deduct physical stock the moment an order becomes fulfilled. Runs after the
  // line items above are written (the RPC reads sales_order_lines). Idempotent via
  // the sticky stock_deducted flag + stock_movements.reference_key, so it is safe
  // even though the 15-min cron also sweeps fulfilled orders.
  if (lifecycleState === 'fulfilled') {
    const { error: deductErr } = await supabase.rpc('deduct_fulfilled_stock', { p_order_id: ourSalesId });
    if (deductErr) console.error('deduct_fulfilled_stock error:', deductErr.message);
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
