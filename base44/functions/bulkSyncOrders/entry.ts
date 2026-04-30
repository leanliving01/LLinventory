import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * Bulk sync orders from Shopify → SalesOrder + SalesOrderLine.
 *
 * Architecture (v4 — bulk-first):
 *  1. Paginate ALL open orders from Shopify (250/page, ~2-3 API calls)
 *  2. Load ALL existing SalesOrders in ONE call → build lookup map
 *  3. Classify: new → bulkCreate headers. Changed → update header only. Unchanged → skip.
 *  4. For NEW orders only: create lines (parent + component decomposition).
 *  5. Reconcile: any local paid_unfulfilled order NOT in Shopify's open set → batch-check via ids= param.
 *
 * This keeps Shopify API calls to ~5 total and Base44 calls proportional to actual changes.
 */

const SYNC_KEY = 'shopify_orders';
const SHOPIFY_PAGE_SIZE = 250;
const BULK_CREATE_SIZE = 25;
const COMPONENT_BULK_SIZE = 20;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function withRetry(fn, maxRetries = 4) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const msg = (err.message || '').toLowerCase();
      if ((msg.includes('rate limit') || err.status === 429) && attempt < maxRetries) {
        const backoff = Math.min(3000 * attempt, 15000);
        console.log(`[BulkSync] Rate limited, backoff ${backoff}ms (attempt ${attempt})`);
        await sleep(backoff);
        continue;
      }
      throw err;
    }
  }
}

// ─── Lifecycle derivation (always re-derive from Shopify fields) ───
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

// ─── Build SalesOrder header from Shopify payload ───
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

// ─── Decompose order lines using PackBom ───
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

// ─── Fetch all Shopify pages ───
async function fetchAllShopifyOrders(storeDomain, accessToken) {
  const allOrders = [];
  let url = `https://${storeDomain}/admin/api/2024-01/orders.json?status=open&limit=${SHOPIFY_PAGE_SIZE}`;
  let page = 0;

  while (url) {
    page++;
    for (let attempt = 1; attempt <= 3; attempt++) {
      const res = await fetch(url, {
        headers: { 'X-Shopify-Access-Token': accessToken, 'Content-Type': 'application/json' },
      });
      if (res.status === 429) {
        const retryAfter = parseFloat(res.headers.get('retry-after') || '2');
        console.log(`[BulkSync] Shopify rate limited on page ${page}, waiting ${retryAfter}s`);
        await sleep(retryAfter * 1000);
        continue;
      }
      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`Shopify API ${res.status}: ${errText.slice(0, 300)}`);
      }
      const data = await res.json();
      allOrders.push(...(data.orders || []));
      console.log(`[BulkSync] Page ${page}: ${(data.orders || []).length} orders (total: ${allOrders.length})`);

      const linkHeader = res.headers.get('link') || '';
      const nextMatch = linkHeader.match(/<([^>]+)>;\s*rel="next"/);
      url = nextMatch ? nextMatch[1] : '';
      break;
    }
    if (url) await sleep(500); // Small pause between pages
  }

  return allOrders;
}

// ─── Create lines for a single new order (parent + components) ───
async function createLinesForOrder(base44, salesOrderId, parentLines, componentLines) {
  // Create parent lines one by one (need their IDs for component linking)
  const parentIdMap = {};
  for (const pl of parentLines) {
    const created = await withRetry(() =>
      base44.asServiceRole.entities.SalesOrderLine.create({ ...pl, sales_order_id: salesOrderId })
    );
    parentIdMap[pl.external_id] = created.id;
  }

  // Bulk create component lines
  if (componentLines.length > 0) {
    for (let i = 0; i < componentLines.length; i += COMPONENT_BULK_SIZE) {
      const batch = componentLines.slice(i, i + COMPONENT_BULK_SIZE).map(cl => {
        const parentB44Id = parentIdMap[cl.parent_line_external_id] || '';
        const { parent_line_external_id, ...lineData } = cl;
        return { ...lineData, sales_order_id: salesOrderId, parent_line_id: parentB44Id };
      });
      await withRetry(() => base44.asServiceRole.entities.SalesOrderLine.bulkCreate(batch));
    }
  }
}

// ─── Get or create SyncState record ───
async function getSyncState(base44) {
  const existing = await base44.asServiceRole.entities.SyncState.filter({ source_key: SYNC_KEY });
  if (existing.length > 0) return existing[0];
  return await base44.asServiceRole.entities.SyncState.create({
    source_key: SYNC_KEY, sync_status: 'idle', records_synced: 0, records_failed: 0,
  });
}

// ─── Check if header fields meaningfully changed ───
function headerChanged(existing, newData) {
  return existing.lifecycle_state !== newData.lifecycle_state ||
    existing.payment_status !== newData.payment_status ||
    existing.fulfillment_status !== newData.fulfillment_status ||
    Math.abs((existing.total_amount || 0) - (newData.total_amount || 0)) > 0.01;
}

// ═══════════════════════════════════════════════
// MAIN HANDLER
// ═══════════════════════════════════════════════
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

  const syncState = await getSyncState(base44);

  // Guard: don't run if already running (unless stale > 5 min)
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
    error_message: 'Fetching Shopify orders...', last_cursor: null,
    last_sync_at: new Date().toISOString(),
  });

  try {
    // ═══ STEP 1: Fetch ALL open orders from Shopify (2-3 API calls) ═══
    const shopifyOrders = await fetchAllShopifyOrders(storeDomain, accessToken);
    console.log(`[BulkSync] Fetched ${shopifyOrders.length} open orders from Shopify`);

    await base44.asServiceRole.entities.SyncState.update(syncState.id, {
      error_message: `Fetched ${shopifyOrders.length} orders, loading local data...`,
    });

    // ═══ STEP 2: Load ALL existing SalesOrders in ONE call ═══
    const existingOrders = await withRetry(() =>
      base44.asServiceRole.entities.SalesOrder.filter({}, '-order_date', 5000)
    );
    const existingMap = {};
    for (const eo of existingOrders) {
      if (eo.external_id) existingMap[eo.external_id] = eo;
    }
    console.log(`[BulkSync] Loaded ${existingOrders.length} existing SalesOrders`);

    // ═══ STEP 3: Load PackBom index ═══
    const packBoms = await withRetry(() =>
      base44.asServiceRole.entities.PackBom.filter({ active: true })
    );
    const packBomIndex = {};
    for (const pb of packBoms) packBomIndex[pb.package_sku] = pb;
    console.log(`[BulkSync] Loaded ${packBoms.length} active PackBoms`);

    await base44.asServiceRole.entities.SyncState.update(syncState.id, {
      error_message: `Processing ${shopifyOrders.length} orders...`,
    });

    // ═══ STEP 4: Classify orders ═══
    const newOrders = [];      // Not in local DB yet
    const changedOrders = [];  // In DB but header differs
    let skipped = 0;
    let failed = 0;
    const shopifyIdsSeen = new Set();

    for (const order of shopifyOrders) {
      const eid = String(order.id);
      shopifyIdsSeen.add(eid);
      const soData = buildSalesOrder(order);
      const { parentLines, componentLines, hasUnresolved, decompositionStatus } = decomposeLines(order, packBomIndex);
      soData.has_unresolved_skus = hasUnresolved;
      soData.decomposition_status = decompositionStatus;

      const existing = existingMap[eid];
      if (!existing) {
        newOrders.push({ soData, parentLines, componentLines });
      } else if (headerChanged(existing, soData)) {
        changedOrders.push({ existingId: existing.id, soData });
      } else {
        skipped++;
      }
    }

    console.log(`[BulkSync] Classification: ${newOrders.length} new, ${changedOrders.length} changed, ${skipped} skipped`);

    // ═══ STEP 5: Bulk-create NEW order headers ═══
    let created = 0;
    for (let i = 0; i < newOrders.length; i += BULK_CREATE_SIZE) {
      const batch = newOrders.slice(i, i + BULK_CREATE_SIZE);
      const headerData = batch.map(o => o.soData);
      const createdRecords = await withRetry(() =>
        base44.asServiceRole.entities.SalesOrder.bulkCreate(headerData)
      );

      // Create lines for each new order
      for (let j = 0; j < createdRecords.length; j++) {
        const newId = createdRecords[j].id;
        const { parentLines, componentLines } = batch[j];
        if (parentLines.length > 0 || componentLines.length > 0) {
          try {
            await createLinesForOrder(base44, newId, parentLines, componentLines);
          } catch (lineErr) {
            console.error(`[BulkSync] Error creating lines for ${batch[j].soData.order_number}: ${lineErr.message}`);
            failed++;
          }
        }
      }
      created += createdRecords.length;

      // Progress update
      await base44.asServiceRole.entities.SyncState.update(syncState.id, {
        records_synced: created + changedOrders.length + skipped,
        error_message: `Created ${created}/${newOrders.length} new orders...`,
      }).catch(() => {});
    }

    // ═══ STEP 6: Update CHANGED order headers (one by one, but only header) ═══
    let updated = 0;
    for (const { existingId, soData } of changedOrders) {
      const { shopify_order_id, external_id, ...updateData } = soData;
      try {
        await withRetry(() =>
          base44.asServiceRole.entities.SalesOrder.update(existingId, updateData)
        );
        updated++;
      } catch (err) {
        console.error(`[BulkSync] Update failed for ${soData.order_number}: ${err.message}`);
        failed++;
      }
    }

    console.log(`[BulkSync] Sync done: ${created} created, ${updated} updated, ${skipped} skipped, ${failed} failed`);

    // ═══ STEP 7: Reconciliation — find local paid_unfulfilled NOT in Shopify's open set ═══
    let reconciled = 0;
    const staleOrders = existingOrders.filter(eo =>
      eo.lifecycle_state === 'paid_unfulfilled' && eo.external_id && !shopifyIdsSeen.has(eo.external_id)
    );

    if (staleOrders.length > 0) {
      console.log(`[BulkSync] Reconciling ${staleOrders.length} orders not in Shopify open set`);
      await base44.asServiceRole.entities.SyncState.update(syncState.id, {
        error_message: `Reconciling ${staleOrders.length} stale orders...`,
      }).catch(() => {});

      // Batch-check via Shopify ids= parameter (up to 100 per call)
      for (let i = 0; i < staleOrders.length; i += 100) {
        const chunk = staleOrders.slice(i, i + 100);
        const ids = chunk.map(o => o.external_id).join(',');
        const checkUrl = `https://${storeDomain}/admin/api/2024-01/orders.json?ids=${ids}&status=any&fields=id,financial_status,fulfillment_status,cancelled_at&limit=250`;

        let shopifyData = [];
        for (let attempt = 1; attempt <= 3; attempt++) {
          const res = await fetch(checkUrl, {
            headers: { 'X-Shopify-Access-Token': accessToken, 'Content-Type': 'application/json' },
          });
          if (res.status === 429) {
            const retryAfter = parseFloat(res.headers.get('retry-after') || '2');
            await sleep(retryAfter * 1000);
            continue;
          }
          if (res.ok) {
            const data = await res.json();
            shopifyData = data.orders || [];
            break;
          } else {
            console.error(`[BulkSync] Reconcile batch check failed: ${res.status}`);
            break;
          }
        }

        // Build map of Shopify responses
        const shopMap = {};
        for (const so of shopifyData) shopMap[String(so.id)] = so;

        // Update each stale order
        for (const localOrder of chunk) {
          const shopOrder = shopMap[localOrder.external_id];
          if (!shopOrder) {
            // Not found in Shopify at all — mark cancelled
            await withRetry(() => base44.asServiceRole.entities.SalesOrder.update(localOrder.id, {
              lifecycle_state: 'cancelled',
              last_synced_at: new Date().toISOString(),
            }));
            reconciled++;
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
        }

        if (i + 100 < staleOrders.length) await sleep(500);
      }
      console.log(`[BulkSync] Reconciled ${reconciled} stale orders`);
    }

    // ═══ STEP 8: Recalculate committed stock if anything changed ═══
    let committedResult = null;
    if (created > 0 || updated > 0 || reconciled > 0) {
      console.log(`[BulkSync] Changes detected — triggering committed stock recalc…`);
      await base44.asServiceRole.entities.SyncState.update(syncState.id, {
        error_message: 'Recalculating committed stock…',
      }).catch(() => {});

      try {
        const res = await base44.functions.invoke('recalcCommittedDemand', {
          action: 'commit', refresh_audit: false,
        });
        committedResult = res.data || res;
        console.log(`[BulkSync] Committed recalc done: ${committedResult.skus_committed || 0} SKUs, ${committedResult.soh_updated || 0} SOH updated`);
      } catch (err) {
        console.error(`[BulkSync] Committed recalc failed: ${err.message}`);
        committedResult = { error: err.message };
      }
    } else {
      console.log(`[BulkSync] No changes — skipping committed stock recalc`);
    }

    // ═══ DONE ═══
    const totalProcessed = created + updated + skipped;
    await withRetry(() => base44.asServiceRole.entities.SyncState.update(syncState.id, {
      sync_status: 'idle',
      records_synced: totalProcessed,
      records_failed: failed,
      error_message: '',
      last_cursor: null,
      last_sync_at: new Date().toISOString(),
    }));

    await base44.asServiceRole.entities.AuditLog.create({
      action: 'sync', entity_type: 'SalesOrder',
      description: `Bulk sync v4: ${created} new, ${updated} updated, ${skipped} unchanged, ${failed} failed, ${reconciled} reconciled (${shopifyOrders.length} Shopify orders)${committedResult ? `, committed: ${committedResult.skus_committed || 0} SKUs` : ''}`,
    }).catch(() => {});

    console.log(`[BulkSync] Complete: ${totalProcessed} processed, ${reconciled} reconciled`);

    return Response.json({
      ok: true, status: 'completed',
      created, updated, skipped, failed, reconciled,
      committed_recalc: committedResult,
      total_shopify: shopifyOrders.length,
      total_local: existingOrders.length,
    });

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