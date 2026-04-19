import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me();
  if (!user) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const storeDomain = Deno.env.get('SHOPIFY_STORE_DOMAIN');
  const accessToken = Deno.env.get('SHOPIFY_ACCESS_TOKEN');

  if (!storeDomain || !accessToken) {
    return Response.json({ error: 'Shopify credentials not configured' }, { status: 400 });
  }

  // Fetch paid, unfulfilled orders from Shopify
  const url = `https://${storeDomain}/admin/api/2024-01/orders.json?status=open&financial_status=paid&fulfillment_status=unfulfilled&limit=250`;

  const shopifyRes = await fetch(url, {
    headers: {
      'X-Shopify-Access-Token': accessToken,
      'Content-Type': 'application/json',
    },
  });

  if (!shopifyRes.ok) {
    const errorText = await shopifyRes.text();
    console.error('Shopify API error:', shopifyRes.status, errorText);
    return Response.json({ error: `Shopify API error: ${shopifyRes.status}` }, { status: 502 });
  }

  const { orders: shopifyOrders } = await shopifyRes.json();
  console.log(`Fetched ${shopifyOrders.length} orders from Shopify`);

  // Get ALL existing orders — index by BOTH shopify_order_id AND order_number for bulletproof dedup
  const existingOrders = await base44.asServiceRole.entities.ShopifyOrder.filter({});
  const existingByShopifyId = {};
  const existingByOrderNumber = {};
  existingOrders.forEach(o => {
    if (o.shopify_order_id) existingByShopifyId[o.shopify_order_id] = o;
    if (o.order_number) existingByOrderNumber[o.order_number] = o;
  });

  // Get ALL existing order lines, indexed by shopify_line_item_id for dedup
  const existingLines = await base44.asServiceRole.entities.ShopifyOrderLine.filter({});
  const existingLinesByItemId = {};
  existingLines.forEach(l => {
    if (l.shopify_line_item_id) existingLinesByItemId[l.shopify_line_item_id] = l;
  });

  let created = 0;
  let updated = 0;
  let skipped = 0;
  let linesCreated = 0;
  let linesUpdated = 0;

  for (const order of shopifyOrders) {
    const shopifyId = String(order.id);
    const orderNumber = order.name || `#${order.order_number}`;

    // Check for existing order by shopify_order_id OR order_number (belt and suspenders)
    const existingOrder = existingByShopifyId[shopifyId] || existingByOrderNumber[orderNumber];

    const isByo = (order.tags || '').toLowerCase().includes('byo') ||
                  order.line_items.some(li => (li.title || '').toLowerCase().includes('build your own'));

    const totalMeals = order.line_items.reduce((sum, li) => sum + (li.quantity || 0), 0);

    let savedOrderId;

    if (existingOrder) {
      // Order exists — only update fields that may have changed, NEVER reset demand_calculated
      const updateData = {
        customer_name: order.customer ? `${order.customer.first_name || ''} ${order.customer.last_name || ''}`.trim() : existingOrder.customer_name,
        paid_status: 'paid',
        fulfilment_status: 'unfulfilled',
        tags: order.tags || '',
        synced_at: new Date().toISOString(),
        total_meals: totalMeals,
        is_byo: isByo,
      };

      // Check if anything actually changed
      const hasChanges =
        existingOrder.total_meals !== totalMeals ||
        existingOrder.tags !== (order.tags || '') ||
        existingOrder.is_byo !== isByo ||
        existingOrder.customer_name !== updateData.customer_name;

      if (hasChanges) {
        await base44.asServiceRole.entities.ShopifyOrder.update(existingOrder.id, updateData);
        updated++;
      } else {
        skipped++;
      }
      savedOrderId = existingOrder.id;
    } else {
      // Brand new order — create it
      const savedOrder = await base44.asServiceRole.entities.ShopifyOrder.create({
        shopify_order_id: shopifyId,
        order_number: orderNumber,
        customer_name: order.customer ? `${order.customer.first_name || ''} ${order.customer.last_name || ''}`.trim() : '',
        paid_status: 'paid',
        fulfilment_status: 'unfulfilled',
        tags: order.tags || '',
        order_date: order.created_at,
        synced_at: new Date().toISOString(),
        total_meals: totalMeals,
        is_byo: isByo,
        demand_calculated: false,
      });
      savedOrderId = savedOrder.id;
      created++;
    }

    // Sync line items — dedup by shopify_line_item_id
    for (const li of order.line_items) {
      const lineItemId = String(li.id);
      const existingLine = existingLinesByItemId[lineItemId];

      if (existingLine) {
        // Line exists — update only if quantity changed
        if (existingLine.quantity !== (li.quantity || 0)) {
          await base44.asServiceRole.entities.ShopifyOrderLine.update(existingLine.id, {
            quantity: li.quantity || 0,
            product_title: li.title || '',
            variant_title: li.variant_title || '',
            raw_payload: JSON.stringify(li),
          });
          linesUpdated++;
        }
      } else {
        // New line item — create it
        await base44.asServiceRole.entities.ShopifyOrderLine.create({
          shopify_order_id: savedOrderId,
          shopify_line_item_id: lineItemId,
          product_title: li.title || '',
          variant_title: li.variant_title || '',
          quantity: li.quantity || 0,
          is_mapped: false,
          mapping_type: 'unmapped',
          raw_payload: JSON.stringify(li),
        });
        linesCreated++;
      }
    }
  }

  // Create audit log
  await base44.asServiceRole.entities.AuditLog.create({
    action: 'sync',
    entity_type: 'ShopifyOrder',
    description: `Synced ${shopifyOrders.length} orders from Shopify (${created} new, ${updated} updated, ${skipped} unchanged, ${linesCreated} new lines, ${linesUpdated} updated lines)`,
  });

  return Response.json({
    success: true,
    total: shopifyOrders.length,
    created,
    updated,
    skipped,
    lines_created: linesCreated,
    lines_updated: linesUpdated,
  });
});