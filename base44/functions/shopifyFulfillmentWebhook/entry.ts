import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

// ─── HMAC verification ───
async function verifyHmac(rawBody, hmacHeader) {
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

// ─── Non-inventory exclusion ───
// Only exclude items that are NOT physical inventory (shipping supplies, delivery fees, promos).
// Supplements, sauces, snacks, solo serves ARE real inventory and MUST deduct stock.
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

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 });
  }

  const rawBody = await req.text();

  const hmac = req.headers.get('x-shopify-hmac-sha256');
  const valid = await verifyHmac(rawBody, hmac);
  if (!valid) {
    console.error('[FulfillmentWebhook] HMAC verification failed');
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const reconstructedReq = new Request(req.url, {
    method: req.method,
    headers: req.headers,
    body: rawBody,
  });
  const base44 = createClientFromRequest(reconstructedReq);

  let payload;
  try {
    payload = JSON.parse(rawBody);
  } catch (e) {
    console.error('[FulfillmentWebhook] Invalid JSON:', e.message);
    return Response.json({ error: 'Bad payload' }, { status: 400 });
  }

  // Shopify fulfillments/create sends the fulfillment object directly
  // It contains: id, order_id, line_items[], status, tracking_number, etc.
  const fulfillment = payload;
  if (!fulfillment || !fulfillment.id) {
    return Response.json({ ok: true, skipped: true });
  }

  const fulfillmentId = String(fulfillment.id);
  const orderId = String(fulfillment.order_id);
  const topic = req.headers.get('x-shopify-topic') || 'fulfillments/unknown';
  console.log(`[FulfillmentWebhook] ${topic} — fulfillment ${fulfillmentId} for order ${orderId}`);

  try {
    // Log webhook event
    await base44.asServiceRole.entities.ShopifyWebhookEvent.create({
      topic,
      shop_domain: req.headers.get('x-shopify-shop-domain') || '',
      external_id: fulfillmentId,
      shopify_updated_at: fulfillment.updated_at || '',
      payload: rawBody.slice(0, 50000),
      signature: hmac || '',
      received_at: new Date().toISOString(),
      status: 'pending',
    });

    // Only process successful fulfillments
    if (fulfillment.status !== 'success') {
      console.log(`[FulfillmentWebhook] Ignoring non-success status: ${fulfillment.status}`);
      return Response.json({ ok: true, skipped: true, reason: `status=${fulfillment.status}` });
    }

    // Find the SalesOrder
    const salesOrders = await base44.asServiceRole.entities.SalesOrder.filter({ external_id: orderId });
    if (salesOrders.length === 0) {
      console.log(`[FulfillmentWebhook] SalesOrder not found for Shopify order ${orderId}`);
      // Still return 200 — order may not have synced yet
      return Response.json({ ok: true, skipped: true, reason: 'order_not_found' });
    }
    const salesOrder = salesOrders[0];

    // Update SalesOrder lifecycle to fulfilled if all items are fulfilled
    await base44.asServiceRole.entities.SalesOrder.update(salesOrder.id, {
      lifecycle_state: 'fulfilled',
      fulfillment_status: 'fulfilled',
      last_synced_at: new Date().toISOString(),
    });

    // Load SalesOrderLines for this order (component lines = the ones that commit/deduct stock)
    const orderLines = await base44.asServiceRole.entities.SalesOrderLine.filter({ sales_order_id: salesOrder.id });
    // Only component lines and standalone lines deduct stock (not package parents)
    const deductibleLines = orderLines.filter(l => !l.is_package_parent && l.status === 'active');

    // Build a SKU → Product lookup
    const skus = [...new Set(deductibleLines.map(l => l.sku).filter(Boolean))];
    const productIndex = {};
    for (const sku of skus) {
      const products = await base44.asServiceRole.entities.Product.filter({ sku });
      if (products.length > 0) productIndex[sku] = products[0];
    }

    // Get the dispatch location for fulfillment deductions
    const locations = await base44.asServiceRole.entities.Location.filter({ code: 'DISPATCH' });
    const dispatchLocationId = locations.length > 0 ? locations[0].id : '';

    // Process each fulfillment line item
    const fulfillmentLineItems = fulfillment.line_items || [];
    let movementsCreated = 0;
    let movementsSkipped = 0;
    let unresolvedSkus = [];

    // Map fulfillment line_items by Shopify line_item_id to quantities fulfilled
    const fulfilledQtyByLineId = {};
    for (const fli of fulfillmentLineItems) {
      if (isExcluded(fli)) continue;
      fulfilledQtyByLineId[String(fli.id)] = (fli.quantity || 0);
    }

    // For each deductible order line, check if it was part of this fulfillment
    for (const line of deductibleLines) {
      // For component lines, the external_id may be composite (e.g. "12345_ChiCur")
      // For standalone lines, external_id matches the Shopify line_item ID
      // We need to match by the parent's external_id for components, or directly for standalone

      let qtyToDeduct = 0;

      if (line.is_package_component) {
        // Component line — find the parent line
        const parentLine = orderLines.find(l => l.id === line.parent_line_id);
        if (parentLine) {
          const parentShopifyId = parentLine.external_id;
          if (fulfilledQtyByLineId[parentShopifyId]) {
            // The parent was fulfilled — deduct component qty proportionally
            // Component qty = line.qty (already multiplied by pack multiplier per parent unit)
            // If parent qty=2 and component qty=30 (15 per parent), and fulfilled parent qty=2, deduct 30
            // If fulfilled parent qty=1, deduct 15 (half)
            const parentOrderQty = parentLine.qty || 1;
            const fulfilledParentQty = fulfilledQtyByLineId[parentShopifyId];
            qtyToDeduct = Math.round((line.qty / parentOrderQty) * fulfilledParentQty);
          }
        }
      } else {
        // Standalone or BYO line — match directly by external_id
        if (fulfilledQtyByLineId[line.external_id]) {
          qtyToDeduct = fulfilledQtyByLineId[line.external_id];
        }
      }

      if (qtyToDeduct <= 0) continue;

      // Build idempotency key: order:line:fulfillment
      const referenceKey = `${orderId}:${line.external_id}:${fulfillmentId}`;

      // Check idempotency — skip if movement already exists
      const existingMovements = await base44.asServiceRole.entities.StockMovement.filter({ reference_key: referenceKey });
      if (existingMovements.length > 0) {
        movementsSkipped++;
        continue;
      }

      // Resolve product
      const product = productIndex[line.sku];
      if (!product) {
        unresolvedSkus.push(line.sku);
        continue;
      }

      // Create StockMovement OUT (from dispatch location)
      await base44.asServiceRole.entities.StockMovement.create({
        product_id: product.id,
        product_sku: line.sku,
        product_name: product.name,
        from_location_id: dispatchLocationId,
        to_location_id: '',
        qty: qtyToDeduct,
        uom: product.stock_uom || 'pcs',
        reason: 'sale_fulfillment',
        ref_type: 'sales_order',
        ref_id: salesOrder.id,
        reference_key: referenceKey,
        unit_cost_at_movement: product.cost_avg || 0,
        notes: `Fulfillment ${fulfillmentId} for order ${salesOrder.order_number}`,
      });
      movementsCreated++;
    }

    // Mark fulfilled lines
    for (const line of deductibleLines) {
      await base44.asServiceRole.entities.SalesOrderLine.update(line.id, {
        status: 'fulfilled',
        fulfilled_qty: line.qty,
      });
    }

    // Flag unresolved if any
    if (unresolvedSkus.length > 0) {
      await base44.asServiceRole.entities.SalesOrder.update(salesOrder.id, {
        has_unresolved_fulfillment: true,
      });
    }

    console.log(`[FulfillmentWebhook] ${movementsCreated} movements created, ${movementsSkipped} skipped (idempotent), ${unresolvedSkus.length} unresolved SKUs`);

    // Mark webhook processed
    const events = await base44.asServiceRole.entities.ShopifyWebhookEvent.filter({ external_id: fulfillmentId, status: 'pending' });
    if (events.length > 0) {
      await base44.asServiceRole.entities.ShopifyWebhookEvent.update(events[events.length - 1].id, {
        status: 'processed',
        processed_at: new Date().toISOString(),
      });
    }

    await base44.asServiceRole.entities.AuditLog.create({
      action: 'sync',
      entity_type: 'StockMovement',
      entity_id: salesOrder.id,
      description: `Fulfillment ${fulfillmentId}: ${movementsCreated} stock-out movements for order ${salesOrder.order_number}${unresolvedSkus.length ? ` (${unresolvedSkus.length} unresolved)` : ''}`,
    }).catch(() => {});

    return Response.json({
      ok: true,
      fulfillment_id: fulfillmentId,
      order_number: salesOrder.order_number,
      movements_created: movementsCreated,
      movements_skipped: movementsSkipped,
      unresolved_skus: unresolvedSkus,
    });

  } catch (err) {
    console.error(`[FulfillmentWebhook ERROR] ${err.message}`);

    const events = await base44.asServiceRole.entities.ShopifyWebhookEvent.filter({ external_id: fulfillmentId, status: 'pending' }).catch(() => []);
    if (events.length > 0) {
      await base44.asServiceRole.entities.ShopifyWebhookEvent.update(events[events.length - 1].id, {
        status: 'failed',
        error_message: err.message,
      }).catch(() => {});
    }

    return Response.json({ ok: false, error: err.message }, { status: 200 });
  }
});