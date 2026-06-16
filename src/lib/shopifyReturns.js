// Shared labels, colours, tab logic, and line aggregation for the customer
// Shopify Returns module. Used by the list page, detail page, and order view.

export const STATUS_LABELS = {
  draft_return: 'Draft Return',
  not_receiving_stock_back: 'Not Receiving Stock Back',
  expected_return: 'Expected Return',
  partially_received: 'Partially Received',
  received_pending_qc: 'Received — Pending QC',
  returned_to_stock: 'Returned to Stock',
  written_off: 'Written Off',
  partially_returned_partially_written_off: 'Partial Stock / Partial Write-Off',
  completed: 'Completed',
};

export const STATUS_COLORS = {
  draft_return: 'bg-slate-100 text-slate-700',
  not_receiving_stock_back: 'bg-rose-100 text-rose-700',
  expected_return: 'bg-amber-100 text-amber-700',
  partially_received: 'bg-amber-100 text-amber-700',
  received_pending_qc: 'bg-blue-100 text-blue-700',
  returned_to_stock: 'bg-emerald-100 text-emerald-700',
  written_off: 'bg-rose-100 text-rose-700',
  partially_returned_partially_written_off: 'bg-indigo-100 text-indigo-700',
  completed: 'bg-green-100 text-green-700',
};

export const COURIER_LABELS = {
  to_be_booked: 'To Be Booked',
  booked: 'Booked',
  in_transit: 'In Transit',
};

export const NOT_RECEIVING_REASONS = [
  { value: 'not_returned', label: 'Not returned by customer' },
  { value: 'perishable', label: 'Perishable product' },
  { value: 'cannot_resell', label: 'Cannot resell' },
  { value: 'refund_writeoff', label: 'Customer refund / write-off' },
  { value: 'damaged', label: 'Damaged' },
  { value: 'other', label: 'Other' },
];

export const CONDITIONS = [
  { value: 'unopened', label: 'Unopened' },
  { value: 'opened', label: 'Opened' },
  { value: 'damaged', label: 'Damaged' },
  { value: 'defective', label: 'Defective' },
  { value: 'expired', label: 'Expired' },
  { value: 'contaminated', label: 'Contaminated' },
];

// Per-item quality-check outcomes (Phase 5). Only `return_to_stock` increases
// sellable inventory; the "risky" set escalates the return to manager review.
export const QC_OUTCOMES = [
  { value: 'return_to_stock',     label: 'Approved — Return to Stock', stock: true },
  { value: 'write_off',           label: 'Write Off' },
  { value: 'damaged',             label: 'Damaged', risky: true },
  { value: 'opened',              label: 'Opened', risky: true },
  { value: 'expired',             label: 'Expired', risky: true },
  { value: 'incorrect_item',      label: 'Incorrect Item Returned' },
  { value: 'needs_manager_review',label: 'Needs Manager Review', risky: true },
  { value: 'other',               label: 'Other' },
];
export const RISKY_QC_OUTCOMES = QC_OUTCOMES.filter(o => o.risky).map(o => o.value);
export function qcOutcomeLabel(v) {
  return QC_OUTCOMES.find(o => o.value === v)?.label || v || '—';
}

export const EXCEPTION_STATUS_LABELS = {
  none: 'None', pending: 'Awaiting Manager Approval', approved: 'Approved', rejected: 'Rejected',
};
export const EXCEPTION_STATUS_COLORS = {
  none: 'bg-slate-100 text-slate-600',
  pending: 'bg-orange-100 text-orange-700',
  approved: 'bg-emerald-100 text-emerald-700',
  rejected: 'bg-rose-100 text-rose-700',
};

// --- Refund lens over returns (Phase 7) ------------------------------------
// A return participates in the refunds queue when a refund is intended/recorded.
export function hasRefund(r) {
  return (Number(r.refund_amount) || 0) > 0
    || ['refund', 'both'].includes(r.refund_decision)
    || !!r.shopify_refund_id;
}
export function refundCompleted(r) {
  return r.refund_status === 'paid' || !!r.refund_completed_at;
}
export function refundIsOpen(r) {
  return hasRefund(r) && !refundCompleted(r);
}

// --- Next action (drives the detail banner + dashboard CTA) -----------------
// Returns { label, blocked, reason } describing the single most relevant step.
export function nextAction(r) {
  if (!r) return null;
  if (r.exception_status === 'pending') {
    return { label: 'Resolve Manager Approval', blocked: true, reason: 'Awaiting manager approval' };
  }
  switch (r.status) {
    case 'draft_return':
      return { label: 'Approve Return' };
    case 'expected_return':
      if (r.courier_responsibility === 'us'
          && (!r.courier_status || r.courier_status === 'to_be_booked')) {
        return { label: 'Confirm Courier Booked' };
      }
      return { label: 'Receive Return' };
    case 'partially_received':
    case 'received_pending_qc':
      return { label: 'Complete Quality Check' };
    case 'returned_to_stock':
    case 'written_off':
    case 'partially_returned_partially_written_off':
      if (refundIsOpen(r)) return { label: 'Complete Refund' };
      return { label: 'Mark Completed' };
    case 'not_receiving_stock_back':
      if (refundIsOpen(r)) return { label: 'Complete Refund' };
      return { label: 'Mark Completed (Write-Off)' };
    case 'completed':
    default:
      return null;
  }
}

// Decides whether a return row belongs in a given list tab / dashboard queue.
export function matchesTab(r, tab) {
  switch (tab) {
    case 'all': return true;
    case 'courier_to_be_booked':
      return r.stock_path === 'expecting' && r.courier_responsibility === 'us'
        && (!r.courier_status || r.courier_status === 'to_be_booked') && r.status === 'expected_return';
    case 'courier_booked':
      return ['booked', 'in_transit', 'collected'].includes(r.courier_status) && r.status === 'expected_return';
    case 'awaiting_receival':
      // Expecting stock, ready to be received: customer-courier, or our courier booked.
      return r.stock_path === 'expecting' && r.status === 'expected_return'
        && (r.courier_responsibility === 'customer'
            || ['booked', 'in_transit', 'collected'].includes(r.courier_status));
    case 'received_pending_qc':
      return r.status === 'received_pending_qc' || r.status === 'partially_received';
    case 'qc_exceptions':
      return r.exception_status === 'pending';
    case 'awaiting_refund_decision':
      return ['received_pending_qc', 'returned_to_stock', 'written_off',
        'partially_returned_partially_written_off', 'not_receiving_stock_back'].includes(r.status)
        && (r.refund_decision === 'undecided' || !r.refund_decision);
    case 'open_refunds':
      return refundIsOpen(r);
    case 'completed_refunds':
      return refundCompleted(r);
    case 'returned_to_stock':
      return r.status === 'returned_to_stock' || r.status === 'partially_returned_partially_written_off';
    default:
      return r.status === tab;
  }
}

// Aggregates a return's lines into the totals the UI shows.
export function returnAggregates(lines) {
  const a = { qtyReturned: 0, qtyReceived: 0, qtyToStock: 0, qtyWrittenOff: 0, skus: '' };
  const skuSet = [];
  for (const l of lines) {
    a.qtyReturned += Number(l.qty_returned || 0);
    a.qtyReceived += Number(l.qty_received || 0);
    a.qtyToStock += Number(l.qty_to_stock || 0);
    a.qtyWrittenOff += Number(l.qty_written_off || 0);
    if (l.sku && !skuSet.includes(l.sku)) skuSet.push(l.sku);
  }
  a.skus = skuSet.join(', ');
  return a;
}
