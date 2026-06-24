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

  // Index PO lines by product.
  const poByKey = {};
  (poLines || []).forEach((l) => { const k = keyOf(l); if (k) poByKey[k] = l; });

  // Sum received qty (accepted only) across confirmed GRNs, per product.
  const grnByKey = {};
  (grnLines || []).forEach((l) => {
    if (confirmedGrnIds.size && l.grn_id && !confirmedGrnIds.has(l.grn_id)) return;
    if (l.condition === 'rejected') return;
    const k = keyOf(l);
    if (!k) return;
    const cur = grnByKey[k] || { receivedQty: 0, unitCost: null };
    cur.receivedQty += num(l.received_qty);
    if (cur.unitCost == null && num(l.unit_cost) > 0) cur.unitCost = num(l.unit_cost);
    grnByKey[k] = cur;
  });

  const lines = (invoiceLines || []).map((il) => {
    const k = keyOf(il);
    const poLine = k ? poByKey[k] : null;
    const grn = k ? grnByKey[k] : null;

    const orderedQty = poLine
      ? num(poLine.ordered_qty)
      : il.ordered_qty != null ? num(il.ordered_qty) : null;
    const receivedQty = grn
      ? grn.receivedQty
      : il.received_qty != null ? num(il.received_qty) : null;
    const invoicedQty = num(il.qty);
    const poUnitCost = poLine
      ? num(poLine.unit_cost)
      : il.expected_unit_cost != null ? num(il.expected_unit_cost) : null;
    const invUnitCost = num(il.unit_cost);

    // Price check vs PO cost. Only flagged when both the % and the rand impact
    // exceed tolerance, so a tiny % swing on a low-value line isn't noise.
    let priceVariancePct = null;
    let priceExceeds = false;
    if (poUnitCost != null && poUnitCost > 0) {
      priceVariancePct = ((invUnitCost - poUnitCost) / poUnitCost) * 100;
      const lineImpact = Math.abs(invUnitCost - poUnitCost) * Math.abs(invoicedQty || 0);
      priceExceeds = Math.abs(priceVariancePct) > tol.pricePct + EPS && lineImpact > tol.valueAbs;
    }

    // Qty check — invoiced must not exceed received beyond tolerance.
    let qtyOver = null;
    let qtyExceeds = false;
    if (receivedQty != null) {
      qtyOver = invoicedQty - receivedQty;
      const allowed = Math.abs(receivedQty) * (tol.qtyOverPct / 100);
      qtyExceeds = qtyOver > allowed + EPS;
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
      poUnitCost,
      invUnitCost,
      priceVariancePct,
      priceExceeds,
      qtyOver,
      qtyExceeds,
      hasPoLine: !!poLine,
      hasGrnLine: !!grn,
      lineStatus,
    };
  });

  // Overall status — most severe wins.
  let overallStatus;
  if (!hasPO) overallStatus = 'no_po';
  else if (!hasGRN) overallStatus = 'no_grn';
  else if (lines.some((l) => l.lineStatus === 'unmatched')) overallStatus = 'unmatched';
  else if (lines.some((l) => l.lineStatus === 'qty_variance')) overallStatus = 'qty_variance';
  else if (lines.some((l) => l.lineStatus === 'price_variance')) overallStatus = 'price_variance';
  else overallStatus = 'matched';

  const exceptions = [];
  lines.forEach((l) => {
    if (l.lineStatus === 'qty_variance') {
      exceptions.push({
        type: 'qty',
        line: l,
        message: `${l.product_name}: invoiced ${fmtQty(l.invoicedQty)} but only ${fmtQty(l.receivedQty)} received (over by ${fmtQty(l.qtyOver)})`,
      });
    } else if (l.lineStatus === 'price_variance') {
      exceptions.push({
        type: 'price',
        line: l,
        message: `${l.product_name}: invoiced R${num(l.invUnitCost).toFixed(2)} vs PO R${num(l.poUnitCost).toFixed(2)} (${l.priceVariancePct > 0 ? '+' : ''}${num(l.priceVariancePct).toFixed(1)}%)`,
      });
    } else if (l.lineStatus === 'unmatched') {
      exceptions.push({
        type: 'unmatched',
        line: l,
        message: `${l.product_name || 'Line'} is not on the linked PO or GRN`,
      });
    }
  });

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
    totals: { poTotal, grnTotal, invTotal },
    tolerances: tol,
  };
}
