import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * Reconcile stale local orders against Shopify.
 * Finds SalesOrder records stuck in 'paid_unfulfilled' and checks Shopify
 * for their actual status. Updates both SalesOrder and legacy ShopifyOrder.
 *
 * This is a separate function from bulkSyncOrders so it doesn't compete
 * for rate-limit budget during the main sync.
 */

const MAX_RUNTIME_MS = 55000;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function withRetry(fn, maxRetries = 3) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const msg = (err.message || '').toLowerCase();
      if ((msg.includes('rate limit') || err.status === 429) && attempt < maxRetries) {
        await sleep(2000 * attempt);
        continue;
      }
      throw err;
    }
  }
}

function deriveLifecycle(order) {
  if (order.cancelled_at) return 'cancelled';
  const fin = (order.financial_status || '').toLowerCase();
  if (fin === 'refunded') return 'refunded';
  const ful = (order.fulfillment_status || '');
  if (ful === 'fulfilled') return 'fulfilled';
  if (['paid', 'partially_refunded'].includes(fin)) return 'paid_unfulfilled';
  return 'pending_payment';
}

function mapFulfillmentStatus(ful) {
  if (!ful || ful === 'null') return 'unfulfilled';
  if (ful === 'fulfilled') return 'fulfilled';
  if (ful === 'partial') return 'partial';
  return 'unfulfilled';
}

function mapPaymentStatus(fin) {
  const map = { paid: 'paid', pending: 'pending', authorized: 'authorized', partially_paid: 'partially_paid', refunded: 'refunded', voided: 'voided', partially_refunded: 'partially_refunded' };
  return map[(fin || '').toLowerCase()] || 'pending';
}

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me();
  if (!user || user.role !== 'admin') {
    return Response.json({ error: 'Forbidden' }, { status: 403 });
  }

  const storeDomain = Deno.env.get('SHOPIFY_STORE_DOMAIN');
  const accessToken = Deno.env.get('SHOPIFY_ACCESS_TOKEN');
  if (!storeDomain || !accessToken) {
    return Response.json({ error: 'Shopify credentials not set' }, { status: 500 });
  }

  const body = await req.json().catch(() => ({}));
  const batchSize = body.batch_size || 50; // How many to check per run
  const startFrom = body.skip || 0;

  const runStart = Date.now();

  // Get local orders stuck as paid_unfulfilled
  const localUnfulfilled = await withRetry(() =>
    base44.asServiceRole.entities.SalesOrder.filter(
      { lifecycle_state: 'paid_unfulfilled' }, 'order_date', 500
    )
  );

  console.log(`[Reconcile] ${localUnfulfilled.length} local unfulfilled orders, starting from ${startFrom}, batch ${batchSize}`);

  if (localUnfulfilled.length === 0) {
    return Response.json({ reconciled: 0, checked: 0, remaining: 0, message: 'All orders up to date' });
  }

  // Process a batch
  const batch = localUnfulfilled.slice(startFrom, startFrom + batchSize);
  let reconciled = 0;
  let checked = 0;
  let errors = 0;

  for (const so of batch) {
    if (Date.now() - runStart > MAX_RUNTIME_MS) break;

    const sid = so.external_id || so.shopify_order_id;
    if (!sid) { checked++; continue; }

    // Query Shopify for the actual order status
    const orderUrl = `https://${storeDomain}/admin/api/2024-01/orders/${sid}.json?fields=id,name,financial_status,fulfillment_status,cancelled_at`;
    const res = await fetch(orderUrl, {
      headers: { 'X-Shopify-Access-Token': accessToken, 'Content-Type': 'application/json' },
    }).catch(() => null);

    if (!res) { errors++; checked++; continue; }

    if (res.status === 429) {
      // Wait and retry
      const retryAfter = parseFloat(res.headers.get('retry-after') || '2');
      await sleep(retryAfter * 1000);
      const retryRes = await fetch(orderUrl, {
        headers: { 'X-Shopify-Access-Token': accessToken, 'Content-Type': 'application/json' },
      }).catch(() => null);
      if (!retryRes || !retryRes.ok) { errors++; checked++; continue; }
      const { order: shopOrder } = await retryRes.json();
      if (shopOrder) {
        const updated = await updateIfChanged(base44, so, shopOrder, sid);
        if (updated) reconciled++;
      }
    } else if (res.ok) {
      const { order: shopOrder } = await res.json();
      if (shopOrder) {
        const updated = await updateIfChanged(base44, so, shopOrder, sid);
        if (updated) reconciled++;
      }
    } else if (res.status === 404) {
      // Order was deleted from Shopify — mark as cancelled
      await withRetry(() => base44.asServiceRole.entities.SalesOrder.update(so.id, {
        lifecycle_state: 'cancelled',
        last_synced_at: new Date().toISOString(),
      }));
      reconciled++;
    }

    checked++;
    await sleep(500); // Respect Shopify rate limits (2 calls/sec)
  }

  const remaining = localUnfulfilled.length - startFrom - checked;

  console.log(`[Reconcile] Done: ${reconciled} reconciled, ${checked} checked, ${remaining} remaining`);

  await base44.asServiceRole.entities.AuditLog.create({
    action: 'sync',
    entity_type: 'SalesOrder',
    description: `Order reconciliation: ${reconciled} updated out of ${checked} checked (${remaining} remaining)`,
  }).catch(() => {});

  return Response.json({ reconciled, checked, errors, remaining, total_unfulfilled: localUnfulfilled.length });
});

async function updateIfChanged(base44, so, shopOrder, sid) {
  const newLifecycle = deriveLifecycle(shopOrder);
  if (newLifecycle === 'paid_unfulfilled') return false; // No change

  const newFulfilment = mapFulfillmentStatus(shopOrder.fulfillment_status);
  const newPayment = mapPaymentStatus(shopOrder.financial_status);

  // Update SalesOrder
  await withRetry(() => base44.asServiceRole.entities.SalesOrder.update(so.id, {
    lifecycle_state: newLifecycle,
    fulfillment_status: newFulfilment,
    payment_status: newPayment,
    cancelled_at: shopOrder.cancelled_at || '',
    last_synced_at: new Date().toISOString(),
  }));

  // Update legacy ShopifyOrder
  const legacyOrders = await withRetry(() =>
    base44.asServiceRole.entities.ShopifyOrder.filter({ shopify_order_id: sid })
  );
  if (legacyOrders.length > 0) {
    const legacyFulfilment = !shopOrder.fulfillment_status ? 'unfulfilled'
      : shopOrder.fulfillment_status === 'fulfilled' ? 'fulfilled'
      : shopOrder.fulfillment_status === 'partial' ? 'partial' : 'unfulfilled';
    const legacyPaid = (shopOrder.financial_status || '').toLowerCase() === 'refunded' ? 'refunded'
      : (shopOrder.financial_status || '').toLowerCase() === 'paid' ? 'paid' : 'unpaid';
    await withRetry(() => base44.asServiceRole.entities.ShopifyOrder.update(legacyOrders[0].id, {
      fulfilment_status: legacyFulfilment,
      paid_status: legacyPaid,
      synced_at: new Date().toISOString(),
    }));
  }

  console.log(`[Reconcile] ${so.order_number}: ${so.lifecycle_state} → ${newLifecycle}`);
  return true;
}