/**
 * Suggest which open purchase order a supplier invoice belongs to.
 *
 * Two outputs:
 *   • exact  — a PO whose supplier_invoice_number already equals this invoice's
 *              number. This is the high-confidence, auto-linkable case (the PO
 *              pre-declared the invoice it expects, e.g. set on the PO before the
 *              Xero bill arrives). The caller links it silently.
 *   • ranked — scored candidate POs for the user to accept with one click, when
 *              there's no exact invoice-number match.
 *
 * Pure scoring (no I/O). The caller supplies the invoice and the candidate POs
 * (already fetched for the supplier).
 */
import { OPEN_PO_STATUSES } from './invoiceLinking';

// Statuses a PO may be in to be SILENTLY auto-linked by exact invoice number.
// Excludes 'invoiced' (already billed) so we never re-link a terminal-ish PO.
const AUTO_LINK_STATUSES = ['draft', 'awaiting_approval', 'approved', 'partially_received', 'received'];

const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };
const norm = (s) => (s == null ? '' : String(s)).trim().toLowerCase();

const daysBetween = (a, b) => {
  if (!a || !b) return null;
  const da = new Date(a).getTime();
  const db = new Date(b).getTime();
  if (!Number.isFinite(da) || !Number.isFinite(db)) return null;
  return Math.abs(da - db) / 86400000;
};

/** Score a single PO as a match for an invoice → { score (0–0.99), reasons[] }. */
export function scorePoForInvoice(invoice, po) {
  const reasons = [];
  let score = 0;

  // Total proximity — the strongest signal after the invoice number.
  const invTotal = num(invoice.total);
  const poTotal = num(po.total);
  if (invTotal > 0 && poTotal > 0) {
    const diff = Math.abs(invTotal - poTotal) / poTotal;
    if (diff <= 0.005) { score += 0.55; reasons.push('Total matches'); }
    else if (diff <= 0.05) { score += 0.38; reasons.push('Total within 5%'); }
    else if (diff <= 0.15) { score += 0.18; reasons.push('Total within 15%'); }
  }

  // Date proximity — an invoice usually lands near the order / expected date.
  const dOrder = daysBetween(invoice.invoice_date, po.order_date);
  const dExp = daysBetween(invoice.invoice_date, po.expected_date);
  const d = Math.min(dOrder == null ? Infinity : dOrder, dExp == null ? Infinity : dExp);
  if (Number.isFinite(d)) {
    if (d <= 7) { score += 0.20; reasons.push('Dates within a week'); }
    else if (d <= 30) { score += 0.10; reasons.push('Dates within a month'); }
    else if (d > 120) { score -= 0.10; }
  }

  // A PO that's received / partially received is actively awaiting its invoice.
  if (['received', 'partially_received'].includes(po.status)) {
    score += 0.12; reasons.push('Awaiting invoice');
  }

  // Already carries a DIFFERENT invoice number → likely already invoiced.
  const poInv = norm(po.supplier_invoice_number);
  if (poInv && poInv !== norm(invoice.invoice_number)) score -= 0.25;

  return { score: Math.max(0, Math.min(score, 0.99)), reasons };
}

/**
 * @param {object}  args
 * @param {object}  args.invoice  the supplier invoice
 * @param {array}   args.pos      candidate POs (already fetched for the supplier)
 * @returns {{ exact: object|null, ranked: Array<{po,score,reasons}> }}
 */
export function suggestPosForInvoice({ invoice, pos = [] }) {
  const open = (pos || []).filter((p) =>
    OPEN_PO_STATUSES.includes(p.status) && p.type !== 'blind_receipt'
  );

  const invNo = norm(invoice?.invoice_number);
  // Exact auto-link only to a PO that pre-declared this number AND is still
  // awaiting its invoice (not already 'invoiced'/terminal).
  const exact = invNo
    ? (open.find((p) =>
        AUTO_LINK_STATUSES.includes(p.status) &&
        norm(p.supplier_invoice_number) &&
        norm(p.supplier_invoice_number) === invNo) || null)
    : null;

  const ranked = open
    .filter((p) => p.id !== exact?.id)
    .map((p) => ({ po: p, ...scorePoForInvoice(invoice, p) }))
    .filter((x) => x.score >= 0.25)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);

  return { exact, ranked };
}
