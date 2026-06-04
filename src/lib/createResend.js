import { base44 } from '@/api/base44Client';
import { nextDocNumber } from '@/lib/docNumbering';
import { writeAuditLog } from '@/lib/auditLog';

// Creates a Draft Re-send from an existing sales order, copying customer/shipping
// snapshot and the order's active non-component lines as a starting point.
// Returns the new resend id. Reused by the order "Add Re-send" button, the
// "New Re-send" modal, and "Create Re-send from this return".
export async function createResendFromOrder(salesOrderId, { returnId = null } = {}) {
  const orders = await base44.entities.SalesOrder.filter({ id: salesOrderId });
  const order = orders[0];
  if (!order) throw new Error('Order not found');

  const lines = await base44.entities.SalesOrderLine.filter({ sales_order_id: salesOrderId }, 'name', 500);
  const sourceLines = lines.filter(l => !l.is_package_component && l.status === 'active');

  const resendNumber = await nextDocNumber('RSN');
  const resendId = crypto.randomUUID();

  await base44.entities.SalesResend.create({
    id: resendId,
    resend_number: resendNumber,
    sales_order_id: order.id,
    shopify_order_id: order.shopify_order_id || null,
    order_number: order.order_number || null,
    customer_name: order.customer_name || null,
    customer_email: order.customer_email || null,
    customer_phone: order.customer_phone || null,
    customer_address: order.customer_address || null,
    shipping_city: order.shipping_city || null,
    shipping_province: order.shipping_province || null,
    shipping_zip: order.shipping_zip || null,
    shipping_country: order.shipping_country || null,
    linked_return_id: returnId,
    status: 'draft',
    stock_deducted: false,
  });

  if (sourceLines.length) {
    await base44.entities.SalesResendLine.bulkCreate(sourceLines.map(l => ({
      id: crypto.randomUUID(),
      resend_id: resendId,
      sales_order_line_id: l.id,
      product_id: l.our_product_id || null,
      sku: l.sku || null,
      product_name: l.name || null,
      variant_title: l.variant_title || null,
      is_package_parent: !!l.is_package_parent,
      line_type: l.line_type || null,
      qty: l.qty || 0,
      unit_price: l.unit_price || 0,
    })));
  }

  // If linked to a return, record the reverse link on the return too.
  if (returnId) {
    try { await base44.entities.ShopifyReturn.update(returnId, { linked_resend_id: resendId }); } catch { /* non-fatal */ }
  }

  writeAuditLog({
    action: 'create',
    entity_type: 'SalesResend',
    entity_id: resendId,
    description: `Created re-send ${resendNumber} for order ${order.order_number || order.id}`,
  });

  return resendId;
}
