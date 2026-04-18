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

  // Get existing orders to avoid duplicates
  const existingOrders = await base44.asServiceRole.entities.ShopifyOrder.filter({});
  const existingByShopifyId = {};
  existingOrders.forEach(o => { existingByShopifyId[o.shopify_order_id] = o; });

  let created = 0;
  let updated = 0;
  let orderLineRecords = [];

  for (const order of shopifyOrders) {
    const orderId = String(order.id);
    const isByo = (order.tags || '').toLowerCase().includes('byo') || 
                  order.line_items.some(li => (li.title || '').toLowerCase().includes('build your own'));

    const totalMeals = order.line_items.reduce((sum, li) => sum + (li.quantity || 0), 0);

    const orderData = {
      shopify_order_id: orderId,
      order_number: order.name || `#${order.order_number}`,
      customer_name: order.customer ? `${order.customer.first_name || ''} ${order.customer.last_name || ''}`.trim() : '',
      paid_status: 'paid',
      fulfilment_status: 'unfulfilled',
      tags: order.tags || '',
      order_date: order.created_at,
      synced_at: new Date().toISOString(),
      total_meals: totalMeals,
      is_byo: isByo,
      demand_calculated: false,
    };

    let savedOrder;
    if (existingByShopifyId[orderId]) {
      savedOrder = await base44.asServiceRole.entities.ShopifyOrder.update(
        existingByShopifyId[orderId].id,
        orderData
      );
      updated++;
    } else {
      savedOrder = await base44.asServiceRole.entities.ShopifyOrder.create(orderData);
      created++;
    }

    // Create order line items
    for (const li of order.line_items) {
      orderLineRecords.push({
        shopify_order_id: savedOrder.id,
        shopify_line_item_id: String(li.id),
        product_title: li.title || '',
        variant_title: li.variant_title || '',
        quantity: li.quantity || 0,
        is_mapped: false,
        mapping_type: 'unmapped',
        raw_payload: JSON.stringify(li),
      });
    }
  }

  // Bulk create line items
  if (orderLineRecords.length > 0) {
    // Create in batches of 50
    for (let i = 0; i < orderLineRecords.length; i += 50) {
      const batch = orderLineRecords.slice(i, i + 50);
      await base44.asServiceRole.entities.ShopifyOrderLine.bulkCreate(batch);
    }
  }

  // Create audit log
  await base44.asServiceRole.entities.AuditLog.create({
    action: 'sync',
    entity_type: 'ShopifyOrder',
    description: `Synced ${shopifyOrders.length} orders from Shopify (${created} new, ${updated} updated, ${orderLineRecords.length} line items)`,
  });

  return Response.json({
    success: true,
    total: shopifyOrders.length,
    created,
    updated,
    line_items: orderLineRecords.length,
  });
});