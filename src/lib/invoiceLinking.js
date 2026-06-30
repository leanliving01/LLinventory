/**
 * Canonical "link a supplier invoice to a purchase order" operation.
 *
 * Every link path — the manual Match-to-PO modal, the upcoming Xero auto-match,
 * the create-invoice-from-PO button and blind receipts — should call THIS so the
 * side effects stay identical no matter the entry door:
 *
 *   1. sets purchase_invoices.purchase_order_id (+ grn_id from the PO's latest
 *      confirmed GRN, so the GRN Details tab lights up),
 *   2. backfills each invoice line's ordered/received qty + po_line_id/grn_line_id
 *      by product, so the Order/GRN columns render without a recompute (the live
 *      three-way match still aggregates from PO+GRN data — this is display state),
 *   3. advances the PO status (received / partially_received → invoiced), never
 *      regressing, and stamps supplier_invoice_number so the invoice-number
 *      auto-match can recognise this pairing next time,
 *   4. invalidates the relevant caches when a queryClient is supplied.
 *
 * Pure data layer (no React/JSX) so it can be called from modals, edge-triggered
 * flows, or scripts alike.
 */
import { base44 } from '@/api/base44Client';

/** PO statuses that mean "open / awaiting an invoice" (real schema enum — the
 *  old MatchInvoiceToPOModal list had 'pending_approval'/'sent' which don't exist). */
export const OPEN_PO_STATUSES = [
  'draft', 'awaiting_approval', 'approved', 'partially_received', 'received', 'invoiced',
];

const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };

/** Key a line by the product it represents (mirrors threeWayMatch.keyOf). */
const keyOf = (l) =>
  (l && (l.product_id || l.supplier_product_id || (l.product_sku ? `sku:${l.product_sku}` : null))) || null;

const first = (rows) => (Array.isArray(rows) && rows.length ? rows[0] : null);

/**
 * @param {object}  args
 * @param {string}  args.invoiceId
 * @param {string}  args.poId
 * @param {object?} args.queryClient  optional react-query client to invalidate
 * @returns {Promise<{ grnId: string|null, status: string }>}
 */
export async function linkInvoiceToPO({ invoiceId, poId, queryClient = null }) {
  if (!invoiceId || !poId) throw new Error('linkInvoiceToPO requires invoiceId and poId');

  const [invoice, po] = await Promise.all([
    base44.entities.PurchaseInvoice.filter({ id: invoiceId }).then(first),
    base44.entities.PurchaseOrder.filter({ id: poId }).then(first),
  ]);
  if (!invoice) throw new Error('Invoice not found');
  if (!po) throw new Error('Purchase order not found');

  const [invoiceLines, poLines, grns] = await Promise.all([
    base44.entities.PurchaseInvoiceLine.filter({ invoice_id: invoiceId }, 'created_date', 1000),
    base44.entities.PurchaseOrderLine.filter({ purchase_order_id: poId }, 'created_date', 1000),
    base44.entities.GoodsReceivedNote.filter({ purchase_order_id: poId }, '-received_date', 100),
  ]);

  const confirmedGRNs = (grns || []).filter((g) => g.status === 'confirmed');
  const primaryGrn = confirmedGRNs[0] || null; // latest confirmed (sorted desc by received_date)
  const grnLines = confirmedGRNs.length
    ? (await Promise.all(confirmedGRNs.map((g) =>
        base44.entities.GRNLine.filter({ grn_id: g.id }, 'created_date', 1000)))).flat()
    : [];

  // Aggregate PO ordered qty + GRN received qty per product key.
  const poByKey = {};
  (poLines || []).forEach((l) => {
    const k = keyOf(l); if (!k) return;
    const cur = poByKey[k] || { id: l.id, ordered_qty: 0 };
    cur.ordered_qty += num(l.ordered_qty);
    poByKey[k] = cur;
  });
  const grnByKey = {};
  (grnLines || []).forEach((l) => {
    if (l.condition === 'rejected') return;
    const k = keyOf(l); if (!k) return;
    const cur = grnByKey[k] || { id: l.id, received_qty: 0 };
    cur.received_qty += num(l.received_qty);
    grnByKey[k] = cur;
  });

  // 1. Backfill invoice lines (display convenience; match recomputes live).
  //    Done BEFORE the header link so the invoice isn't marked linked until the
  //    rest succeeds — a mid-flow failure leaves it cleanly unlinked + retryable.
  const hasGRN = confirmedGRNs.length > 0;
  for (const il of (invoiceLines || [])) {
    const k = keyOf(il);
    const poLine = k ? poByKey[k] : null;
    const grn = k ? grnByKey[k] : null;
    if (!poLine && !grn) continue;
    const patch = {};
    if (poLine) { patch.ordered_qty = poLine.ordered_qty; patch.po_line_id = poLine.id; }
    if (hasGRN) {
      const received = grn ? grn.received_qty : 0; // on a confirmed GRN, no line = never received
      patch.received_qty = received;
      if (grn) patch.grn_line_id = grn.id;
      patch.qty_variance = num(il.qty) - received;
    }
    if (Object.keys(patch).length) {
      try { await base44.entities.PurchaseInvoiceLine.update(il.id, patch); }
      catch { /* non-fatal: display backfill only */ }
    }
  }

  // 2. Advance PO status (never regress) + stamp expected invoice number.
  const poPatch = {};
  if (['received', 'partially_received'].includes(po.status)) poPatch.status = 'invoiced';
  if (!po.supplier_invoice_number && invoice.invoice_number) {
    poPatch.supplier_invoice_number = invoice.invoice_number;
  }
  if (Object.keys(poPatch).length) {
    try { await base44.entities.PurchaseOrder.update(poId, poPatch); }
    catch { /* non-fatal */ }
  }

  // 3. Header link LAST — this is the write that marks the invoice "linked".
  //    grn_id explicitly nulled when the PO has no confirmed GRN.
  await base44.entities.PurchaseInvoice.update(invoiceId, {
    purchase_order_id: poId,
    grn_id: primaryGrn ? primaryGrn.id : null,
  });

  // 4. Invalidate caches.
  if (queryClient) {
    ['purchase-invoices', 'purchase-invoices-for-queue', 'purchase-orders',
     'po', 'po-lines', 'invoice-lines', 'grns'].forEach((k) =>
      queryClient.invalidateQueries({ queryKey: [k] }));
  }

  return { grnId: primaryGrn?.id || null, status: poPatch.status || po.status };
}
