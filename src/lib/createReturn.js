import { base44 } from '@/api/base44Client';
import { nextDocNumber } from '@/lib/docNumbering';
import { writeAuditLog } from '@/lib/auditLog';
import { logWorkflowEvent } from '@/lib/salesWorkflowEvents';

// Creates a Draft Return manually from an existing sales order, copying the
// customer snapshot and the order's active non-component lines as a starting
// point (the user then edits which items / quantities are actually returned).
// Returns the new return id. Mirrors createResendFromOrder.
//
// No stock is moved here — a manual return follows the same strict path as a
// Shopify-imported one (receipt + QC required before any restock).
export async function createReturnFromOrder(salesOrderId, { actor = null } = {}) {
  const orders = await base44.entities.SalesOrder.filter({ id: salesOrderId });
  const order = orders[0];
  if (!order) throw new Error('Order not found');

  const lines = await base44.entities.SalesOrderLine.filter({ sales_order_id: salesOrderId }, 'name', 500);
  const sourceLines = lines.filter(l => !l.is_package_component && l.status === 'active');

  const returnNumber = await nextDocNumber('RET');
  const returnId = crypto.randomUUID();

  await base44.entities.ShopifyReturn.create({
    id: returnId,
    return_number: returnNumber,
    created_via: 'manual',
    source: 'return',
    dedupe_key: `manual:${returnId}`,
    sales_order_id: order.id,
    shopify_order_id: order.shopify_order_id || null,
    order_number: order.order_number || null,
    customer_name: order.customer_name || null,
    customer_email: order.customer_email || null,
    return_date: new Date().toISOString(),
    status: 'draft_return',
    stock_path: 'undecided',
    refund_decision: 'undecided',
  });

  if (sourceLines.length) {
    await base44.entities.ShopifyReturnLine.bulkCreate(sourceLines.map(l => ({
      id: crypto.randomUUID(),
      return_id: returnId,
      sales_order_line_id: l.id,
      product_id: l.our_product_id || null,
      sku: l.sku || null,
      product_name: l.name || null,
      variant_title: l.variant_title || null,
      qty_returned: l.qty || 0,
      return_value: (Number(l.unit_price) || 0) * (Number(l.qty) || 0),
    })));
  }

  writeAuditLog({
    action: 'create',
    entity_type: 'ShopifyReturn',
    entity_id: returnId,
    description: `Created manual return ${returnNumber} for order ${order.order_number || order.id}`,
  });
  logWorkflowEvent({
    entityType: 'shopify_return', entityId: returnId, eventType: 'created', actor,
    description: `Manual return created from order ${order.order_number || order.id}`,
  });

  return returnId;
}
