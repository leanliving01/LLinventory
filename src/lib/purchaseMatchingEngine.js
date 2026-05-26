import { daysBetween } from './utils';

/**
 * Scores a candidate PurchaseOrder against a PurchaseInvoice for auto-match suggestion.
 *
 * Returns { score: number, reasons: Array } where score is 0–100.
 * A score >= 60 warrants showing a "Possible Match Found" banner.
 *
 * Scoring breakdown:
 *   +40  Supplier match (required — returns 0 immediately if supplier doesn't match)
 *   +30  Invoice total within 2% of PO total
 *   +15  Invoice total within 5% of PO total (only if not within 2%)
 *   +20  Invoice date within 7 days of PO order_date
 *   +10  Invoice date within 30 days of PO order_date (only if not within 7)
 *   +10  >50% of invoice lines share a product_id with PO lines
 *
 * @param {object} invoice      - PurchaseInvoice record
 * @param {object} po           - PurchaseOrder record
 * @param {Array}  invoiceLines - PurchaseInvoiceLine records for this invoice
 * @param {Array}  poLines      - PurchaseOrderLine records for this PO
 * @returns {{ score: number, reasons: Array<{key: string, label: string, points: number}> }}
 */
export function scoreInvoicePOMatch(invoice, po, invoiceLines = [], poLines = []) {
  if (!invoice || !po) return { score: 0, reasons: [] };

  // Supplier match is required — no suggestion if suppliers differ
  if (invoice.supplier_id !== po.supplier_id) return { score: 0, reasons: [] };

  let score = 40;
  const reasons = [
    { key: 'supplier', label: 'Same supplier', points: 40 },
  ];

  // Amount similarity
  const invoiceTotal = parseFloat(invoice.total) || 0;
  const poTotal = parseFloat(po.total) || 0;
  if (poTotal > 0) {
    const diffPct = Math.abs(invoiceTotal - poTotal) / poTotal;
    if (diffPct <= 0.02) {
      score += 30;
      reasons.push({ key: 'amount_close', label: 'Amount within 2%', points: 30 });
    } else if (diffPct <= 0.05) {
      score += 15;
      reasons.push({ key: 'amount_near', label: 'Amount within 5%', points: 15 });
    }
  }

  // Date proximity
  const invoiceDate = invoice.invoice_date;
  const poDate = po.order_date;
  if (invoiceDate && poDate) {
    const days = Math.abs(daysBetween(new Date(invoiceDate), new Date(poDate)));
    if (days <= 7) {
      score += 20;
      reasons.push({ key: 'date_close', label: 'Within 7 days of PO date', points: 20 });
    } else if (days <= 30) {
      score += 10;
      reasons.push({ key: 'date_near', label: 'Within 30 days of PO date', points: 10 });
    }
  }

  // Line similarity — product_id overlap
  if (invoiceLines.length > 0 && poLines.length > 0) {
    const invoiceProductIds = new Set(invoiceLines.map(l => l.product_id).filter(Boolean));
    const poProductIds = new Set(poLines.map(l => l.product_id).filter(Boolean));
    const intersection = [...invoiceProductIds].filter(id => poProductIds.has(id)).length;
    const union = new Set([...invoiceProductIds, ...poProductIds]).size;
    if (union > 0 && intersection / union > 0.5) {
      score += 10;
      reasons.push({ key: 'lines_similar', label: '>50% product overlap', points: 10 });
    }
  }

  return { score: Math.min(score, 100), reasons };
}

/**
 * Finds the best matching PO for an invoice from a list of candidate POs.
 * Returns the best match or null if no candidate reaches the threshold.
 *
 * @param {object} invoice       - PurchaseInvoice to match
 * @param {Array}  candidatePOs  - Array of open PurchaseOrder records
 * @param {Array}  invoiceLines  - Lines for this invoice
 * @param {Array}  allPOLines    - All PO lines (will be filtered by po_id per candidate)
 * @param {number} [threshold]   - Minimum score to suggest (default 60)
 * @returns {{ po: object, score: number, reasons: Array }|null}
 */
export function findBestPOMatch(invoice, candidatePOs, invoiceLines, allPOLines, threshold = 60) {
  if (!candidatePOs?.length) return null;

  let best = null;

  for (const po of candidatePOs) {
    const poLines = allPOLines.filter(l => l.purchase_order_id === po.id);
    const { score, reasons } = scoreInvoicePOMatch(invoice, po, invoiceLines, poLines);
    if (score >= threshold && (!best || score > best.score)) {
      best = { po, score, reasons };
    }
  }

  return best;
}
