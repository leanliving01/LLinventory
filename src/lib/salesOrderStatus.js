// Single source of truth for sales-order status display across the list row,
// the detail page header, and the inline expansion. Extracted from
// SalesOrderRow so list / detail / row never drift.

export const lifecycleColors = {
  pending_payment:  'bg-yellow-100 text-yellow-700 border-yellow-200',
  paid_unfulfilled: 'bg-orange-100 text-orange-700 border-orange-200',
  fulfilled:        'bg-green-100 text-green-700 border-green-200',
  cancelled:        'bg-red-100 text-red-700 border-red-200',
  refunded:         'bg-purple-100 text-purple-700 border-purple-200',
};

export const lifecycleLabels = {
  pending_payment:  'Pending Payment',
  paid_unfulfilled: 'Awaiting Fulfilment',
  fulfilled:        'Fulfilled',
  cancelled:        'Cancelled',
  refunded:         'Refunded',
};

export const packStatusColors = {
  pending:   'bg-slate-100 text-slate-600',
  picking:   'bg-blue-100 text-blue-700',
  packed:    'bg-indigo-100 text-indigo-700',
  shipped:   'bg-green-100 text-green-700',
  cancelled: 'bg-red-100 text-red-600',
  refunded:  'bg-red-100 text-red-600',
};

export const packStatusLabels = {
  pending:   'Not Packed',
  picking:   'Busy Packing',
  packed:    'Packed',
  shipped:   'Shipped',
  cancelled: 'Cancelled',
  refunded:  'Refunded',
};

// Separate, readable status dimensions ---------------------------------------
export const paymentColors = {
  paid:               'bg-green-100 text-green-700 border-green-200',
  pending:            'bg-yellow-100 text-yellow-700 border-yellow-200',
  unpaid:             'bg-yellow-100 text-yellow-700 border-yellow-200',
  partially_paid:     'bg-amber-100 text-amber-700 border-amber-200',
  authorized:         'bg-sky-100 text-sky-700 border-sky-200',
  partially_refunded: 'bg-fuchsia-100 text-fuchsia-700 border-fuchsia-200',
  refunded:           'bg-purple-100 text-purple-700 border-purple-200',
  voided:             'bg-slate-100 text-slate-600 border-slate-200',
};
export const paymentLabels = {
  paid: 'Paid', pending: 'Unpaid', unpaid: 'Unpaid', partially_paid: 'Partially Paid',
  authorized: 'Authorized', partially_refunded: 'Partially Refunded',
  refunded: 'Refunded', voided: 'Voided',
};

export const fulfilmentColors = {
  unfulfilled: 'bg-orange-100 text-orange-700 border-orange-200',
  partial:     'bg-amber-100 text-amber-700 border-amber-200',
  fulfilled:   'bg-green-100 text-green-700 border-green-200',
  restocked:   'bg-slate-100 text-slate-600 border-slate-200',
};
export const fulfilmentLabels = {
  unfulfilled: 'Unfulfilled', partial: 'Partially Fulfilled',
  fulfilled: 'Fulfilled', restocked: 'Restocked',
};

export const channelLabels = {
  shopify: 'Shopify', manual: 'Manual', retail: 'Retail', internal: 'Internal', wholesale: 'Wholesale',
};
export const channelColors = {
  shopify:   'bg-emerald-100 text-emerald-700 border-emerald-200',
  manual:    'bg-slate-100 text-slate-700 border-slate-200',
  retail:    'bg-cyan-100 text-cyan-700 border-cyan-200',
  internal:  'bg-violet-100 text-violet-700 border-violet-200',
  wholesale: 'bg-indigo-100 text-indigo-700 border-indigo-200',
};

// Primary external reference shown to users.
export function orderRef(order) {
  if (!order) return '';
  if (order.order_source && order.order_source !== 'shopify') {
    return order.internal_order_number || order.order_number || order.id;
  }
  return order.order_number || order.shopify_order_id || order.id;
}

export function sectionProgress(order) {
  const part = (status, label) => (status ? `${label} ${status === 'done' ? '✓' : 'in progress'}` : null);
  return [part(order.sup_status, 'Supplements'), part(order.mea_status, 'Meals')].filter(Boolean).join(' · ');
}

export function formatDuration(seconds) {
  if (!seconds || seconds <= 0) return null;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}m ${s}s`;
}

export function getPackLabel(order) {
  if (order.lifecycle_state !== 'paid_unfulfilled') {
    return lifecycleLabels[order.lifecycle_state] || order.lifecycle_state;
  }
  const base = packStatusLabels[order.status] || 'Awaiting Fulfilment';
  if (order.status === 'picking') {
    const secs = sectionProgress(order);
    const label = order.packing_paused ? 'Busy Packing (Paused)' : 'Busy Packing';
    return secs ? `${label} — ${secs}` : label;
  }
  if (order.status === 'packed') {
    const dur = formatDuration(order.packing_duration_seconds);
    return dur ? `${base} · ${dur}` : base;
  }
  return base;
}

export function getPackColor(order) {
  if (order.lifecycle_state !== 'paid_unfulfilled' || order.status === 'pending') {
    return order.lifecycle_state === 'paid_unfulfilled'
      ? (packStatusColors[order.status] || lifecycleColors[order.lifecycle_state] || '')
      : (lifecycleColors[order.lifecycle_state] || '');
  }
  if (order.status === 'picking') {
    if (order.packing_paused) return 'bg-orange-100 text-orange-700';
    if (order.sup_status === 'done' || order.mea_status === 'done') return 'bg-amber-100 text-amber-700';
    return 'bg-blue-100 text-blue-700';
  }
  return packStatusColors[order.status] || lifecycleColors[order.lifecycle_state] || '';
}

/**
 * Derive the separate status badges for an order.
 * @param {object} order
 * @param {{ returnsCount?: number, refundLineCount?: number }} [flags]
 * @returns {Array<{ key: string, label: string, className: string }>}
 */
export function deriveOrderBadges(order, flags = {}) {
  if (!order) return [];
  const badges = [];
  const isCancelled = order.lifecycle_state === 'cancelled' || order.status === 'cancelled';

  // Operational / lifecycle (uses the rich pack label for in-progress packing).
  badges.push({ key: 'operational', label: getPackLabel(order), className: getPackColor(order) });

  // Payment
  if (order.payment_status) {
    badges.push({
      key: 'payment',
      label: paymentLabels[order.payment_status] || order.payment_status,
      className: paymentColors[order.payment_status] || 'bg-slate-100 text-slate-600 border-slate-200',
    });
  }

  // Fulfilment
  if (order.fulfillment_status) {
    badges.push({
      key: 'fulfilment',
      label: fulfilmentLabels[order.fulfillment_status] || order.fulfillment_status,
      className: fulfilmentColors[order.fulfillment_status] || 'bg-slate-100 text-slate-600 border-slate-200',
    });
  }

  // Refund (financial refund lines or returns present, or payment refunded)
  const refundLines = Number(flags.refundLineCount || 0);
  const returns = Number(flags.returnsCount || 0);
  if (order.payment_status === 'refunded') {
    badges.push({ key: 'refund', label: 'Refunded', className: paymentColors.refunded });
  } else if (order.payment_status === 'partially_refunded' || refundLines > 0) {
    badges.push({ key: 'refund', label: 'Partially Refunded', className: paymentColors.partially_refunded });
  }
  if (returns > 0) {
    badges.push({ key: 'returns', label: `${returns} Return${returns > 1 ? 's' : ''}`, className: 'bg-rose-100 text-rose-700 border-rose-200' });
  }

  // Cancellation
  if (isCancelled) {
    badges.push({ key: 'cancelled', label: 'Cancelled', className: lifecycleColors.cancelled });
  }

  return badges;
}
