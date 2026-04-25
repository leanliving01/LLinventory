import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * Bulk sync: pulls orders from Shopify REST API in multi-page batches,
 * processes them through the same logic as shopifyWebhook.
 * 
 * Fetches up to MAX_PAGES pages of PAGE_SIZE orders from Shopify per call
 * (default: 10 pages × 25 = 250 orders per backend invocation).
 * Frontend calls repeatedly until has_more=false.
 *
 * Params:
 *   financial_status: default 'paid'
 *   fulfillment_status: default 'unfulfilled'
 *   next_page_url: cursor URL for resuming pagination
 *   max_pages: (optional) how many Shopify pages to fetch per call (default 10, max 10)
 */

// ─── Lifecycle derivation (same as webhook §6) ───
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
  if (t.includes('supplement')) return true;
  if (t.includes('low calorie sauce') || (t.includes('sauce') && !t.includes('meal'))) return true;
  if (t.includes('90-day reset') || t.includes('90 day reset')) return true;
  if (s === 'l90c2') return true;
  if (t.includes('dry ice') || t.includes('cooler box') || t.includes('delivery')) return true;
  if (t.includes('snack') && !t.includes('meal')) return true;
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
      sku, name: li.title || '', qty,
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
      for (const compSku of pb.component_skus) {
        componentLines.push({
          external_id: `${lineExternalId}_${compSku}`, sku: compSku, name: compSku,
          qty: pb.multiplier * qty, unit_price: 0, line_total: 0, line_type: 'standalone',
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

// Simple hash for change detection — covers all fields that matter
function computeOrderHash(order) {
  const key = [
    order.id, order.financial_status, order.fulfillment_status,
    order.cancelled_at || '', order.updated_at || '',
    (order.line_items || []).map(li => `${li.id}:${li.quantity}:${li.sku}:${li.price}`).join('|'),
  ].join('::');
  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    hash = ((hash << 5) - hash + key.charCodeAt(i)) | 0;
  }
  return String(hash);
}

async function processOrder(base44, order, packBomIndex) {
  const orderId = String(order.id);
  const dataHash = computeOrderHash(order);

  // Check if order exists and is unchanged
  const existingOrders = await base44.asServiceRole.entities.SalesOrder.filter({ external_id: orderId });
  if (existingOrders.length > 0 && existingOrders[0].data_hash === dataHash) {
    // Order unchanged — skip expensive line processing, just touch last_synced_at
    await base44.asServiceRole.entities.SalesOrder.update(existingOrders[0].id, { last_synced_at: new Date().toISOString() });
    return { action: 'unchanged', order_number: existingOrders[0].order_number, lines: 0 };
  }

  const soData = buildSalesOrder(order);
  soData.data_hash = dataHash;
  const { parentLines, componentLines, hasUnresolved, decompositionStatus } = decomposeLines(order, packBomIndex);
  soData.has_unresolved_skus = hasUnresolved;
  soData.decomposition_status = decompositionStatus;

  let salesOrderId;
  let action;

  if (existingOrders.length > 0) {
    salesOrderId = existingOrders[0].id;
    const { shopify_order_id, external_id, ...updateData } = soData;
    await base44.asServiceRole.entities.SalesOrder.update(salesOrderId, updateData);
    action = 'updated';
  } else {
    const created = await base44.asServiceRole.entities.SalesOrder.create(soData);
    salesOrderId = created.id;
    action = 'created';
  }

  // Delete + recreate lines (only when order actually changed)
  const existingLines = await base44.asServiceRole.entities.SalesOrderLine.filter({ sales_order_id: salesOrderId });
  for (const el of existingLines) {
    await base44.asServiceRole.entities.SalesOrderLine.delete(el.id);
  }

  const parentIdMap = {};
  for (const pl of parentLines) {
    const created = await base44.asServiceRole.entities.SalesOrderLine.create({ ...pl, sales_order_id: salesOrderId });
    parentIdMap[pl.external_id] = created.id;
  }
  for (const cl of componentLines) {
    const parentB44Id = parentIdMap[cl.parent_line_external_id] || '';
    const { parent_line_external_id, ...lineData } = cl;
    await base44.asServiceRole.entities.SalesOrderLine.create({ ...lineData, sales_order_id: salesOrderId, parent_line_id: parentB44Id });
  }

  return { action, order_number: soData.order_number, lines: parentLines.length + componentLines.length };
}

// ─── Helper: fetch one page from Shopify with retry on 429 ───
async function fetchShopifyPage(url, accessToken) {
  const MAX_RETRIES = 3;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const res = await fetch(url, {
      headers: { 'X-Shopify-Access-Token': accessToken, 'Content-Type': 'application/json' },
    });

    if (res.status === 429) {
      const retryAfter = parseFloat(res.headers.get('retry-after') || '2');
      console.warn(`[BulkSync] Shopify rate-limited (429), waiting ${retryAfter}s (attempt ${attempt}/${MAX_RETRIES})`);
      await new Promise(r => setTimeout(r, retryAfter * 1000));
      continue;
    }

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Shopify API ${res.status}: ${errText.slice(0, 500)}`);
    }

    const data = await res.json();
    const orders = data.orders || [];

    // Extract next page URL from Link header
    const linkHeader = res.headers.get('link') || '';
    const nextMatch = linkHeader.match(/<([^>]+)>;\s*rel="next"/);
    const nextUrl = nextMatch ? nextMatch[1] : '';

    return { orders, nextUrl };
  }
  throw new Error('Shopify rate limit exceeded after retries');
}

// ═════════════════════════════════════════
Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me();
  if (!user || user.role !== 'admin') {
    return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const financialStatus = body.financial_status || 'paid';
  const fulfillmentStatus = body.fulfillment_status || 'unfulfilled';
  const nextPageUrl = body.next_page_url || '';
  const PAGE_SIZE = 15;
  // Default 1 page of 25 for initial/transition syncs (new orders or missing hash need full processing).
  // Once all orders have data_hash, subsequent syncs skip unchanged orders and can handle more pages.
  // Frontend can pass max_pages up to 5 to go faster once the initial sync is done.
  const MAX_PAGES = Math.min(parseInt(body.max_pages) || 1, 5);

  const storeDomain = Deno.env.get('SHOPIFY_STORE_DOMAIN');
  const accessToken = Deno.env.get('SHOPIFY_ACCESS_TOKEN');
  if (!storeDomain || !accessToken) {
    return Response.json({ error: 'Shopify credentials not set' }, { status: 500 });
  }

  console.log(`[BulkSync] Starting — financial=${financialStatus}, fulfillment=${fulfillmentStatus}, max_pages=${MAX_PAGES}, has_next_url=${!!nextPageUrl}`);

  // Load PackBom index once for entire batch
  const packBoms = await base44.asServiceRole.entities.PackBom.filter({ active: true });
  const packBomIndex = {};
  for (const pb of packBoms) packBomIndex[pb.package_sku] = pb;

  // ─── Fetch multiple pages from Shopify ───
  const allOrders = [];
  let currentUrl = nextPageUrl || `https://${storeDomain}/admin/api/2024-01/orders.json?status=any&financial_status=${financialStatus}&fulfillment_status=${fulfillmentStatus}&limit=${PAGE_SIZE}`;
  let finalNextUrl = '';
  let pagesFetched = 0;

  for (let page = 0; page < MAX_PAGES; page++) {
    if (!currentUrl) break;

    const { orders, nextUrl } = await fetchShopifyPage(currentUrl, accessToken);
    allOrders.push(...orders);
    pagesFetched++;
    finalNextUrl = nextUrl;
    console.log(`[BulkSync] Page ${page + 1}: fetched ${orders.length} orders (running total: ${allOrders.length})`);

    if (!nextUrl || orders.length === 0) break;
    currentUrl = nextUrl;
  }

  console.log(`[BulkSync] Fetched ${allOrders.length} orders across ${pagesFetched} pages, more_pages=${!!finalNextUrl}`);

  // ─── Process all fetched orders ───
  const results = [];
  const errors = [];
  for (const order of allOrders) {
    try {
      const result = await processOrder(base44, order, packBomIndex);
      results.push(result);
    } catch (err) {
      const orderName = order.name || `#${order.order_number}` || order.id;
      console.error(`[BulkSync] ERROR processing ${orderName}: ${err.message}`);
      errors.push({ order: orderName, error: err.message });
    }
  }

  const hasMore = !!finalNextUrl;
  const created = results.filter(r => r.action === 'created').length;
  const updated = results.filter(r => r.action === 'updated').length;
  const unchanged = results.filter(r => r.action === 'unchanged').length;

  console.log(`[BulkSync] Batch done — ${created} created, ${updated} updated, ${unchanged} unchanged, ${errors.length} errors, has_more=${hasMore}`);

  return Response.json({
    ok: true,
    chunk_size: results.length + errors.length,
    pages_fetched: pagesFetched,
    created,
    updated,
    unchanged,
    skipped: errors.length,
    next_page_url: finalNextUrl,
    has_more: hasMore,
    errors: errors.length > 0 ? errors : undefined,
  });
});