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

// Decides whether a return row belongs in a given list tab.
export function matchesTab(r, tab) {
  switch (tab) {
    case 'all': return true;
    case 'courier_to_be_booked':
      return r.stock_path === 'expecting' && r.courier_responsibility === 'us'
        && r.courier_status === 'to_be_booked' && r.status === 'expected_return';
    case 'courier_booked':
      return r.courier_status === 'booked' && r.status === 'expected_return';
    case 'received_pending_qc':
      return r.status === 'received_pending_qc' || r.status === 'partially_received';
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
