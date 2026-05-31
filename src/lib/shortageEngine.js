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
/**
 * Resolution "kind" of a shortage, derived from its decision. A PO line can hold at
 * most one shortage of each kind, so a split (await + credit) becomes two records
 * that resolve independently — the await one when the stock arrives, the credit one
 * when the supplier credit note is allocated.
 */
export function shortageKind(decision) {
  if (decision === 'request_credit') return 'credit';
  if (decision === 'await_receival' || decision === 'receive_later') return 'await';
  if (decision === 'review') return 'review';
  return 'other';
}

/**
 * Find an existing shortage for a PO line, optionally of a specific kind.
 * Tries po_line_id first, then falls back to (purchase_order_id + product_id).
 */
export async function findShortageForPOLine({ poLineId, purchaseOrderId, productId, kind }) {
  let candidates = [];
  if (poLineId) {
    candidates = await base44.entities.SupplierShortage.filter({ po_line_id: poLineId }, '-created_date', 20);
  }
  if (!candidates.length && purchaseOrderId && productId) {
    candidates = await base44.entities.SupplierShortage.filter(
      { purchase_order_id: purchaseOrderId, product_id: productId }, '-created_date', 20
    );
  }
  if (!candidates.length) return null;
  if (kind) {
    return candidates.find(s => shortageKind(s.decision) === kind) || null;
  }
  return candidates[0];
}

/**
 * Upsert a shortage record for a PO line, scoped to its resolution kind.
 * - Updates the existing record of the SAME kind for this line, else creates one.
 * - A split therefore produces one 'await' and one 'credit' record (different kinds).
 *
 * `fields` are written as-is; shortage_qty / shortage_value are derived from
 * ordered_qty - received_qty when not explicitly supplied.
 */
export async function upsertShortage({ poLineId, purchaseOrderId, productId, ...fields }) {
  const derived = { ...fields };
  if (derived.shortage_qty == null && derived.ordered_qty != null && derived.received_qty != null) {
    derived.shortage_qty = Math.max(0, (parseFloat(derived.ordered_qty) || 0) - (parseFloat(derived.received_qty) || 0));
  }
  if (derived.shortage_value == null && derived.shortage_qty != null) {
    derived.shortage_value = computeShortageValue(derived.shortage_qty, derived.unit_cost);
  }

  const kind = shortageKind(derived.decision);
  const existing = await findShortageForPOLine({ poLineId, purchaseOrderId, productId, kind });

  if (existing) {
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
 * Quantity per PO line that is being handled via credit (so it is NOT expected as
 * incoming stock). Counts open credit shortages, plus the credit portion of any
 * legacy 'split' records. Returns a map { [po_line_id]: qty }.
 */
export function creditCommittedByPoLine(shortages = []) {
  const m = {};
  shortages.forEach(s => {
    if (!s.po_line_id) return;
    if (['resolved', 'cancelled'].includes(s.status)) return;
    let qty = 0;
    if (s.decision === 'request_credit') qty = parseFloat(s.shortage_qty) || 0;
    else if (s.decision === 'split') qty = parseFloat(s.credit_qty) || 0;
    if (qty > 0) m[s.po_line_id] = (m[s.po_line_id] || 0) + qty;
  });
  return m;
}

/**
 * After a GRN is confirmed, reconcile the PO's lines:
 *  - keep each PO line's received_qty accurate (sum of confirmed GRN receipts)
 *  - auto-resolve any "await remaining receival" shortage whose line is now fully received
 * Safe to call after every confirm; idempotent and does not touch PO status.
 */
export async function reconcileAwaitShortages(purchaseOrderId) {
  if (!purchaseOrderId) return;
  const poLines = await base44.entities.PurchaseOrderLine.filter({ purchase_order_id: purchaseOrderId }, 'created_date', 200);
  const grns = await base44.entities.GoodsReceivedNote.filter({ purchase_order_id: purchaseOrderId, status: 'confirmed' }, '-received_date', 50);

  let grnLines = [];
  if (grns.length) {
    const chunks = await Promise.all(grns.map(g => base44.entities.GRNLine.filter({ grn_id: g.id }, 'product_name', 200)));
    grnLines = chunks.flat();
  }
  const receivedByPoLine = {};
  grnLines.forEach(l => {
    if (l.po_line_id) receivedByPoLine[l.po_line_id] = (receivedByPoLine[l.po_line_id] || 0) + (parseFloat(l.received_qty) || 0);
  });

  // Credit-committed qty is NOT expected as stock, so the stock obligation for a line
  // is ordered - credit. The await shortage resolves once that obligation is met.
  const shortages = await base44.entities.SupplierShortage.filter({ purchase_order_id: purchaseOrderId }, '-created_date', 200);
  const creditByPoLine = creditCommittedByPoLine(shortages);

  for (const pl of poLines) {
    const ordered = parseFloat(pl.ordered_qty) || 0;
    const received = receivedByPoLine[pl.id] || 0;
    const creditCommitted = creditByPoLine[pl.id] || 0;
    const stockObligation = Math.max(0, ordered - creditCommitted);

    // Keep the PO line's received_qty in sync with actual confirmed receipts
    if ((parseFloat(pl.received_qty) || 0) !== received) {
      try { await base44.entities.PurchaseOrderLine.update(pl.id, { received_qty: received }); } catch (_) {}
    }

    // Once the stock obligation is met, close the awaiting-remainder shortage for this line
    if (stockObligation > 0 && received >= stockObligation) {
      const awaitShortage = shortages.find(s =>
        s.po_line_id === pl.id &&
        shortageKind(s.decision) === 'await' &&
        !['resolved', 'cancelled'].includes(s.status)
      );
      if (awaitShortage) {
        try {
          await base44.entities.SupplierShortage.update(awaitShortage.id, {
            status: 'resolved',
            resolution_date: new Date().toISOString().slice(0, 10),
            resolution_notes: 'Remaining quantity received in a later GRN',
          });
        } catch (_) {}
      }
    }
  }
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

/**
 * Allocate a supplier credit note against a credit-kind shortage.
 * Expected credit = short qty × unit cost. If the actual amount matches, the
 * shortage is resolved (credit_received); otherwise it stays partially_credited
 * with the variance recorded.
 */
export async function allocateCreditNote(shortage, { creditNoteNumber, creditNoteDate, amountActual }) {
  const expected = computeShortageValue(shortage.shortage_qty, shortage.unit_cost);
  const actual = Math.round((parseFloat(amountActual) || 0) * 100) / 100;
  const variance = Math.round((actual - expected) * 100) / 100;
  const matched = Math.abs(variance) < 0.01;
  return base44.entities.SupplierShortage.update(shortage.id, {
    credit_note_number: creditNoteNumber || null,
    credit_note_date: creditNoteDate || null,
    credit_amount_expected: expected,
    credit_amount_actual: actual,
    credit_variance: variance,
    status: matched ? 'credit_received' : 'partially_credited',
    credit_follow_up_status: matched ? 'matched' : 'partially_credited',
    resolution_date: matched ? new Date().toISOString().slice(0, 10) : null,
    resolution_notes: matched
      ? `Credit note ${creditNoteNumber || ''} received in full`.trim()
      : `Credit note ${creditNoteNumber || ''} received with variance R ${variance.toFixed(2)}`.trim(),
  });
}

/**
 * Resolve the open shortage of a specific kind ('await' | 'credit' | 'review') for a
 * PO line. Used when an invoice shows a kind is no longer required (e.g. the supplier
 * only billed for what was received, so the credit shortage can be closed).
 */
export async function resolveShortageKind(poLineId, kind, resolution_notes, { purchaseOrderId, productId } = {}) {
  if (!kind) return null;
  const existing = await findShortageForPOLine({ poLineId, purchaseOrderId, productId, kind });
  if (!existing || ['resolved', 'cancelled'].includes(existing.status)) return null;
  return base44.entities.SupplierShortage.update(existing.id, {
    status: 'resolved',
    credit_follow_up_status: 'cancelled',
    resolution_date: new Date().toISOString().slice(0, 10),
    resolution_notes: resolution_notes || 'Resolved — no longer required per the supplier invoice',
  });
}

const round2 = (n) => Math.round((parseFloat(n) || 0) * 100) / 100;

/**
 * Reconcile a credit-note line against its linked shortage. The shortage resolves
 * only when BOTH the credited quantity and the credited (excl-VAT) value align with
 * the shortage's outstanding amount; otherwise it stays open as partially_credited
 * with the variance recorded.
 */
async function reconcileShortageFromCreditLine(line, { creditNoteNumber, creditNoteDate }) {
  if (!line.shortage_id) return { resolved: false };
  const list = await base44.entities.SupplierShortage.filter({ id: line.shortage_id });
  const s = list[0];
  if (!s) return { resolved: false };

  const expectedQty = parseFloat(s.shortage_qty) || 0;
  const expectedUnitCost = parseFloat(s.unit_cost) || 0;
  const expectedExcl = computeShortageValue(s.shortage_qty, s.unit_cost);
  const creditedQty = parseFloat(line.credit_qty) || 0;
  const creditedUnitCost = parseFloat(line.unit_cost_excl) || 0;
  const creditedExcl = round2(line.line_total_excl);
  const qtyAligned = Math.abs(creditedQty - expectedQty) < 0.001;
  const priceAligned = Math.abs(creditedUnitCost - expectedUnitCost) < 0.001;
  const valueAligned = Math.abs(creditedExcl - expectedExcl) < 0.01;
  const aligned = qtyAligned && valueAligned;
  const variance = round2(creditedExcl - expectedExcl);

  // Explain WHY a partial credit is partial — name the variance type and the amount
  let reason;
  if (aligned) {
    reason = `Credit note ${creditNoteNumber || ''} — fully credited`.trim();
  } else if (!qtyAligned && !priceAligned) {
    reason = `Quantity & price variance — credited ${creditedQty} of ${expectedQty} units @ R${creditedUnitCost.toFixed(2)} vs R${expectedUnitCost.toFixed(2)}/unit · variance R ${variance.toFixed(2)}`;
  } else if (!qtyAligned) {
    reason = `Short quantity — credited ${creditedQty} of ${expectedQty} units · variance R ${variance.toFixed(2)}`;
  } else {
    reason = `Price variance — credited R${creditedUnitCost.toFixed(2)}/unit vs R${expectedUnitCost.toFixed(2)}/unit expected · variance R ${variance.toFixed(2)}`;
  }

  await base44.entities.SupplierShortage.update(s.id, {
    credit_note_number: creditNoteNumber || null,
    credit_note_date: creditNoteDate || null,
    credit_amount_expected: expectedExcl,
    credit_amount_actual: creditedExcl,
    credit_variance: variance,
    status: aligned ? 'credit_received' : 'partially_credited',
    credit_follow_up_status: aligned ? 'matched' : 'partially_credited',
    resolution_date: aligned ? new Date().toISOString().slice(0, 10) : null,
    resolution_notes: reason,
  });
  return { resolved: aligned };
}

/**
 * Create a supplier credit-note document (header + lines + matches) and reconcile
 * the linked shortages/returns.
 *  - header: { scn_number, supplierCreditNoteNumber, creditNoteDate, notes, capturedTotal }
 *  - lines:  [{ shortage_id?, return_id?, product_id, product_name, product_sku,
 *               credit_qty, unit_cost_excl, tax_rate_id, tax_rule, tax_rate,
 *               line_total_excl, line_total_incl }]
 * Returns the created SupplierCreditNote.
 */
/** Header payload shared by draft-save and approve. */
function scnHeaderPayload(po, header, lines, status) {
  const subtotal = round2(lines.reduce((s, l) => s + (parseFloat(l.line_total_excl) || 0), 0));
  const total = round2(lines.reduce((s, l) => s + (parseFloat(l.line_total_incl) || 0), 0));
  const vat = round2(total - subtotal);
  const captured = (header.capturedTotal != null && header.capturedTotal !== '') ? round2(header.capturedTotal) : null;
  return {
    scn_number: header.scn_number,
    supplier_credit_note_number: header.supplierCreditNoteNumber || null,
    supplier_id: po.supplier_id,
    supplier_name: po.supplier_name,
    purchase_order_id: po.id,
    credit_note_date: header.creditNoteDate,
    subtotal,
    vat_amount: vat,
    total,
    captured_total: captured,
    total_variance: captured != null ? round2(captured - total) : null,
    notes: header.notes || null,
    status,
  };
}

async function replaceCreditNoteLines(creditNoteId, lines) {
  const existing = await base44.entities.SupplierCreditNoteLine.filter({ credit_note_id: creditNoteId }, 'created_date', 200);
  for (const l of existing) { try { await base44.entities.SupplierCreditNoteLine.delete(l.id); } catch (_) {} }
  for (const l of lines) {
    await base44.entities.SupplierCreditNoteLine.create({
      credit_note_id: creditNoteId,
      shortage_id: l.shortage_id || null,
      return_id: l.return_id || null,
      product_id: l.product_id || null,
      product_name: l.product_name || '',
      product_sku: l.product_sku || '',
      credit_qty: parseFloat(l.credit_qty) || 0,
      unit_cost_excl: parseFloat(l.unit_cost_excl) || 0,
      tax_rate_id: l.tax_rate_id || null,
      tax_rule: l.tax_rule || '',
      tax_rate: parseFloat(l.tax_rate) || 0,
      line_total_excl: round2(l.line_total_excl),
      line_total_incl: round2(l.line_total_incl),
    });
  }
}

/**
 * Save a credit note as a DRAFT — persists header + lines only, no matches and no
 * shortage reconciliation. Creates a new SCN or updates an existing draft (existingId).
 */
export async function saveCreditNoteDraft({ po, header, lines, existingId, userName }) {
  const payload = scnHeaderPayload(po, header, lines, 'draft');
  let scnId = existingId;
  if (scnId) {
    await base44.entities.SupplierCreditNote.update(scnId, payload);
  } else {
    const scn = await base44.entities.SupplierCreditNote.create({ ...payload, created_by: userName || null });
    scnId = scn.id;
  }
  await replaceCreditNoteLines(scnId, lines);
  return { id: scnId };
}

export async function createCreditNote({ po, header, lines, userName, existingId }) {
  const subtotal = round2(lines.reduce((s, l) => s + (parseFloat(l.line_total_excl) || 0), 0));
  const total = round2(lines.reduce((s, l) => s + (parseFloat(l.line_total_incl) || 0), 0));
  const vat = round2(total - subtotal);
  const captured = (header.capturedTotal != null && header.capturedTotal !== '') ? round2(header.capturedTotal) : null;
  const totalVariance = captured != null ? round2(captured - total) : null;
  const cnNumber = header.supplierCreditNoteNumber || header.scn_number;

  let scn;
  if (existingId) {
    // Approving a draft — update in place and clear its old lines + matches first
    await base44.entities.SupplierCreditNote.update(existingId, { ...scnHeaderPayload(po, header, lines, 'open') });
    scn = { id: existingId };
    const oldLines = await base44.entities.SupplierCreditNoteLine.filter({ credit_note_id: existingId }, 'created_date', 200);
    for (const l of oldLines) { try { await base44.entities.SupplierCreditNoteLine.delete(l.id); } catch (_) {} }
    const oldMatches = await base44.entities.SupplierCreditNoteMatch.filter({ credit_note_id: existingId }, 'created_date', 200);
    for (const m of oldMatches) { try { await base44.entities.SupplierCreditNoteMatch.delete(m.id); } catch (_) {} }
  } else {
    scn = await base44.entities.SupplierCreditNote.create({
      ...scnHeaderPayload(po, header, lines, 'open'),
      created_by: userName || null,
    });
  }

  let allResolved = true;
  let anyMatch = false;

  for (const l of lines) {
    await base44.entities.SupplierCreditNoteLine.create({
      credit_note_id: scn.id,
      shortage_id: l.shortage_id || null,
      return_id: l.return_id || null,
      product_id: l.product_id || null,
      product_name: l.product_name || '',
      product_sku: l.product_sku || '',
      credit_qty: parseFloat(l.credit_qty) || 0,
      unit_cost_excl: parseFloat(l.unit_cost_excl) || 0,
      tax_rate_id: l.tax_rate_id || null,
      tax_rule: l.tax_rule || '',
      tax_rate: parseFloat(l.tax_rate) || 0,
      line_total_excl: round2(l.line_total_excl),
      line_total_incl: round2(l.line_total_incl),
    });

    if (l.shortage_id || l.return_id) {
      anyMatch = true;
      await base44.entities.SupplierCreditNoteMatch.create({
        credit_note_id: scn.id,
        shortage_id: l.shortage_id || null,
        return_id: l.return_id || null,
        matched_amount: round2(l.line_total_incl),
        matched_by: userName || null,
      });
    }

    if (l.shortage_id) {
      const { resolved } = await reconcileShortageFromCreditLine(l, { creditNoteNumber: cnNumber, creditNoteDate: header.creditNoteDate });
      if (!resolved) allResolved = false;
    }
    if (l.return_id) {
      try {
        await base44.entities.SupplierReturn.update(l.return_id, {
          credit_note_number: cnNumber,
          status: 'credit_received',
        });
      } catch (_) {}
    }
  }

  const varianceOk = totalVariance == null || Math.abs(totalVariance) < 0.01;
  const status = anyMatch
    ? ((allResolved && varianceOk) ? 'fully_matched' : 'partially_matched')
    : (varianceOk ? 'fully_matched' : 'open');
  await base44.entities.SupplierCreditNote.update(scn.id, { status });

  return scn;
}
