import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * Reconcile stale local orders against Shopify (v2 — batch Shopify API).
 *
 * Instead of checking orders one-by-one (1 Shopify call each), this uses
 * the Shopify `?ids=` parameter to check up to 100 orders per API call.
 *
 * Flow:
 *  1. Load all local SalesOrders stuck in 'paid_unfulfilled'
 *  2. Batch-check their Shopify IDs (100 per call)
 *  3. Update any that have changed lifecycle
 */

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

async function fetchShopifyBatch(storeDomain, accessToken, ids) {
  const url = `https://${storeDomain}/admin/api/2024-01/orders.json?ids=${ids.join(',')}&status=any&fields=id,financial_status,fulfillment_status,cancelled_at&limit=250`;
  for (let attempt = 1; attempt <= 3; attempt++) {
    const res = await fetch(url, {
      headers: { 'X-Shopify-Access-Token': accessToken, 'Content-Type': 'application/json' },
    });
    if (res.status === 429) {
      const retryAfter = parseFloat(res.headers.get('retry-after') || '2');
      await sleep(retryAfter * 1000);
      continue;
    }
    if (!res.ok) {
      console.error(`[Reconcile] Shopify API ${res.status}`);
      return [];
    }
    const data = await res.json();
    return data.orders || [];
  }
  return [];
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

  // Load all local unfulfilled orders
  const localUnfulfilled = await withRetry(() =>
    base44.asServiceRole.entities.SalesOrder.filter(
      { lifecycle_state: 'paid_unfulfilled' }, 'order_date', 2000
    )
  );

  if (localUnfulfilled.length === 0) {
    return Response.json({ reconciled: 0, checked: 0, remaining: 0, message: 'All orders up to date' });
  }

  // Filter to those with valid Shopify IDs
  const ordersWithIds = localUnfulfilled.filter(o => o.external_id);
  console.log(`[Reconcile] ${ordersWithIds.length} paid_unfulfilled orders to check`);

  let reconciled = 0;
  let checked = 0;

  // Process in batches of 100 (Shopify ids= limit)
  for (let i = 0; i < ordersWithIds.length; i += 100) {
    const chunk = ordersWithIds.slice(i, i + 100);
    const ids = chunk.map(o => o.external_id);

    const shopifyOrders = await fetchShopifyBatch(storeDomain, accessToken, ids);
    const shopMap = {};
    for (const so of shopifyOrders) shopMap[String(so.id)] = so;

    for (const localOrder of chunk) {
      const shopOrder = shopMap[localOrder.external_id];

      if (!shopOrder) {
        // Not found — mark cancelled
        await withRetry(() => base44.asServiceRole.entities.SalesOrder.update(localOrder.id, {
          lifecycle_state: 'cancelled',
          last_synced_at: new Date().toISOString(),
        }));
        reconciled++;
        checked++;
        continue;
      }

      const newLifecycle = deriveLifecycle(shopOrder);
      if (newLifecycle !== 'paid_unfulfilled') {
        await withRetry(() => base44.asServiceRole.entities.SalesOrder.update(localOrder.id, {
          lifecycle_state: newLifecycle,
          fulfillment_status: mapFulfillmentStatus(shopOrder.fulfillment_status),
          payment_status: mapPaymentStatus(shopOrder.financial_status),
          cancelled_at: shopOrder.cancelled_at || '',
          last_synced_at: new Date().toISOString(),
        }));
        reconciled++;
      }
      checked++;
    }

    // Small pause between batches
    if (i + 100 < ordersWithIds.length) await sleep(500);
  }

  console.log(`[Reconcile] Done: ${reconciled} reconciled out of ${checked} checked`);

  await base44.asServiceRole.entities.AuditLog.create({
    action: 'sync', entity_type: 'SalesOrder',
    description: `Order reconciliation v2: ${reconciled} updated out of ${checked} checked`,
  }).catch(() => {});

  return Response.json({
    reconciled, checked, remaining: 0,
    total_unfulfilled: localUnfulfilled.length,
  });
});