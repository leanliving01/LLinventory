// Single source of truth for Purchase Order "smart folder" classification.
// Shared by SmartFolderNav (folder counts) and PurchaseOrders (table filter)
// so the two can never drift.
//
// 7 folders:
//   all               – every live PO (cancelled excluded)
//   draft             – not yet submitted
//   awaiting_approval – submitted, waiting for sign-off
//   open              – approved & in progress: awaiting receipt, partially/short
//                       received, awaiting invoice, or awaiting payment
//   needs_review      – data issues needing a human: qty adjustment / price variance
//   credit_returns    – credit notes pending or supplier returns in progress
//   completed         – goods fully received + invoice matched, nothing outstanding
//
// "Completed" deliberately does NOT require payment: supplier payments are tracked
// on the invoice side via payment terms, not on the PO.

export const PO_FOLDERS = [
  { key: 'all',               label: 'All Purchase Orders',    badge: null },
  { key: 'draft',             label: 'Drafts',                 badge: null },
  { key: 'awaiting_approval', label: 'Awaiting Approval',      badge: 'amber' },
  { key: 'open',              label: 'Open',                   badge: 'amber' },
  { key: 'needs_review',      label: 'Needs Review',           badge: 'red' },
  { key: 'credit_returns',    label: 'Credit Notes & Returns', badge: 'red' },
  { key: 'completed',         label: 'Completed',              badge: null },
];

export const PO_FOLDER_KEYS = PO_FOLDERS.map(f => f.key);

// Goods fully received AND an invoice is attached (partial/short receipts stay 'partially_received').
const INVOICED_STATUSES = ['invoiced', 'paid'];
const APPROVED_INVOICE_STATUSES = ['matched', 'approved', 'paid'];

// Build lookup indexes once from the raw data sets, then reuse for every PO.
export function buildPoFolderContext({
  grns = [],
  invoices = [],
  creditNotes = [],
  returns = [],
  posNeedingAttention = new Set(),
} = {}) {
  const grnByPo = {};
  const priceVariancePo = new Set();
  grns.forEach(g => {
    if (!grnByPo[g.purchase_order_id]) grnByPo[g.purchase_order_id] = [];
    grnByPo[g.purchase_order_id].push(g);
    if (g.has_price_variance && g.purchase_order_id) priceVariancePo.add(g.purchase_order_id);
  });

  const invoiceByPo = {};
  invoices.forEach(i => {
    if (!invoiceByPo[i.purchase_order_id]) invoiceByPo[i.purchase_order_id] = [];
    invoiceByPo[i.purchase_order_id].push(i);
  });

  const openCreditNotePo = new Set();
  creditNotes.forEach(cn => {
    if (cn.status === 'open' && cn.purchase_order_id) openCreditNotePo.add(cn.purchase_order_id);
  });

  const pendingReturnPo = new Set();
  returns.forEach(r => {
    // supplier_returns links to the PO via `po_id`
    const poId = r.po_id || r.purchase_order_id;
    if (['pending_return', 'pending_credit'].includes(r.status) && poId) pendingReturnPo.add(poId);
  });

  return { grnByPo, invoiceByPo, priceVariancePo, openCreditNotePo, pendingReturnPo, posNeedingAttention };
}

function hasApprovedInvoice(po, ctx) {
  return (ctx.invoiceByPo[po.id] || []).some(
    i => APPROVED_INVOICE_STATUSES.includes(i.status) || i.payment_status === 'paid'
  );
}

export function hasOpenCreditNote(po, ctx) {
  return po.status === 'credit_note_pending' || ctx.openCreditNotePo.has(po.id);
}

export function hasPendingReturn(po, ctx) {
  return ctx.pendingReturnPo.has(po.id);
}

// An unresolved credit note or return means the PO still has something outstanding.
export function isCreditOrReturn(po, ctx) {
  return hasOpenCreditNote(po, ctx) || hasPendingReturn(po, ctx);
}

export function isCompleted(po, ctx) {
  if (isCreditOrReturn(po, ctx)) return false;            // outstanding credit/return → not done
  if (INVOICED_STATUSES.includes(po.status)) return true; // received + invoiced (payment not required)
  if (po.status === 'received' && hasApprovedInvoice(po, ctx)) return true;
  return false;
}

export function isNeedsReview(po, ctx) {
  return ctx.posNeedingAttention.has(po.id) || ctx.priceVariancePo.has(po.id);
}

export function isOpen(po, ctx) {
  if (['draft', 'awaiting_approval', 'cancelled', 'credit_note_pending'].includes(po.status)) return false;
  return !isCompleted(po, ctx); // approved / partially received / received / awaiting-invoice / unpaid
}

// folderKey + optional credit/return sub-filter: 'all' | 'credit_notes' | 'returns'
export function matchesFolder(po, folderKey, ctx, subFilter = 'all') {
  switch (folderKey) {
    case 'all':               return po.status !== 'cancelled';
    case 'draft':             return po.status === 'draft';
    case 'awaiting_approval': return po.status === 'awaiting_approval';
    case 'open':              return isOpen(po, ctx);
    case 'needs_review':      return isNeedsReview(po, ctx);
    case 'completed':         return isCompleted(po, ctx);
    case 'credit_returns': {
      if (subFilter === 'credit_notes') return hasOpenCreditNote(po, ctx);
      if (subFilter === 'returns')      return hasPendingReturn(po, ctx);
      return isCreditOrReturn(po, ctx);
    }
    default: return true;
  }
}

export function folderCounts(pos, ctx) {
  const c = {};
  PO_FOLDER_KEYS.forEach(k => { c[k] = 0; });
  pos.forEach(po => {
    PO_FOLDER_KEYS.forEach(k => {
      if (matchesFolder(po, k, ctx, 'all')) c[k] += 1;
    });
  });
  return c;
}
