import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me();
  if (!user || user.role !== 'admin') {
    return Response.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const mode = body.mode || 'orders'; // 'orders' or 'lines'

  if (mode === 'orders') {
    // Deduplicate ShopifyOrder by order_number
    const allOrders = await base44.asServiceRole.entities.ShopifyOrder.filter({});
    const ordersByNumber = {};
    allOrders.forEach(o => {
      const key = o.order_number;
      if (!ordersByNumber[key]) ordersByNumber[key] = [];
      ordersByNumber[key].push(o);
    });

    let deleted = 0;
    for (const dupes of Object.values(ordersByNumber)) {
      if (dupes.length <= 1) continue;
      dupes.sort((a, b) => new Date(b.created_date) - new Date(a.created_date));
      for (let i = 1; i < dupes.length; i++) {
        await base44.asServiceRole.entities.ShopifyOrder.delete(dupes[i].id);
        deleted++;
      }
    }
    return Response.json({ mode: 'orders', total: allOrders.length, deleted, remaining: allOrders.length - deleted });

  } else {
    // Deduplicate ShopifyOrderLine by shopify_line_item_id (delete up to 100 per run)
    const allLines = await base44.asServiceRole.entities.ShopifyOrderLine.filter({});
    const linesByItemId = {};
    allLines.forEach(l => {
      const key = l.shopify_line_item_id || l.id;
      if (!linesByItemId[key]) linesByItemId[key] = [];
      linesByItemId[key].push(l);
    });

    const toDelete = [];
    for (const dupes of Object.values(linesByItemId)) {
      if (dupes.length <= 1) continue;
      dupes.sort((a, b) => new Date(b.created_date) - new Date(a.created_date));
      for (let i = 1; i < dupes.length; i++) {
        toDelete.push(dupes[i].id);
      }
    }

    // Delete max 100 per call to avoid timeout
    const batch = toDelete.slice(0, 100);
    for (const id of batch) {
      await base44.asServiceRole.entities.ShopifyOrderLine.delete(id);
    }

    return Response.json({
      mode: 'lines',
      total: allLines.length,
      duplicates_found: toDelete.length,
      deleted_this_run: batch.length,
      remaining_duplicates: toDelete.length - batch.length,
    });
  }
});