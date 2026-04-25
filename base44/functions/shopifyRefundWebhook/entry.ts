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

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 });
  }

  const rawBody = await req.text();

  const hmac = req.headers.get('x-shopify-hmac-sha256');
  const valid = await verifyHmac(rawBody, hmac);
  if (!valid) {
    console.error('[RefundWebhook] HMAC verification failed');
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const reconstructedReq = new Request(req.url, {
    method: req.method,
    headers: req.headers,
    body: rawBody,
  });
  const base44 = createClientFromRequest(reconstructedReq);

  let refund;
  try {
    refund = JSON.parse(rawBody);
  } catch (e) {
    console.error('[RefundWebhook] Invalid JSON:', e.message);
    return Response.json({ error: 'Bad payload' }, { status: 400 });
  }

  if (!refund || !refund.id) {
    return Response.json({ ok: true, skipped: true });
  }

  const refundId = String(refund.id);
  const orderId = String(refund.order_id);
  const topic = req.headers.get('x-shopify-topic') || 'refunds/unknown';
  console.log(`[RefundWebhook] ${topic} — refund ${refundId} for order ${orderId}`);

  try {
    // Log webhook event
    await base44.asServiceRole.entities.ShopifyWebhookEvent.create({
      topic,
      shop_domain: req.headers.get('x-shopify-shop-domain') || '',
      external_id: refundId,
      shopify_updated_at: refund.created_at || '',
      payload: rawBody.slice(0, 50000),
      signature: hmac || '',
      received_at: new Date().toISOString(),
      status: 'pending',
    });

    // Find the SalesOrder
    const salesOrders = await base44.asServiceRole.entities.SalesOrder.filter({ external_id: orderId });
    if (salesOrders.length === 0) {
      console.log(`[RefundWebhook] SalesOrder not found for Shopify order ${orderId}`);
      return Response.json({ ok: true, skipped: true, reason: 'order_not_found' });
    }
    const salesOrder = salesOrders[0];

    // Update lifecycle to refunded
    await base44.asServiceRole.entities.SalesOrder.update(salesOrder.id, {
      lifecycle_state: 'refunded',
      last_synced_at: new Date().toISOString(),
    });

    // Extract refund line items that have restock_type = 'return' (physical return)
    // Shopify refund payload has refund_line_items[] with line_item, quantity, restock_type
    const refundLineItems = refund.refund_line_items || [];
    const returnLines = refundLineItems.filter(rli => rli.restock_type === 'return');

    if (returnLines.length === 0) {
      console.log(`[RefundWebhook] No return lines — refund-only (no stock IN needed)`);

      // Mark event processed
      const events = await base44.asServiceRole.entities.ShopifyWebhookEvent.filter({ external_id: refundId, status: 'pending' });
      if (events.length > 0) {
        await base44.asServiceRole.entities.ShopifyWebhookEvent.update(events[events.length - 1].id, {
          status: 'processed',
          processed_at: new Date().toISOString(),
        });
      }

      await base44.asServiceRole.entities.AuditLog.create({
        action: 'sync',
        entity_type: 'SalesOrder',
        entity_id: salesOrder.id,
        description: `Refund ${refundId} for ${salesOrder.order_number} — no physical return, lifecycle updated to refunded`,
      }).catch(() => {});

      return Response.json({ ok: true, refund_id: refundId, movements_created: 0, reason: 'no_return_lines' });
    }

    // Load order lines to resolve components
    const orderLines = await base44.asServiceRole.entities.SalesOrderLine.filter({ sales_order_id: salesOrder.id });

    // Get dispatch location
    const locations = await base44.asServiceRole.entities.Location.filter({ code: 'DISPATCH' });
    const dispatchLocationId = locations.length > 0 ? locations[0].id : '';

    let movementsCreated = 0;
    let movementsSkipped = 0;
    let unresolvedSkus = [];

    for (const rli of returnLines) {
      const lineItem = rli.line_item || {};
      const shopifyLineId = String(lineItem.id || rli.line_item_id);
      const returnQty = rli.quantity || 0;

      if (returnQty <= 0) continue;

      // Find matching order lines (components of this Shopify line)
      // For package parents, their components have parent_line_id pointing to the parent
      const parentLine = orderLines.find(l => l.external_id === shopifyLineId);

      if (!parentLine) {
        console.log(`[RefundWebhook] No order line found for Shopify line ${shopifyLineId}`);
        continue;
      }

      // Determine lines to create return movements for
      let linesToReturn = [];

      if (parentLine.is_package_parent) {
        // Package — return the component lines
        const componentLines = orderLines.filter(l => l.parent_line_id === parentLine.id && l.is_package_component);
        for (const comp of componentLines) {
          // Scale component qty by return proportion
          const parentOrderQty = parentLine.qty || 1;
          const compQtyPerParent = comp.qty / parentOrderQty;
          linesToReturn.push({
            sku: comp.sku,
            qty: Math.round(compQtyPerParent * returnQty),
            lineExternalId: comp.external_id,
          });
        }
      } else {
        // Standalone/BYO — return directly
        linesToReturn.push({
          sku: parentLine.sku,
          qty: returnQty,
          lineExternalId: parentLine.external_id,
        });
      }

      // Create StockMovement IN for each component
      for (const lr of linesToReturn) {
        const referenceKey = `refund:${refundId}:${lr.lineExternalId}`;

        // Idempotency check
        const existing = await base44.asServiceRole.entities.StockMovement.filter({ reference_key: referenceKey });
        if (existing.length > 0) {
          movementsSkipped++;
          continue;
        }

        // Resolve product
        const products = await base44.asServiceRole.entities.Product.filter({ sku: lr.sku });
        if (products.length === 0) {
          unresolvedSkus.push(lr.sku);
          continue;
        }
        const product = products[0];

        await base44.asServiceRole.entities.StockMovement.create({
          product_id: product.id,
          product_sku: lr.sku,
          product_name: product.name,
          from_location_id: '',
          to_location_id: dispatchLocationId,
          qty: lr.qty,
          uom: product.stock_uom || 'pcs',
          reason: 'return',
          ref_type: 'sales_order',
          ref_id: salesOrder.id,
          reference_key: referenceKey,
          unit_cost_at_movement: product.cost_avg || 0,
          notes: `Return via refund ${refundId} for order ${salesOrder.order_number}`,
        });
        movementsCreated++;
      }
    }

    console.log(`[RefundWebhook] ${movementsCreated} return movements created, ${movementsSkipped} skipped, ${unresolvedSkus.length} unresolved`);

    // Mark event processed
    const events = await base44.asServiceRole.entities.ShopifyWebhookEvent.filter({ external_id: refundId, status: 'pending' });
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
      description: `Refund ${refundId}: ${movementsCreated} return movements for ${salesOrder.order_number}${unresolvedSkus.length ? ` (${unresolvedSkus.length} unresolved)` : ''}`,
    }).catch(() => {});

    return Response.json({
      ok: true,
      refund_id: refundId,
      order_number: salesOrder.order_number,
      movements_created: movementsCreated,
      movements_skipped: movementsSkipped,
      unresolved_skus: unresolvedSkus,
    });

  } catch (err) {
    console.error(`[RefundWebhook ERROR] ${err.message}`);

    const events = await base44.asServiceRole.entities.ShopifyWebhookEvent.filter({ external_id: refundId, status: 'pending' }).catch(() => []);
    if (events.length > 0) {
      await base44.asServiceRole.entities.ShopifyWebhookEvent.update(events[events.length - 1].id, {
        status: 'failed',
        error_message: err.message,
      }).catch(() => {});
    }

    return Response.json({ ok: false, error: err.message }, { status: 200 });
  }
});