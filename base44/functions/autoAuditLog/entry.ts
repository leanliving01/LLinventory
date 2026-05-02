import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * Entity automation handler — logs create/update/delete events for key entities.
 * Triggered by entity automations on: ProductionRun, ProductionRunLine, StockMovement,
 * StockOnHand, ProductionTask, CookingRun, PortioningRun, SalesOrder, PurchaseOrder,
 * GoodsReceivedNote, Product, Bom, WipBatch.
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const payload = await req.json();

    const { event, data, old_data, changed_fields } = payload;
    if (!event) {
      return Response.json({ skipped: true, reason: 'no event' });
    }

    const { type, entity_name, entity_id } = event;

    // Build a human-readable description
    let description = '';
    const name = data?.product_name || data?.name || data?.run_number || data?.batch_number || 
                  data?.order_number || data?.po_number || data?.product_sku || data?.sku || '';

    if (type === 'create') {
      description = `Created ${entity_name}${name ? ': ' + name : ''}`;
    } else if (type === 'delete') {
      description = `Deleted ${entity_name}${name ? ': ' + name : ''}`;
    } else if (type === 'update') {
      const fields = changed_fields || [];
      // Highlight status changes
      if (fields.includes('status') && data?.status) {
        const prev = old_data?.status || '?';
        description = `${entity_name} status: ${prev} → ${data.status}${name ? ' (' + name + ')' : ''}`;
      } else if (fields.includes('pick_list_confirmed') && data?.pick_list_confirmed) {
        description = `Pick list confirmed for ${name || entity_id}`;
      } else if (fields.includes('qty_on_hand')) {
        const prev = old_data?.qty_on_hand ?? '?';
        const now = data?.qty_on_hand ?? '?';
        description = `Stock updated: ${prev} → ${now}${name ? ' (' + name + ')' : ''}`;
      } else if (fields.includes('actual_qty')) {
        description = `Actual qty recorded: ${data?.actual_qty}${name ? ' for ' + name : ''}`;
      } else {
        const fieldStr = fields.length > 3 
          ? fields.slice(0, 3).join(', ') + ` +${fields.length - 3} more`
          : fields.join(', ');
        description = `Updated ${entity_name}${name ? ' (' + name + ')' : ''}: ${fieldStr || 'fields changed'}`;
      }
    }

    // Build compact old/new value — only include changed fields to keep it small
    let old_value = null;
    let new_value = null;

    if (type === 'update' && changed_fields && changed_fields.length > 0 && data && old_data) {
      const ov = {};
      const nv = {};
      for (const f of changed_fields.slice(0, 10)) { // cap at 10 fields
        if (old_data[f] !== undefined) ov[f] = old_data[f];
        if (data[f] !== undefined) nv[f] = data[f];
      }
      old_value = JSON.stringify(ov);
      new_value = JSON.stringify(nv);
    } else if (type === 'create' && data) {
      // For creates, store key identifying fields only
      const summary = {};
      const keyFields = ['status', 'run_number', 'run_date', 'product_sku', 'product_name', 'qty', 'qty_on_hand',
        'reason', 'order_number', 'total_amount', 'sku', 'name', 'batch_number', 'planned_qty'];
      for (const f of keyFields) {
        if (data[f] !== undefined && data[f] !== null && data[f] !== '') summary[f] = data[f];
      }
      if (Object.keys(summary).length > 0) new_value = JSON.stringify(summary);
    }

    await base44.asServiceRole.entities.AuditLog.create({
      action: type,
      entity_type: entity_name,
      entity_id: entity_id,
      description,
      ...(old_value ? { old_value } : {}),
      ...(new_value ? { new_value } : {}),
    });

    return Response.json({ success: true, description });
  } catch (error) {
    console.error('AutoAuditLog error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});