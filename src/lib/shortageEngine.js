import { base44 } from '@/api/base44Client';

/**
 * Central supplier-shortage engine.
 *
 * Rule: exactly ONE shortage record per purchase-order line item. Every screen
 * (GRN, invoice, credit note, return, tracking) must read from and write to the
 * same row via these helpers. Uniqueness is enforced here (app-level upsert),
 * keyed on po_line_id with a (purchase_order_id + product_id) fallback.
 */

export function computeShortageValue(shortQty, unitCost) {
  return Math.round((parseFloat(shortQty) || 0) * (parseFloat(unitCost) || 0) * 100) / 100;
}

/**
 * Human-readable status for a shortage, derived from the decision that was made
 * at the GRN/invoice step (no manual button needed). Returns { label, tone }.
 * tone ∈ 'amber' | 'blue' | 'green' | 'gray'.
 */
export function shortageStatusLabel(s) {
  if (!s) return { label: '—', tone: 'gray' };
  if (s.status === 'resolved' || s.status === 'credit_received') return { label: 'Resolved', tone: 'green' };
  if (s.status === 'cancelled' || s.status === 'written_off') return { label: 'Cancelled', tone: 'gray' };
  if (s.status === 'partially_credited') return { label: 'Partially credited', tone: 'amber' };
  switch (s.decision) {
    case 'request_credit': return { label: 'Awaiting credit note', tone: 'amber' };
    case 'await_receival':  return { label: 'Awaiting remaining receival', tone: 'blue' };
    case 'split':           return { label: 'Split — part await / part credit', tone: 'amber' };
    case 'review':          return { label: 'Marked for review', tone: 'gray' };
    default:
      if (s.credit_follow_up_status === 'credit_required') return { label: 'Awaiting credit note', tone: 'amber' };
      return { label: 'Open', tone: 'amber' };
  }
}

/**
 * Find the existing central shortage for a PO line, if any.
 * Tries po_line_id first, then falls back to (purchase_order_id + product_id)
 * so records created before po_line_id was populated are still matched.
 */
export async function findShortageForPOLine({ poLineId, purchaseOrderId, productId }) {
  if (poLineId) {
    const byLine = await base44.entities.SupplierShortage.filter({ po_line_id: poLineId }, '-created_date', 5);
    if (byLine.length) return byLine[0];
  }
  if (purchaseOrderId && productId) {
    const byProduct = await base44.entities.SupplierShortage.filter(
      { purchase_order_id: purchaseOrderId, product_id: productId }, '-created_date', 5
    );
    if (byProduct.length) return byProduct[0];
  }
  return null;
}

/**
 * Upsert the central shortage record for a PO line.
 * - If a record already exists for this line, it is UPDATED (never duplicated).
 * - Otherwise a new record is created.
 *
 * `fields` are written as-is; shortage_qty / shortage_value are derived from
 * ordered_qty - received_qty when not explicitly supplied.
 *
 * @returns the upserted shortage record
 */
export async function upsertShortage({ poLineId, purchaseOrderId, productId, ...fields }) {
  // Derive shortage qty/value if the caller passed ordered/received but not the deltas
  const derived = { ...fields };
  if (derived.shortage_qty == null && derived.ordered_qty != null && derived.received_qty != null) {
    derived.shortage_qty = Math.max(0, (parseFloat(derived.ordered_qty) || 0) - (parseFloat(derived.received_qty) || 0));
  }
  if (derived.shortage_value == null && derived.shortage_qty != null) {
    derived.shortage_value = computeShortageValue(derived.shortage_qty, derived.unit_cost);
  }

  const existing = await findShortageForPOLine({ poLineId, purchaseOrderId, productId });

  if (existing) {
    // Don't overwrite a stronger identity with nulls — only set keys we actually have
    const payload = { ...derived };
    if (poLineId) payload.po_line_id = poLineId;
    if (purchaseOrderId) payload.purchase_order_id = purchaseOrderId;
    return base44.entities.SupplierShortage.update(existing.id, payload);
  }

  return base44.entities.SupplierShortage.create({
    po_line_id: poLineId || null,
    purchase_order_id: purchaseOrderId || null,
    product_id: productId,
    ...derived,
  });
}

/**
 * Resolve the central shortage for a PO line when no credit/stock is outstanding
 * (e.g. the supplier only invoiced for what was received, or the remainder arrived).
 * No-op if there is no shortage record.
 */
export async function resolveShortageIfNoneNeeded(poLineId, { resolution_notes } = {}) {
  if (!poLineId) return null;
  const existing = await findShortageForPOLine({ poLineId });
  if (!existing) return null;
  return base44.entities.SupplierShortage.update(existing.id, {
    status: 'resolved',
    credit_follow_up_status: 'cancelled',
    resolution_date: new Date().toISOString().slice(0, 10),
    resolution_notes: resolution_notes || 'Auto-resolved — no outstanding stock or credit required',
  });
}
