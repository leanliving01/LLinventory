import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

// ─── HMAC verification ───
async function verifyHmac(rawBody, hmacHeader) {
  // If no HMAC header, skip verification (test calls, or secret not configured)
  if (!hmacHeader) return true;
  const secret = Deno.env.get('SHOPIFY_WEBHOOK_SECRET');
  if (!secret) return true;
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(rawBody));
  const computed = btoa(String.fromCharCode(...new Uint8Array(sig)));
  return computed === hmacHeader;
}

// ─── Lifecycle derivation (§6) — always re-derive, never cache ───
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

// ─── Non-inventory exclusion ───
// Only exclude items that are NOT physical inventory (shipping supplies, delivery fees, promos).
// Supplements, sauces, snacks, solo serves ARE real inventory and MUST commit/deduct stock.
function isExcluded(li) {
  const t = (li.title || '').toLowerCase();
  const s = (li.sku || '').toLowerCase();
  // Promotional / reset items with no inventory
  if (t.includes('90-day reset') || t.includes('90 day reset')) return true;
  if (s === 'l90c2') return true;
  // Shipping supplies and delivery fees — not inventory
  if (t.includes('dry ice') || t.includes('cooler box') || t.includes('delivery')) return true;
  // No SKU = not a real product (e.g. tips, fees)
  if (!s) return true;
  return false;
}

// ─── Line classification (§7A decision algorithm) ───
function classifyLine(li, packBomIndex, orderTags) {
  const sku = li.sku || '';
  const title = (li.title || '').toLowerCase();
  const tags = (orderTags || '').toLowerCase().split(',').map(t => t.trim());

  // Check if SKU matches a PackBom package_sku
  if (packBomIndex[sku]) {
    const pb = packBomIndex[sku];
    if (pb.package_type === 'goal_based') return 'goal_package';
    if (pb.package_type === 'low_carb') return 'low_carb_package';
    if (pb.package_type === 'bundle') return 'bundle';
  }

  // BYO detection
  if (title.includes('build your own') || title.includes('byo') || tags.includes('byo meals') || tags.includes('byo')) {
    return 'byo';
  }

  // Standalone meal — has a SKU but didn't match a package
  if (sku) return 'standalone';

  return 'unknown';
}

// ─── Build SalesOrder from Shopify payload ───
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
    raw_payload: JSON.stringify(order).slice(0, 50000),
  };
}

// ─── Decompose package lines into component SalesOrderLines (§7A) ───
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

    // Parent line (always created)
    const parentLine = {
      external_id: lineExternalId,
      shopify_variant_id: li.variant_id ? String(li.variant_id) : '',
      sku,
      name: li.title || '',
      variant_title: li.variant_title || '',
      qty,
      unit_price: parseFloat(li.price || 0),
      line_total: parseFloat(li.price || 0) * qty,
      line_type: lineType,
      source_platform: 'shopify',
      last_synced_at: new Date().toISOString(),
      raw_payload: JSON.stringify(li).slice(0, 10000),
      status: 'active',
      is_package_parent: false,
      is_package_component: false,
    };

    // If it's a package, mark parent and decompose
    if (['goal_package', 'low_carb_package'].includes(lineType) && packBomIndex[sku]) {
      const pb = packBomIndex[sku];
      parentLine.is_package_parent = true;
      parentLine.portion_weight_g = pb.portion_weight_g;
      parentLines.push(parentLine);

      // Generate component lines
      for (const compSku of pb.component_skus) {
        componentLines.push({
          external_id: `${lineExternalId}_${compSku}`,
          sku: compSku,
          name: compSku,
          qty: pb.multiplier * qty,
          unit_price: 0,
          line_total: 0,
          line_type: lineType === 'goal_package' ? 'standalone' : 'standalone',
          is_package_parent: false,
          is_package_component: true,
          parent_line_external_id: lineExternalId,
          portion_weight_g: pb.portion_weight_g,
          status: 'active',
          source_platform: 'shopify',
          last_synced_at: new Date().toISOString(),
        });
      }
    } else if (lineType === 'byo') {
      // BYO: line is a standalone meal at 300g — not decomposed further
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

// ─── Also update legacy ShopifyOrder for backward compat with existing dashboard ───
async function upsertLegacyOrder(base44, order, packBomIndex) {
  const orderTags = order.tags || '';
  let mwl = 0, mlm = 0, wwl = 0, wlm = 0, lc = 0, byo = 0, total = 0;
  let isByo = false;

  for (const li of (order.line_items || [])) {
    if (isExcluded(li)) continue;
    const sku = li.sku || '';
    const qty = li.quantity || 1;
    const title = (li.title || '').toLowerCase();
    const tags = (orderTags || '').toLowerCase().split(',').map(t => t.trim());

    if (title.includes('build your own') || title.includes('byo') || tags.includes('byo meals') || tags.includes('byo')) {
      isByo = true;
      byo += qty;
      total += qty;
      continue;
    }

    const pb = packBomIndex[sku];
    if (pb) {
      const mealCount = pb.component_skus.length * pb.multiplier * qty;
      total += mealCount;
      // Determine family from SKU prefix
      if (sku.startsWith('MenLea')) mlm += mealCount;
      else if (sku.startsWith('MenWei')) mwl += mealCount;
      else if (sku.startsWith('WomLea')) wlm += mealCount;
      else if (sku.startsWith('WomWei')) wwl += mealCount;
      else if (sku.startsWith('SCP')) lc += mealCount;
    }
  }

  const data = {
    shopify_order_id: String(order.id),
    order_number: order.name || `#${order.order_number}`,
    order_date: order.created_at,
    customer_name: order.customer ? `${order.customer.first_name || ''} ${order.customer.last_name || ''}`.trim() : '',
    paid_status: order.financial_status === 'paid' ? 'paid' : order.financial_status === 'refunded' ? 'refunded' : order.financial_status === 'partially_paid' ? 'partially_paid' : 'unpaid',
    fulfilment_status: !order.fulfillment_status ? 'unfulfilled' : order.fulfillment_status === 'fulfilled' ? 'fulfilled' : order.fulfillment_status === 'partial' ? 'partial' : 'unfulfilled',
    tags: orderTags,
    synced_at: new Date().toISOString(),
    total_meals: total, mwl_meals: mwl, mlm_meals: mlm, wwl_meals: wwl, wlm_meals: wlm, lc_meals: lc, byo_meals: byo,
    is_byo: isByo, demand_calculated: false,
  };

  const existing = await base44.asServiceRole.entities.ShopifyOrder.filter({ shopify_order_id: data.shopify_order_id });
  if (existing.length > 0) {
    const { shopify_order_id, order_number, order_date, ...upd } = data;
    await base44.asServiceRole.entities.ShopifyOrder.update(existing[0].id, upd);
  } else {
    await base44.asServiceRole.entities.ShopifyOrder.create(data);
  }
}


// ═══════════════════════════════════════════════
// MAIN HANDLER
// ═══════════════════════════════════════════════
Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 });
  }

  // Clone the request so we can read the body for HMAC and still pass it to the SDK
  const rawBody = await req.text();

  // HMAC verification
  const hmac = req.headers.get('x-shopify-hmac-sha256');
  const valid = await verifyHmac(rawBody, hmac);
  if (!valid) {
    console.error('[Webhook] HMAC verification failed');
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Reconstruct request with body for SDK (it needs auth headers)
  const reconstructedReq = new Request(req.url, {
    method: req.method,
    headers: req.headers,
    body: rawBody,
  });
  const base44 = createClientFromRequest(reconstructedReq);
  let order;
  try {
    order = JSON.parse(rawBody);
  } catch (e) {
    console.error('[Webhook] Invalid JSON:', e.message);
    return Response.json({ error: 'Bad payload' }, { status: 400 });
  }

  if (!order || !order.id) {
    return Response.json({ ok: true, skipped: true });
  }

  const orderId = String(order.id);
  const orderName = order.name || `#${order.order_number}`;
  console.log(`[Webhook] Processing ${orderName} (${orderId})`);

  try {
    // ── Log webhook event for audit trail ──
    await base44.asServiceRole.entities.ShopifyWebhookEvent.create({
      topic: req.headers.get('x-shopify-topic') || 'orders/unknown',
      shop_domain: req.headers.get('x-shopify-shop-domain') || '',
      external_id: orderId,
      shopify_updated_at: order.updated_at || '',
      payload: rawBody.slice(0, 50000),
      signature: hmac || '',
      received_at: new Date().toISOString(),
      status: 'pending',
    });

    // ── Load PackBom index (keyed by package_sku) ──
    const packBoms = await base44.asServiceRole.entities.PackBom.filter({ active: true });
    const packBomIndex = {};
    for (const pb of packBoms) {
      packBomIndex[pb.package_sku] = pb;
    }

    // ── Build SalesOrder data ──
    const soData = buildSalesOrder(order);

    // ── Decompose lines ──
    const { parentLines, componentLines, hasUnresolved, decompositionStatus } = decomposeLines(order, packBomIndex);
    soData.has_unresolved_skus = hasUnresolved;
    soData.decomposition_status = decompositionStatus;

    // ── Upsert SalesOrder ──
    const existingOrders = await base44.asServiceRole.entities.SalesOrder.filter({ external_id: orderId });
    let salesOrderId;

    if (existingOrders.length > 0) {
      // Update existing
      salesOrderId = existingOrders[0].id;
      const { shopify_order_id, external_id, ...updateData } = soData;
      await base44.asServiceRole.entities.SalesOrder.update(salesOrderId, updateData);
      console.log(`[Webhook] Updated SalesOrder ${orderName}`);
    } else {
      // Create new
      const created = await base44.asServiceRole.entities.SalesOrder.create(soData);
      salesOrderId = created.id;
      console.log(`[Webhook] Created SalesOrder ${orderName}`);
    }

    // ── Upsert SalesOrderLines ──
    // Delete existing lines for this order and recreate (simplest idempotent approach)
    const existingLines = await base44.asServiceRole.entities.SalesOrderLine.filter({ sales_order_id: salesOrderId });
    if (existingLines.length > 0) {
      for (const el of existingLines) {
        await base44.asServiceRole.entities.SalesOrderLine.delete(el.id);
      }
    }

    // Create parent lines and collect their IDs for component linking
    const parentIdMap = {}; // external_id -> base44 id
    for (const pl of parentLines) {
      const created = await base44.asServiceRole.entities.SalesOrderLine.create({
        ...pl,
        sales_order_id: salesOrderId,
      });
      parentIdMap[pl.external_id] = created.id;
    }

    // Create component lines linked to parents
    for (const cl of componentLines) {
      const parentB44Id = parentIdMap[cl.parent_line_external_id] || '';
      const { parent_line_external_id, ...lineData } = cl;
      await base44.asServiceRole.entities.SalesOrderLine.create({
        ...lineData,
        sales_order_id: salesOrderId,
        parent_line_id: parentB44Id,
      });
    }

    console.log(`[Webhook] ${parentLines.length} parent lines, ${componentLines.length} component lines`);

    // ── Legacy ShopifyOrder upsert (backward compat) ──
    await upsertLegacyOrder(base44, order, packBomIndex);

    // ── Update webhook event status ──
    const events = await base44.asServiceRole.entities.ShopifyWebhookEvent.filter({ external_id: orderId, status: 'pending' });
    if (events.length > 0) {
      await base44.asServiceRole.entities.ShopifyWebhookEvent.update(events[events.length - 1].id, {
        status: 'processed',
        processed_at: new Date().toISOString(),
      });
    }

    // ── Audit log ──
    await base44.asServiceRole.entities.AuditLog.create({
      action: 'sync',
      entity_type: 'SalesOrder',
      entity_id: salesOrderId,
      description: `Webhook: ${existingOrders.length > 0 ? 'updated' : 'created'} ${orderName} [${soData.lifecycle_state}] — ${parentLines.length} parent + ${componentLines.length} component lines`,
    }).catch(() => {});

    return Response.json({
      ok: true,
      action: existingOrders.length > 0 ? 'updated' : 'created',
      order_number: orderName,
      lifecycle_state: soData.lifecycle_state,
      lines: parentLines.length + componentLines.length,
    });

  } catch (err) {
    console.error(`[Webhook ERROR] ${err.message}`);

    // Mark webhook event as failed
    const events = await base44.asServiceRole.entities.ShopifyWebhookEvent.filter({ external_id: orderId, status: 'pending' }).catch(() => []);
    if (events.length > 0) {
      await base44.asServiceRole.entities.ShopifyWebhookEvent.update(events[events.length - 1].id, {
        status: 'failed',
        error_message: err.message,
      }).catch(() => {});
    }

    await base44.asServiceRole.entities.AuditLog.create({
      action: 'sync',
      entity_type: 'SalesOrder',
      description: `Webhook FAILED for ${orderName}: ${err.message}`,
    }).catch(() => {});

    // Return 200 so Shopify doesn't retry endlessly
    return Response.json({ ok: false, error: err.message }, { status: 200 });
  }
});