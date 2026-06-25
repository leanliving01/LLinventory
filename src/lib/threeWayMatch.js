/**
 * Central three-way match engine (PO ↔ GRN ↔ Invoice).
 *
 * Pure, side-effect-free. Given a purchase order (+ lines), the confirmed
 * goods-received notes (+ lines) and a supplier invoice (+ lines), plus a
 * tolerance config, it computes a per-line and overall match result that drives
 * the "Approve for Payment" gate.
 *
 * The match answers three questions per invoice line:
 *   1. Price  — is the invoiced unit cost within tolerance of the PO unit cost?
 *   2. Qty    — is the invoiced qty ≤ received qty (you don't pay for more than
 *               arrived) within tolerance?
 *   3. Mapping — does the line correspond to a real PO/GRN line at all?
 *
 * Tolerances live in the `settings` table (group 'purchasing') so finance can
 * tune them without a code change. parseTolerances() reads them with safe
 * fallbacks to DEFAULT_MATCH_TOLERANCES.
 */

export const DEFAULT_MATCH_TOLERANCES = {
  pricePct: 2,    // ± % the invoiced unit cost may differ from the PO unit cost
  qtyOverPct: 0,  // % the invoiced qty may exceed the received qty
  valueAbs: 0.5,  // R rounding allowance applied to line/value comparisons
};

export const MATCH_SETTING_KEYS = {
  pricePct: 'match_price_tolerance_pct',
  qtyOverPct: 'match_qty_over_tolerance_pct',
  valueAbs: 'match_value_tolerance',
};

const EPS = 0.0001;
const CENT = 0.005; // per-unit rounding band for price comparison (half a cent)

const num = (v) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
};

const fmtQty = (n) => {
  if (n == null) return '—';
  const r = Math.round(num(n) * 1000) / 1000;
  return String(r);
};

/** Key an invoice/PO/GRN line by the product it represents. */
const keyOf = (l) =>
  (l && (l.product_id || l.supplier_product_id || (l.product_sku ? `sku:${l.product_sku}` : null))) || null;

/**
 * Read the tolerance config from an array of Setting rows (group 'purchasing').
 * Any missing/invalid value falls back to DEFAULT_MATCH_TOLERANCES.
 */
export function parseTolerances(settings = []) {
  const get = (key, def) => {
    const s = settings.find((x) => x.key === key);
    const n = s ? parseFloat(s.value) : NaN;
    return Number.isFinite(n) ? n : def;
  };
  return {
    pricePct: get(MATCH_SETTING_KEYS.pricePct, DEFAULT_MATCH_TOLERANCES.pricePct),
    qtyOverPct: get(MATCH_SETTING_KEYS.qtyOverPct, DEFAULT_MATCH_TOLERANCES.qtyOverPct),
    valueAbs: get(MATCH_SETTING_KEYS.valueAbs, DEFAULT_MATCH_TOLERANCES.valueAbs),
  };
}

export const OVERALL_STATUS_META = {
  matched:        { label: 'Fully Matched', tone: 'green',  blocking: false },
  price_variance: { label: 'Price Variance', tone: 'amber', blocking: true },
  qty_variance:   { label: 'Over-Billed',    tone: 'red',   blocking: true },
  total_variance: { label: 'Total Mismatch', tone: 'amber', blocking: true },
  unmatched:      { label: 'Unmatched Lines', tone: 'red',  blocking: true },
  no_po:          { label: 'No PO Linked',    tone: 'blue', blocking: true },
  no_grn:         { label: 'No GRN Linked',   tone: 'blue', blocking: true },
  not_checked:    { label: 'Not Checked',     tone: 'gray', blocking: true },
};

/**
 * Run the three-way match.
 *
 * @param {object}  args
 * @param {object?} args.po            linked purchase order (or null)
 * @param {array}   args.poLines       lines of that PO
 * @param {array}   args.grns          GRNs linked to the invoice/PO (any status)
 * @param {array}   args.grnLines      lines across those GRNs
 * @param {object}  args.invoice       the supplier invoice
 * @param {array}   args.invoiceLines  the invoice lines
 * @param {object}  args.tolerances    { pricePct, qtyOverPct, valueAbs }
 * @returns {object} { overallStatus, canApprove, hasPO, hasGRN, lines, exceptions, totals, tolerances }
 */
export function matchThreeWay({
  po = null,
  poLines = [],
  grns = [],
  grnLines = [],
  invoice = null,
  invoiceLines = [],
  tolerances = DEFAULT_MATCH_TOLERANCES,
} = {}) {
  const tol = { ...DEFAULT_MATCH_TOLERANCES, ...(tolerances || {}) };

  const confirmedGRNs = (grns || []).filter((g) => g.status === 'confirmed');
  const confirmedGrnIds = new Set(confirmedGRNs.map((g) => g.id));
  const hasPO = !!po;
  const hasGRN = confirmedGRNs.length > 0;

  // Index PO lines by product, AGGREGATING when a product spans several PO lines
  // (sum ordered qty; qty-weighted average unit cost) so split PO lines don't
  // desync the comparison or silently drop one line's quantity.
  const poByKey = {};
  (poLines || []).forEach((l) => {
    const k = keyOf(l);
    if (!k) return;
    const oq = num(l.ordered_qty);
    const uc = num(l.unit_cost);
    const w = oq > 0 ? oq : 0; // only positive qty weights the average; never negative
    const cur = poByKey[k] || { id: l.id, ordered_qty: 0, _costSum: 0, _costW: 0, _scSum: 0, _scN: 0 };
    cur.ordered_qty += oq;
    if (uc > 0) { cur._costSum += uc * w; cur._costW += w; cur._scSum += uc; cur._scN += 1; }
    poByKey[k] = cur;
  });
  // Weighted average over positive-qty lines; fall back to a plain average of the
  // positive unit costs when no positive qty exists (credit/amendment lines), so
  // a zero/negative-qty PO line never yields a garbage cost.
  Object.values(poByKey).forEach((p) => {
    p.unit_cost = p._costW > 0 ? p._costSum / p._costW : (p._scN > 0 ? p._scSum / p._scN : 0);
  });

  // Sum received qty (accepted only) across CONFIRMED GRNs, per product. A line
  // whose grn_id is null or not one of the confirmed GRNs is ignored — an orphan
  // line must never count as received goods.
  const grnByKey = {};
  (grnLines || []).forEach((l) => {
    if (confirmedGrnIds.size && !confirmedGrnIds.has(l.grn_id)) return;
    if (l.condition === 'rejected') return;
    const k = keyOf(l);
    if (!k) return;
    const cur = grnByKey[k] || { receivedQty: 0, unitCost: null };
    cur.receivedQty += num(l.received_qty);
    if (cur.unitCost == null && num(l.unit_cost) > 0) cur.unitCost = num(l.unit_cost);
    grnByKey[k] = cur;
  });

  // Aggregate invoiced qty per product across ALL invoice lines, so split
  // billing (the same product on two lines, each ≤ received but together over)
  // can't slip an over-bill past a per-line check.
  const invoicedByKey = {};
  (invoiceLines || []).forEach((il) => {
    const k = keyOf(il);
    if (k) invoicedByKey[k] = (invoicedByKey[k] || 0) + num(il.qty);
  });

  const lines = (invoiceLines || []).map((il) => {
    const k = keyOf(il);
    const poLine = k ? poByKey[k] : null;
    const grn = k ? grnByKey[k] : null;

    const orderedQty = poLine
      ? num(poLine.ordered_qty)
      : il.ordered_qty != null ? num(il.ordered_qty) : null;

    // Received qty is product-level. When a confirmed GRN exists, a product that
    // appears on NO confirmed GRN line was never received → 0 (you can't pay for
    // what never arrived). Only with no GRN at all do we fall back to a qty
    // pre-stamped on the invoice line.
    let receivedQty;
    if (hasGRN) receivedQty = grn ? grn.receivedQty : 0;
    else receivedQty = il.received_qty != null ? num(il.received_qty) : null;

    const invoicedQty = num(il.qty);                                  // this line only
    const invoicedTotal = k ? (invoicedByKey[k] || 0) : invoicedQty;  // product aggregate
    const poUnitCost = poLine
      ? num(poLine.unit_cost)
      : il.expected_unit_cost != null ? num(il.expected_unit_cost) : null;
    const invUnitCost = num(il.unit_cost);

    // Price check vs PO cost — percentage-based. A half-cent per-unit band (CENT)
    // absorbs float noise, but a large % is NEVER masked just because the line is
    // cheap (a 40% overcharge on a R0.05 item still flags).
    let priceVariancePct = null;
    let priceExceeds = false;
    let priceUnverifiable = false;
    if (poUnitCost != null && poUnitCost > 0) {
      priceVariancePct = ((invUnitCost - poUnitCost) / poUnitCost) * 100;
      priceExceeds = Math.abs(priceVariancePct) > tol.pricePct + EPS
        && Math.abs(invUnitCost - poUnitCost) > CENT;
    } else if (poLine && invUnitCost > CENT) {
      // A PO line exists but carries no usable cost to validate against. We can't
      // confirm the billed price, so don't auto-pass — flag it for manual review.
      priceExceeds = true;
      priceUnverifiable = true;
    }

    // Qty check — the product's TOTAL invoiced qty must not exceed received
    // beyond the % tolerance. The excess must also be worth more than the rand
    // rounding allowance (valueAbs), so sub-unit rounding doesn't trip the gate
    // while any financially-meaningful over-bill (incl. never-received goods) is
    // caught.
    let qtyOver = null;
    let qtyExceeds = false;
    if (receivedQty != null) {
      qtyOver = invoicedTotal - receivedQty;
      const allowedQty = Math.abs(receivedQty) * (tol.qtyOverPct / 100);
      const costBasis = (poUnitCost != null && poUnitCost > 0) ? poUnitCost : invUnitCost;
      const overRand = (qtyOver - allowedQty) * Math.max(costBasis, 0);
      qtyExceeds = qtyOver > allowedQty + EPS && overRand > tol.valueAbs;
    }

    const unmatched = !poLine && !grn;
    let lineStatus;
    if (unmatched) lineStatus = 'unmatched';
    else if (qtyExceeds) lineStatus = 'qty_variance';
    else if (priceExceeds) lineStatus = 'price_variance';
    else lineStatus = 'matched';

    return {
      key: k,
      invoice_line_id: il.id,
      po_line_id: poLine?.id || il.po_line_id || null,
      grn_line_id: il.grn_line_id || null,
      product_id: il.product_id || null,
      product_name: il.product_name || '',
      product_sku: il.product_sku || '',
      orderedQty,
      receivedQty,
      invoicedQty,
      invoicedTotal,
      poUnitCost,
      invUnitCost,
      priceVariancePct,
      priceExceeds,
      priceUnverifiable,
      qtyOver,
      qtyExceeds,
      hasPoLine: !!poLine,
      hasGrnLine: !!grn,
      lineStatus,
    };
  });

  // Header integrity — the invoice's own subtotal must agree with the sum of its
  // line items, so a tampered or garbled header total can't be paid. Skipped when
  // the invoice carries no subtotal (nothing to compare against).
  const lineExclSum = (invoiceLines || []).reduce((s, il) => s + num(il.qty) * num(il.unit_cost), 0);
  const invSubtotal = invoice ? num(invoice.subtotal) : 0;
  const headerVariance = Math.round((invSubtotal - lineExclSum) * 100) / 100;
  const headerExceeds = !!invoice && invSubtotal > 0 && Math.abs(headerVariance) > tol.valueAbs;

  // Overall status — most severe wins. An invoice with no lines can't be
  // vacuously "matched": there's nothing to verify, so it stays unapprovable.
  let overallStatus;
  if (!hasPO) overallStatus = 'no_po';
  else if (!hasGRN) overallStatus = 'no_grn';
  else if (lines.length === 0) overallStatus = 'unmatched';
  else if (lines.some((l) => l.lineStatus === 'unmatched')) overallStatus = 'unmatched';
  else if (lines.some((l) => l.lineStatus === 'qty_variance')) overallStatus = 'qty_variance';
  else if (lines.some((l) => l.lineStatus === 'price_variance')) overallStatus = 'price_variance';
  else if (headerExceeds) overallStatus = 'total_variance';
  else overallStatus = 'matched';

  const exceptions = [];
  const seenQtyKey = new Set();
  lines.forEach((l) => {
    if (l.lineStatus === 'qty_variance') {
      if (l.key && seenQtyKey.has(l.key)) return; // one exception per product
      if (l.key) seenQtyKey.add(l.key);
      const recv = l.receivedQty === 0 ? '0 (never received)' : fmtQty(l.receivedQty);
      exceptions.push({
        type: 'qty',
        line: l,
        message: `${l.product_name || 'Line'}: invoiced ${fmtQty(l.invoicedTotal)} but only ${recv} received (over by ${fmtQty(l.qtyOver)})`,
      });
    } else if (l.lineStatus === 'price_variance') {
      exceptions.push({
        type: 'price',
        line: l,
        message: l.priceUnverifiable
          ? `${l.product_name}: invoiced R${num(l.invUnitCost).toFixed(2)} but the PO has no price to verify against`
          : `${l.product_name}: invoiced R${num(l.invUnitCost).toFixed(2)} vs PO R${num(l.poUnitCost).toFixed(2)} (${l.priceVariancePct > 0 ? '+' : ''}${num(l.priceVariancePct).toFixed(1)}%)`,
      });
    } else if (l.lineStatus === 'unmatched') {
      exceptions.push({
        type: 'unmatched',
        line: l,
        message: `${l.product_name || 'Line'} is not on the linked PO or GRN`,
      });
    }
  });

  if (headerExceeds) {
    exceptions.push({
      type: 'total',
      message: `Invoice subtotal R${invSubtotal.toFixed(2)} doesn't match its line items (R${lineExclSum.toFixed(2)}) — off by R${Math.abs(headerVariance).toFixed(2)}`,
    });
  }

  const poTotal = hasPO ? num(po.total) : null;
  const grnTotal = hasGRN ? confirmedGRNs.reduce((s, g) => s + num(g.total_received_value), 0) : null;
  const invTotal = invoice ? num(invoice.total) : null;

  return {
    overallStatus,
    canApprove: overallStatus === 'matched',
    hasPO,
    hasGRN,
    confirmedGRNs,
    lines,
    exceptions,
    headerVariance,
    headerExceeds,
    totals: { poTotal, grnTotal, invTotal, lineExclSum },
    tolerances: tol,
  };
}
