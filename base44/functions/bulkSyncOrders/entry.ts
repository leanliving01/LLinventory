import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * Bulk sync orders from Shopify.
 * v3 — Minimal API calls: only updates headers for existing orders,
 * only creates lines for NEW orders. Fully sequential to avoid rate limits.
 */

const SYNC_KEY = 'shopify_orders';
const PAGE_SIZE = 250;
const API_DELAY = 120; // ms between Base44 API calls

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function withRetry(fn, maxRetries = 5) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const msg = (err.message || '').toLowerCase();
      if (msg.includes('rate limit') && attempt < maxRetries) {
        const backoff = Math.min(4000 * attempt, 20000);
        console.log(`[BulkSync] Rate limited, backoff ${backoff}ms (attempt ${attempt}/${maxRetries})`);
        await sleep(backoff);
        continue;
      }
      throw err;
    }
  }
}

/** Throttled Base44 API call — enforces minimum delay between calls */
let lastApiCall = 0;
async function throttledCall(fn) {
  const now = Date.now();
  const elapsed = now - lastApiCall;
  if (elapsed < API_DELAY) await sleep(API_DELAY - elapsed);
  lastApiCall = Date.now();
  return await withRetry(fn);
}

// ─── Lifecycle derivation ───
function deriveLifecycle(order) {
  if (order.cancelled_at) return 'cancelled';
  const fin = (order.financial_status || '').toLowerCase();
  if (fin === 'refunded') return 'refunded';
  const ful = (order.fulfillment_status || '');
  if (ful === 'fulfilled') return 'fulfilled';
  if (['paid', 'partially_refunded'].includes(fin)) return 'paid_unfulfilled';
  return 'pending_payment';
}

function mapPaymentStatus(fin) {
  const map = { paid: 'paid', pending: 'pending', authorized: 'authorized', partially_paid: 'partially_paid', refunded: 'refunded', voided: 'voided', partially_refunded: 'partially_refunded' };
  return map[(fin || '').toLowerCase()] || 'pending';
}

function mapFulfillmentStatus(ful) {
  if (!ful || ful === 'null') return 'unfulfilled';
  if (ful === 'fulfilled') return 'fulfilled';
  if (ful === 'partial') return 'partial';
  return 'unfulfilled';
}

function isExcluded(li) {
  const t = (li.title || '').toLowerCase();
  const s = (li.sku || '').toLowerCase();
  if (t.includes('90-day reset') || t.includes('90 day reset')) return true;
  if (s === 'l90c2') return true;
  if (t.includes('dry ice') || t.includes('cooler box') || t.includes('delivery')) return true;
  if (!s) return true;
  return false;
}

function classifyLine(li, packBomIndex, orderTags) {
  const sku = li.sku || '';
  const title = (li.title || '').toLowerCase();
  const tags = (orderTags || '').toLowerCase().split(',').map(t => t.trim());
  if (packBomIndex[sku]) {
    const pb = packBomIndex[sku];
    if (pb.package_type === 'goal_based') return 'goal_package';
    if (pb.package_type === 'low_carb') return 'low_carb_package';
    if (pb.package_type === 'bundle') return 'bundle';
  }
  if (title.includes('build your own') || title.includes('byo') || tags.includes('byo meals') || tags.includes('byo')) return 'byo';
  if (sku) return 'standalone';
  return 'unknown';
}

/** Create a simple hash of the line-items to detect if decomposition changed */
function lineHash(order, packBomIndex) {
  const parts = [];
  for (const li of (order.line_items || [])) {
    if (isExcluded(li)) continue;
    parts.push(`${li.sku || ''}:${li.quantity || 1}:${li.id}`);
  }
  // Include active pack bom disabled/override state
  for (const li of (order.line_items || [])) {
    const sku = li.sku || '';
    if (packBomIndex[sku]) {
      const pb = packBomIndex[sku];
      parts.push(`pb:${sku}:${(pb.disabled_skus || []).sort().join(',')}:${pb.sku_overrides || '{}'}`);
    }
  }
  // Simple string hash
  const str = parts.join('|');
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
  }
  return String(hash);
}

function buildSalesOrder(order) {
  const addr = order.shipping_address || order.billing_address || {};
  return {
    shopify_order_id: String(order.id),
    external_id: String(order.id),
    order_number: order.name || `#${order.order_number}`,
    customer_name: order.customer ? `${order.customer.first_name || ''} ${order.customer.last_name || ''}`.trim() : '',
    customer_email: order.customer?.email || order.email || '',
    customer_phone: order.customer?.phone || addr.phone || '',
    customer_external_id: order.customer?.id ? String(order.customer.id) : '',
    customer_address: [addr.address1, addr.address2].filter(Boolean).join(', '),
    shipping_city: addr.city || '',
    shipping_province: addr.province || '',
    shipping_zip: addr.zip || '',
    shipping_country: addr.country_code || '',
    lifecycle_state: deriveLifecycle(order),
    payment_status: mapPaymentStatus(order.financial_status),
    fulfillment_status: mapFulfillmentStatus(order.fulfillment_status),
    order_date: order.created_at,
    total_amount: parseFloat(order.total_price || 0),
    subtotal_price: parseFloat(order.subtotal_price || 0),
    total_tax: parseFloat(order.total_tax || 0),
    total_discounts: parseFloat(order.total_discounts || 0),
    currency: order.currency || 'ZAR',
    cancelled_at: order.cancelled_at || '',
    closed_at: order.closed_at || '',
    tags: (order.tags || '').replace(/,/g, '|'),
    source_platform: 'shopify',
    last_synced_at: new Date().toISOString(),
    raw_payload: JSON.stringify(order).slice(0, 15000),
  };
}

function decomposeLines(order, packBomIndex) {
  const parentLines = [];
  const componentLines = [];
  let hasUnresolved = false;
  let decompositionStatus = 'complete';

  for (const li of (order.line_items || [])) {
    if (isExcluded(li)) continue;
    const sku = li.sku || '';
    const lineType = classifyLine(li, packBomIndex, order.tags);
    const lineExternalId = String(li.id);
    const qty = li.quantity || 1;

    const parentLine = {
      external_id: lineExternalId,
      shopify_variant_id: li.variant_id ? String(li.variant_id) : '',
      sku, name: li.title || '', variant_title: li.variant_title || '', qty,
      unit_price: parseFloat(li.price || 0),
      line_total: parseFloat(li.price || 0) * qty,
      line_type: lineType, source_platform: 'shopify',
      last_synced_at: new Date().toISOString(),
      raw_payload: JSON.stringify(li).slice(0, 5000),
      status: 'active', is_package_parent: false, is_package_component: false,
    };

    if (['goal_package', 'low_carb_package'].includes(lineType) && packBomIndex[sku]) {
      const pb = packBomIndex[sku];
      parentLine.is_package_parent = true;
      parentLine.portion_weight_g = pb.portion_weight_g;
      parentLines.push(parentLine);
      const disabledSet = new Set(pb.disabled_skus || []);
      let skuOverrides = {};
      try { skuOverrides = JSON.parse(pb.sku_overrides || '{}'); } catch {}
      for (const compSku of pb.component_skus) {
        if (disabledSet.has(compSku)) continue;
        const skuMult = skuOverrides[compSku] || pb.multiplier;
        componentLines.push({
          external_id: `${lineExternalId}_${compSku}`, sku: compSku, name: compSku,
          qty: skuMult * qty, unit_price: 0, line_total: 0, line_type: 'standalone',
          is_package_parent: false, is_package_component: true,
          parent_line_external_id: lineExternalId,
          portion_weight_g: pb.portion_weight_g, status: 'active',
          source_platform: 'shopify', last_synced_at: new Date().toISOString(),
        });
      }
    } else if (lineType === 'byo') {
      parentLine.portion_weight_g = 300;
      parentLines.push(parentLine);
    } else if (lineType === 'unknown') {
      parentLine.status = 'unresolved_sku';
      hasUnresolved = true;
      decompositionStatus = 'partial';
      parentLines.push(parentLine);
    } else {
      parentLines.push(parentLine);
    }
  }
  return { parentLines, componentLines, hasUnresolved, decompositionStatus };
}

/**
 * Process a single order.
 * For EXISTING orders: only update the header (1 API call).
 * For NEW orders: create header + lines.
 * Returns 'created' | 'updated' | 'skipped'
 */
async function processOrder(base44, order, packBomIndex) {
  const orderId = String(order.id);
  const hash = lineHash(order, packBomIndex);

  const existingOrders = await throttledCall(() =>
    base44.asServiceRole.entities.SalesOrder.filter({ external_id: orderId })
  );

  const soData = buildSalesOrder(order);
  const { parentLines, componentLines, hasUnresolved, decompositionStatus } = decomposeLines(order, packBomIndex);
  soData.has_unresolved_skus = hasUnresolved;
  soData.decomposition_status = decompositionStatus;
  soData.data_hash = hash;

  if (existingOrders.length > 0) {
    // ─── EXISTING ORDER: just update header ───
    const existing = existingOrders[0];
    const { shopify_order_id, external_id, ...updateData } = soData;

    // Skip entirely if nothing meaningful changed
    const headerChanged = existing.lifecycle_state !== updateData.lifecycle_state ||
      existing.payment_status !== updateData.payment_status ||
      existing.fulfillment_status !== updateData.fulfillment_status ||
      existing.total_amount !== updateData.total_amount ||
      existing.data_hash !== hash;

    if (!headerChanged) return 'skipped';

    await throttledCall(() =>
      base44.asServiceRole.entities.SalesOrder.update(existing.id, updateData)
    );

    // Only rebuild lines if the line composition actually changed
    if (existing.data_hash !== hash) {
      await rebuildLines(base44, existing.id, parentLines, componentLines);
    }

    return 'updated';
  } else {
    // ─── NEW ORDER: create header + all lines ───
    const created = await throttledCall(() =>
      base44.asServiceRole.entities.SalesOrder.create(soData)
    );
    await createLines(base44, created.id, parentLines, componentLines);
    return 'created';
  }
}

/** Delete all existing lines then create new ones — fully sequential */
async function rebuildLines(base44, salesOrderId, parentLines, componentLines) {
  // Delete existing lines one by one
  const existingLines = await throttledCall(() =>
    base44.asServiceRole.entities.SalesOrderLine.filter({ sales_order_id: salesOrderId })
  );
  for (const el of existingLines) {
    await throttledCall(() =>
      base44.asServiceRole.entities.SalesOrderLine.delete(el.id)
    );
  }
  await createLines(base44, salesOrderId, parentLines, componentLines);
}

/** Create parent + component lines — fully sequential, using bulkCreate for components */
async function createLines(base44, salesOrderId, parentLines, componentLines) {
  const parentIdMap = {};
  for (const pl of parentLines) {
    const created = await throttledCall(() =>
      base44.asServiceRole.entities.SalesOrderLine.create({ ...pl, sales_order_id: salesOrderId })
    );
    parentIdMap[pl.external_id] = created.id;
  }

  if (componentLines.length > 0) {
    const BULK_SIZE = 15;
    for (let i = 0; i < componentLines.length; i += BULK_SIZE) {
      const batch = componentLines.slice(i, i + BULK_SIZE).map(cl => {
        const parentB44Id = parentIdMap[cl.parent_line_external_id] || '';
        const { parent_line_external_id, ...lineData } = cl;
        return { ...lineData, sales_order_id: salesOrderId, parent_line_id: parentB44Id };
      });
      await throttledCall(() =>
        base44.asServiceRole.entities.SalesOrderLine.bulkCreate(batch)
      );
    }
  }
}

async function fetchShopifyPage(url, accessToken) {
  const MAX_RETRIES = 3;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const res = await fetch(url, {
      headers: { 'X-Shopify-Access-Token': accessToken, 'Content-Type': 'application/json' },
    });
    if (res.status === 429) {
      const retryAfter = parseFloat(res.headers.get('retry-after') || '2');
      await new Promise(r => setTimeout(r, retryAfter * 1000));
      continue;
    }
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Shopify API ${res.status}: ${errText.slice(0, 500)}`);
    }
    const data = await res.json();
    const linkHeader = res.headers.get('link') || '';
    const nextMatch = linkHeader.match(/<([^>]+)>;\s*rel="next"/);
    return { items: data.orders || [], nextUrl: nextMatch ? nextMatch[1] : '' };
  }
  throw new Error('Shopify rate limit exceeded after retries');
}

async function getSyncState(base44) {
  const existing = await base44.asServiceRole.entities.SyncState.filter({ source_key: SYNC_KEY });
  if (existing.length > 0) return existing[0];
  return await base44.asServiceRole.entities.SyncState.create({
    source_key: SYNC_KEY, sync_status: 'idle', records_synced: 0, records_failed: 0,
  });
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
  const forceRedecompose = body.force_redecompose === true;

  const syncState = await getSyncState(base44);

  // If stuck in running for > 5 minutes, force reset
  if (syncState.sync_status === 'running') {
    const lastSync = syncState.last_sync_at ? new Date(syncState.last_sync_at) : new Date(0);
    const minutesStale = (Date.now() - lastSync.getTime()) / 60000;
    if (minutesStale < 5) {
      return Response.json({ ok: true, status: 'already_running' });
    }
    console.log(`[BulkSync] Stale running state (${Math.round(minutesStale)}m), resetting`);
  }

  // Mark as running
  await base44.asServiceRole.entities.SyncState.update(syncState.id, {
    sync_status: 'running', records_synced: 0, records_failed: 0,
    error_message: 'Starting...', last_cursor: null,
    last_sync_at: new Date().toISOString(),
  });

  // Load PackBom index
  const packBoms = await base44.asServiceRole.entities.PackBom.filter({ active: true });
  const packBomIndex = {};
  for (const pb of packBoms) packBomIndex[pb.package_sku] = pb;
  console.log(`[BulkSync] Loaded ${packBoms.length} active PackBoms`);

  const startUrl = `https://${storeDomain}/admin/api/2024-01/orders.json?status=open&limit=${PAGE_SIZE}`;
  let currentUrl = startUrl;
  let created = 0, updated = 0, skipped = 0, failed = 0, totalProcessed = 0, pageNum = 0;

  try {
    while (currentUrl) {
      pageNum++;
      const { items: orders, nextUrl } = await fetchShopifyPage(currentUrl, accessToken);
      console.log(`[BulkSync] Page ${pageNum}: fetched ${orders.length} orders from Shopify`);

      for (let oi = 0; oi < orders.length; oi++) {
        const order = orders[oi];
        try {
          const action = await processOrder(base44, order, packBomIndex);
          if (action === 'created') created++;
          else if (action === 'updated') updated++;
          else skipped++;
        } catch (err) {
          console.error(`[BulkSync] Error on ${order.name || order.id}: ${err.message}`);
          failed++;
        }
        totalProcessed++;

        // Update progress every 10 orders
        if (totalProcessed % 10 === 0) {
          await throttledCall(() => base44.asServiceRole.entities.SyncState.update(syncState.id, {
            records_synced: totalProcessed,
            records_failed: failed,
            error_message: `Page ${pageNum}: ${created}c ${updated}u ${skipped}s ${failed}e`,
            last_sync_at: new Date().toISOString(),
          }));
        }
      }

      console.log(`[BulkSync] Page ${pageNum} done. Total: ${totalProcessed} (${created}c ${updated}u ${skipped}s ${failed}e)`);

      currentUrl = nextUrl || '';
      if (currentUrl) await sleep(500);
    }

    // Done — mark complete
    await withRetry(() => base44.asServiceRole.entities.SyncState.update(syncState.id, {
      sync_status: 'idle',
      records_synced: totalProcessed,
      records_failed: failed,
      error_message: '',
      last_cursor: null,
      last_sync_at: new Date().toISOString(),
    }));

    console.log(`[BulkSync] Complete: ${totalProcessed} processed (${created}c ${updated}u ${skipped}s ${failed}e)`);

    await base44.asServiceRole.entities.AuditLog.create({
      action: 'sync', entity_type: 'SalesOrder',
      description: `Bulk sync: ${created} new, ${updated} updated, ${skipped} skipped, ${failed} failed (${totalProcessed} total)`,
    }).catch(() => {});

    // ── Auto-reconcile after successful sync ──
    console.log('[BulkSync] Triggering auto-reconciliation...');
    let totalReconciled = 0, totalChecked = 0, remaining = 999, reconSkip = 0;
    const RECON_BATCH = 80;
    while (remaining > 0) {
      try {
        const reconRes = await base44.functions.invoke('reconcileOrders', { batch_size: RECON_BATCH, skip: reconSkip });
        const rd = reconRes.data || {};
        totalReconciled += rd.reconciled || 0;
        totalChecked += rd.checked || 0;
        remaining = rd.remaining || 0;
        reconSkip += rd.checked || RECON_BATCH;
        if ((rd.checked || 0) === 0) break;
      } catch (reconErr) {
        console.error(`[BulkSync] Reconciliation error: ${reconErr.message}`);
        break;
      }
    }
    if (totalChecked > 0) {
      console.log(`[BulkSync] Reconciliation: ${totalReconciled} updated out of ${totalChecked} checked`);
    }

    return Response.json({ ok: true, status: 'completed', created, updated, skipped, failed, total: totalProcessed, reconciled: totalReconciled });

  } catch (err) {
    console.error(`[BulkSync FATAL] ${err.message}`);
    await base44.asServiceRole.entities.SyncState.update(syncState.id, {
      sync_status: 'idle',
      error_message: `Error: ${err.message}`,
      last_sync_at: new Date().toISOString(),
    }).catch(() => {});
    return Response.json({ ok: false, status: 'error', error: err.message }, { status: 500 });
  }
});