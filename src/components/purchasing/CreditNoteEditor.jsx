import React, { useState, useMemo, useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { X, CreditCard, Loader2, AlertTriangle, Plus, Search, Trash2, Save } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/lib/AuthContext';
import { nextDocNumber } from '@/lib/docNumbering';
import { resolveTaxRateRecord } from '@/lib/taxResolution';
import { shortageKind, createCreditNote, saveCreditNoteDraft, computeShortageValue } from '@/lib/shortageEngine';
import TruncatedCell from '@/components/ui/TruncatedCell';
import { useUnsavedChanges, useGuardedAction } from '@/lib/navigationGuard';

const RESOLVED = ['resolved', 'cancelled', 'credit_received'];
// Serialize the editable surface (header fields + lines) so we can diff against a
// baseline captured when the editor first seeds, to know if there are unsaved edits.
const serializeState = (header, lines) => JSON.stringify({
  ...header,
  lines: lines.map(l => ({
    shortage_id: l.shortage_id || null,
    return_id: l.return_id || null,
    invoice_line_id: l.invoice_line_id || null,
    product_id: l.product_id || null,
    credit_qty: String(l.credit_qty ?? ''),
    unit_cost_excl: String(l.unit_cost_excl ?? ''),
    tax_rate_id: l.tax_rate_id || null,
  })),
});
const rnd2 = (n) => Math.round((parseFloat(n) || 0) * 100) / 100;
const fmtR = (v) => `R ${(parseFloat(v) || 0).toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// Badge shown against each item in the "Add from Outstanding" picker. Shortages are
// labelled by the decision recorded at the GRN/invoice step so the user can tell a
// credit-due short from one still awaiting stock or pending review.
const OUT_BADGE = {
  credit: { label: 'Credit due',     cls: 'bg-amber-100 text-amber-700' },
  await:  { label: 'Awaiting stock', cls: 'bg-blue-100 text-blue-700' },
  review: { label: 'Review',         cls: 'bg-gray-100 text-gray-600' },
  other:  { label: 'Short',          cls: 'bg-amber-100 text-amber-700' },
  return: { label: 'Return',         cls: 'bg-indigo-100 text-indigo-700' },
  price:  { label: 'Price variance', cls: 'bg-red-100 text-red-700' },
};
const outBadge = (item) => (item.kind === 'shortage'
  ? (OUT_BADGE[item.decision_kind] || OUT_BADGE.other)
  : (OUT_BADGE[item.kind] || OUT_BADGE.other));

/**
 * Full-screen supplier credit-note document editor.
 * Props:
 *   po            – the purchase order
 *   shortages     – the PO's shortages (open credit ones are pre-seeded as lines)
 *   existingCreditNote – when set, opens read-only view of an existing SCN
 *   onCreated / onCancel
 */
export default function CreditNoteEditor({ po, shortages = [], existingCreditNote = null, onCreated, onCancel }) {
  const { user } = useAuth();
  const isDraft = existingCreditNote?.status === 'draft';
  const viewMode = !!existingCreditNote && !isDraft;   // finalised → read-only
  const editMode = !viewMode;                           // new or draft → editable

  const { data: taxRates = [] } = useQuery({
    queryKey: ['tax-rates'],
    queryFn: () => base44.entities.TaxRate.filter({ active: true }, 'name', 20),
    staleTime: 300000,
  });
  const { data: supplier = null } = useQuery({
    queryKey: ['supplier-single', po.supplier_id],
    queryFn: async () => (await base44.entities.Supplier.filter({ id: po.supplier_id }))[0] || null,
    enabled: !!po.supplier_id,
  });
  const { data: supplierProducts = [] } = useQuery({
    queryKey: ['supplier-products-for-cn', po.supplier_id],
    queryFn: () => base44.entities.SupplierProduct.filter({ supplier_id: po.supplier_id, active: true }, 'product_name', 200),
    enabled: !!po.supplier_id && editMode,
  });

  // Supplier-wide outstanding shortages + returns (so one CN can cover items across POs)
  const { data: supplierShortages = [] } = useQuery({
    queryKey: ['cn-supplier-shortages', po.supplier_id],
    queryFn: () => base44.entities.SupplierShortage.filter({ supplier_id: po.supplier_id }, '-created_date', 500),
    enabled: !!po.supplier_id && editMode,
  });
  const { data: supplierReturns = [] } = useQuery({
    queryKey: ['cn-supplier-returns', po.supplier_id],
    queryFn: () => base44.entities.SupplierReturn.filter({ supplier_id: po.supplier_id }, '-created_date', 500),
    enabled: !!po.supplier_id && editMode,
  });
  const { data: supplierPOs = [] } = useQuery({
    queryKey: ['cn-supplier-pos', po.supplier_id],
    queryFn: () => base44.entities.PurchaseOrder.filter({ supplier_id: po.supplier_id }, '-created_date', 500),
    enabled: !!po.supplier_id && editMode,
  });
  const { data: supplierGRNs = [] } = useQuery({
    queryKey: ['cn-supplier-grns', po.supplier_id],
    queryFn: () => base44.entities.GoodsReceivedNote.filter({ supplier_id: po.supplier_id }, '-received_date', 500),
    enabled: !!po.supplier_id && editMode,
  });
  // Lines of the supplier's returns — so adding a return expands into its products,
  // each editable (qty + price), rather than one lump credit line.
  const { data: supplierReturnLines = [] } = useQuery({
    queryKey: ['cn-supplier-return-lines', po.supplier_id, supplierReturns.length],
    queryFn: () => base44.entities.SupplierReturnLine.filter({ return_id: supplierReturns.map(r => r.id) }, 'created_date', 1000),
    enabled: editMode && supplierReturns.length > 0,
  });
  const returnLinesByReturn = useMemo(() => {
    const m = {};
    supplierReturnLines.forEach(l => {
      if (!m[l.return_id]) m[l.return_id] = [];
      m[l.return_id].push(l);
    });
    return m;
  }, [supplierReturnLines]);
  // Supplier invoices + their flagged price-variance lines — so a price overcharge
  // billed above the PO cost can be pulled into the credit note. Already-credited
  // lines (price_variance_credited) are filtered out client-side so the same
  // overcharge is never offered twice.
  const { data: supplierInvoices = [] } = useQuery({
    queryKey: ['cn-supplier-invoices', po.supplier_id],
    queryFn: () => base44.entities.PurchaseInvoice.filter({ supplier_id: po.supplier_id }, '-created_date', 500),
    enabled: !!po.supplier_id && editMode,
  });
  const invoiceById = useMemo(() => Object.fromEntries(supplierInvoices.map(i => [i.id, i])), [supplierInvoices]);
  const { data: varianceLines = [] } = useQuery({
    queryKey: ['cn-supplier-variance-lines', po.supplier_id, supplierInvoices.length],
    queryFn: () => base44.entities.PurchaseInvoiceLine.filter(
      { invoice_id: supplierInvoices.map(i => i.id), price_variance_flagged: true }, 'created_date', 1000
    ),
    enabled: editMode && supplierInvoices.length > 0,
  });

  const poById = useMemo(() => Object.fromEntries(supplierPOs.map(p => [p.id, p])), [supplierPOs]);
  const grnById = useMemo(() => Object.fromEntries(supplierGRNs.map(g => [g.id, g])), [supplierGRNs]);

  // Build a friendly reference string for the audit trail
  const refForShortage = (s) => [
    poById[s.purchase_order_id]?.po_number,
    grnById[s.grn_id]?.grn_number,
    s.invoice_number,
  ].filter(Boolean).join(' · ') || '—';
  const refForReturn = (r) => [r.return_number, grnById[r.grn_id]?.grn_number].filter(Boolean).join(' · ') || '—';
  const shortageByIdAll = useMemo(() => Object.fromEntries(supplierShortages.map(s => [s.id, s])), [supplierShortages]);
  const returnByIdAll = useMemo(() => Object.fromEntries(supplierReturns.map(r => [r.id, r])), [supplierReturns]);
  const lineRef = (l) => l.ref
    || (l.shortage_id && shortageByIdAll[l.shortage_id] ? refForShortage(shortageByIdAll[l.shortage_id]) : null)
    || (l.return_id && returnByIdAll[l.return_id] ? refForReturn(returnByIdAll[l.return_id]) : null)
    || '—';

  // Existing CN lines (view or draft-edit)
  const { data: savedLines = [] } = useQuery({
    queryKey: ['scn-lines', existingCreditNote?.id],
    queryFn: () => base44.entities.SupplierCreditNoteLine.filter({ credit_note_id: existingCreditNote.id }, 'created_date', 100),
    enabled: !!existingCreditNote,
  });

  const defaultTax = useMemo(
    () => taxRates.find(t => Math.abs((t.rate || 0) - 0.15) < 0.001) || taxRates[0] || null,
    [taxRates]
  );

  const [supplierCnNumber, setSupplierCnNumber] = useState(existingCreditNote?.supplier_credit_note_number || '');
  const [creditNoteDate, setCreditNoteDate] = useState(existingCreditNote?.credit_note_date || new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState(existingCreditNote?.notes || '');
  const [capturedTotal, setCapturedTotal] = useState(existingCreditNote?.captured_total != null ? String(existingCreditNote.captured_total) : '');
  const [lines, setLines] = useState([]);
  const [showPicker, setShowPicker] = useState(false);
  const [search, setSearch] = useState('');
  const [showOutstanding, setShowOutstanding] = useState(false);
  const [outSearch, setOutSearch] = useState('');
  const [saving, setSaving] = useState(false);
  const [seeded, setSeeded] = useState(false);
  // 'single' = just this PO (the original per-PO flow); 'multiple' = pick across all of
  // the supplier's open shortages & returns.
  const [scope, setScope] = useState('single');
  // Baseline snapshot of the editable surface, captured when the editor first seeds, so
  // we can tell whether the user has made unsaved edits to lines/header.
  const baselineRef = useRef(null);

  // Seed editable lines: a new CN seeds from the PO's open credit shortages; a draft
  // seeds from its saved lines.
  useEffect(() => {
    if (!editMode || seeded) return;
    if (isDraft) {
      if (!savedLines.length) return; // wait for load
      const seededLines = savedLines.map(l => ({
        key: l.id,
        shortage_id: l.shortage_id || null,
        return_id: l.return_id || null,
        invoice_line_id: l.invoice_line_id || null,
        product_id: l.product_id,
        product_name: l.product_name,
        product_sku: l.product_sku,
        credit_qty: String(l.credit_qty ?? ''),
        unit_cost_excl: String(l.unit_cost_excl ?? ''),
        tax_rate_id: l.tax_rate_id || null,
        tax_rule: l.tax_rule || '',
        tax_rate: parseFloat(l.tax_rate) || 0,
      }));
      setLines(seededLines);
      baselineRef.current = serializeState(buildHeader(existingCreditNote?.scn_number || ''), seededLines);
      setSeeded(true);
      return;
    }
    if (!defaultTax) return;
    const creditShortages = shortages.filter(s =>
      shortageKind(s.decision) === 'credit' && !RESOLVED.includes(s.status)
    );
    const seededLines = creditShortages.map(s => ({
      key: s.id,
      shortage_id: s.id,
      return_id: null,
      ref: [po.po_number, s.invoice_number].filter(Boolean).join(' · '),
      product_id: s.product_id,
      product_name: s.product_name,
      product_sku: s.product_sku,
      credit_qty: String(s.shortage_qty ?? ''),
      unit_cost_excl: String(s.unit_cost ?? ''),
      tax_rate_id: defaultTax.id,
      tax_rule: defaultTax.name,
      tax_rate: defaultTax.rate || 0,
    }));
    setLines(seededLines);
    baselineRef.current = serializeState(buildHeader(''), seededLines);
    setSeeded(true);
  }, [editMode, isDraft, seeded, defaultTax, shortages, savedLines]); // eslint-disable-line react-hooks/exhaustive-deps

  const update = (key, field, value) => setLines(prev => prev.map(l => l.key === key ? { ...l, [field]: value } : l));
  const removeLine = (key) => setLines(prev => prev.filter(l => l.key !== key));

  const setLineTax = (key, taxRateId) => {
    const tr = taxRates.find(t => t.id === taxRateId);
    setLines(prev => prev.map(l => l.key === key ? { ...l, tax_rate_id: taxRateId, tax_rule: tr?.name || '', tax_rate: tr?.rate || 0 } : l));
  };

  const addProduct = (sp) => {
    const tr = resolveTaxRateRecord(sp, supplier, taxRates) || defaultTax;
    setLines(prev => [...prev, {
      key: `sp-${sp.id}-${Date.now()}`,
      shortage_id: null,
      return_id: null,
      product_id: sp.product_id,
      product_name: sp.product_name,
      product_sku: sp.product_sku,
      credit_qty: '1',
      unit_cost_excl: String(sp.last_purchase_price || 0),
      tax_rate_id: tr?.id || null,
      tax_rule: tr?.name || '',
      tax_rate: tr?.rate || 0,
    }]);
    setShowPicker(false);
    setSearch('');
  };

  // Outstanding shortages + returns for this supplier, not already on the credit note
  const outstandingItems = useMemo(() => {
    const linkedShortageIds = new Set(lines.map(l => l.shortage_id).filter(Boolean));
    const linkedReturnIds = new Set(lines.map(l => l.return_id).filter(Boolean));
    const linkedInvLineIds = new Set(lines.map(l => l.invoice_line_id).filter(Boolean));
    const items = [];
    // Every OPEN shortage on the PO/supplier is an issue you may want to credit —
    // not just the ones already decided as "request credit". Awaiting-receival and
    // review shorts are surfaced too (labelled by decision), so a credit note can
    // pull in any noted short receival. Resolved/cancelled/credited ones are hidden.
    supplierShortages.forEach(s => {
      if (RESOLVED.includes(s.status)) return;
      if (linkedShortageIds.has(s.id)) return;
      items.push({
        kind: 'shortage', id: s.id, decision_kind: shortageKind(s.decision),
        product_name: s.product_name, product_sku: s.product_sku,
        product_id: s.product_id, ref: refForShortage(s),
        purchase_order_id: s.purchase_order_id,
        po_number: poById[s.purchase_order_id]?.po_number || null,
        invoice_number: s.invoice_number || null,
        expected_qty: parseFloat(s.shortage_qty) || 0, unit_cost: parseFloat(s.unit_cost) || 0,
      });
    });
    supplierReturns.forEach(r => {
      if (r.status === 'credit_received') return;
      if (linkedReturnIds.has(r.id)) return;
      const rlines = returnLinesByReturn[r.id] || [];
      items.push({
        kind: 'return', id: r.id, product_name: `Return ${r.return_number}`, product_sku: '',
        product_id: null, ref: refForReturn(r),
        purchase_order_id: r.purchase_order_id,
        po_number: poById[r.purchase_order_id]?.po_number || null,
        invoice_number: null,
        line_count: rlines.length,
        expected_qty: 1, unit_cost: parseFloat(r.total_return_value) || 0, total_value: parseFloat(r.total_return_value) || 0,
      });
    });
    // Price variances: invoice lines billed above the PO cost. Credit = the per-unit
    // overcharge × qty. Only over-bills (positive variance) are creditable; lines
    // already credited or already on this note are skipped.
    varianceLines.forEach(vl => {
      if (vl.price_variance_credited) return;
      if (linkedInvLineIds.has(vl.id)) return;
      const inv = invoiceById[vl.invoice_id];
      if (!inv) return;
      const pct = parseFloat(vl.price_variance_pct) || 0;
      const invCost = parseFloat(vl.unit_cost) || 0;
      const qty = parseFloat(vl.qty) || 0;
      if (pct <= 0 || invCost <= 0 || qty <= 0) return;
      const poCost = invCost / (1 + pct / 100);
      const overPerUnit = rnd2(invCost - poCost);
      if (overPerUnit <= 0) return;
      items.push({
        kind: 'price', id: vl.id, invoice_line_id: vl.id,
        product_name: vl.product_name, product_sku: vl.product_sku, product_id: vl.product_id,
        ref: [poById[inv.purchase_order_id]?.po_number, inv.invoice_number].filter(Boolean).join(' · ') || '—',
        purchase_order_id: inv.purchase_order_id,
        po_number: poById[inv.purchase_order_id]?.po_number || null,
        invoice_number: inv.invoice_number || null,
        variance_pct: pct,
        expected_qty: qty, unit_cost: overPerUnit, over_value: rnd2(overPerUnit * qty),
      });
    });
    return items;
  }, [supplierShortages, supplierReturns, varianceLines, invoiceById, lines, poById, grnById, returnLinesByReturn]); // eslint-disable-line react-hooks/exhaustive-deps

  const addOutstanding = (item) => {
    const tax = { tax_rate_id: defaultTax?.id || null, tax_rule: defaultTax?.name || '', tax_rate: defaultTax?.rate || 0 };
    if (item.kind === 'return') {
      // Expand the return into one editable credit line per returned product.
      const rlines = returnLinesByReturn[item.id] || [];
      if (rlines.length) {
        setLines(prev => [...prev, ...rlines.map(rl => ({
          key: `return-${item.id}-${rl.id}`,
          shortage_id: null,
          return_id: item.id,
          ref: item.ref,
          product_id: rl.product_id,
          product_name: rl.product_name,
          product_sku: rl.product_sku,
          credit_qty: String(rl.return_qty ?? 1),
          unit_cost_excl: String(rl.unit_cost ?? 0),
          ret_expected_qty: parseFloat(rl.return_qty) || 0,
          ret_expected_value: rnd2((parseFloat(rl.return_qty) || 0) * (parseFloat(rl.unit_cost) || 0)),
          ...tax,
        }))]);
      } else {
        // No line detail — fall back to a single lump line for the return value.
        setLines(prev => [...prev, {
          key: `return-${item.id}`, shortage_id: null, return_id: item.id, ref: item.ref,
          product_id: null, product_name: item.product_name, product_sku: '',
          credit_qty: '1', unit_cost_excl: String(item.unit_cost ?? 0), ...tax,
        }]);
      }
    } else if (item.kind === 'price') {
      // Credit the per-unit overcharge × invoiced qty, linked to the invoice line
      // so it gets marked credited (and never re-offered) when the note is recorded.
      setLines(prev => [...prev, {
        key: `price-${item.id}`,
        shortage_id: null,
        return_id: null,
        invoice_line_id: item.invoice_line_id,
        ref: item.ref,
        product_id: item.product_id,
        product_name: item.product_name,
        product_sku: item.product_sku,
        credit_qty: String(item.expected_qty ?? 1),
        unit_cost_excl: String(item.unit_cost ?? 0),
        ...tax,
      }]);
    } else {
      setLines(prev => [...prev, {
        key: `shortage-${item.id}`,
        shortage_id: item.id,
        return_id: null,
        ref: item.ref,
        product_id: item.product_id,
        product_name: item.product_name,
        product_sku: item.product_sku,
        credit_qty: String(item.expected_qty ?? 1),
        unit_cost_excl: String(item.unit_cost ?? 0),
        ...tax,
      }]);
    }
    setShowOutstanding(false);
    setOutSearch('');
  };

  const filteredOutstanding = useMemo(() => {
    let list = scope === 'single'
      ? outstandingItems.filter(i => i.purchase_order_id === po.id)
      : outstandingItems;
    if (outSearch) {
      const q = outSearch.toLowerCase();
      list = list.filter(i =>
        (i.product_name || '').toLowerCase().includes(q) ||
        (i.product_sku || '').toLowerCase().includes(q) ||
        (i.ref || '').toLowerCase().includes(q)
      );
    }
    return list.slice(0, 50);
  }, [outstandingItems, outSearch, scope, po.id]);

  const filteredSPs = useMemo(() => {
    const existing = new Set(lines.map(l => l.product_id));
    let list = supplierProducts.filter(sp => !existing.has(sp.product_id));
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(sp => (sp.product_name || '').toLowerCase().includes(q) || (sp.product_sku || '').toLowerCase().includes(q));
    }
    return list.slice(0, 20);
  }, [supplierProducts, lines, search]);

  // Compute per-line + totals
  const rows = useMemo(() => {
    const src = viewMode ? savedLines.map(l => ({
      key: l.id, ...l,
      credit_qty: l.credit_qty, unit_cost_excl: l.unit_cost_excl, tax_rate: l.tax_rate,
    })) : lines;
    return src.map(l => {
      const qty = parseFloat(l.credit_qty) || 0;
      const cost = parseFloat(l.unit_cost_excl) || 0;
      const rate = parseFloat(l.tax_rate) || 0;
      const excl = rnd2(qty * cost);
      const incl = rnd2(excl * (1 + rate));
      return { ...l, _excl: excl, _incl: incl };
    });
  }, [viewMode, savedLines, lines]);

  const subtotal = rnd2(rows.reduce((s, r) => s + r._excl, 0));
  const total = rnd2(rows.reduce((s, r) => s + r._incl, 0));
  const vat = rnd2(total - subtotal);

  // Per linked shortage/return: expected vs allocated (qty + value)
  const linkedSummary = useMemo(() => rows
    .filter(r => r.shortage_id || r.return_id)
    .map(r => {
      let expectedQty = null, expectedValue = null;
      if (r.shortage_id) {
        const s = shortageByIdAll[r.shortage_id];
        if (s) { expectedQty = parseFloat(s.shortage_qty) || 0; expectedValue = computeShortageValue(s.shortage_qty, s.unit_cost); }
      } else if (r.return_id) {
        if (r.ret_expected_qty != null) {
          expectedQty = r.ret_expected_qty;
          expectedValue = r.ret_expected_value;
        } else {
          const rr = returnByIdAll[r.return_id];
          if (rr) { expectedValue = rnd2(rr.total_return_value); }
        }
      }
      const allocatedValue = r._excl;
      return {
        key: r.key,
        kind: r.return_id ? 'return' : 'shortage',
        label: r.product_name,
        ref: lineRef(r),
        expectedQty,
        expectedValue,
        allocatedQty: parseFloat(r.credit_qty) || 0,
        allocatedValue,
        valueVar: expectedValue != null ? rnd2(allocatedValue - expectedValue) : null,
      };
    }), [rows, shortageByIdAll, returnByIdAll]); // eslint-disable-line react-hooks/exhaustive-deps

  const allocatedIncl = rnd2(rows.filter(r => r.shortage_id || r.return_id).reduce((s, r) => s + r._incl, 0));
  const unallocated = rnd2(total - allocatedIncl);

  // Per-line warnings vs the linked shortage: short quantity and/or price variance
  const shortageById = shortageByIdAll;
  const warnings = useMemo(() => {
    if (viewMode) return [];
    const out = [];
    rows.forEach(r => {
      if (!r.shortage_id) return;
      const s = shortageById[r.shortage_id];
      if (!s) return;
      const expectedQty = parseFloat(s.shortage_qty) || 0;
      const expectedCost = parseFloat(s.unit_cost) || 0;
      const creditedQty = parseFloat(r.credit_qty) || 0;
      const creditedCost = parseFloat(r.unit_cost_excl) || 0;
      if (creditedQty < expectedQty - 0.001) {
        const shortUnits = rnd2(expectedQty - creditedQty);
        out.push({ type: 'qty', text: `Short quantity on ${r.product_name}: crediting ${creditedQty} of ${expectedQty} units (short ${shortUnits}) — the shortage will stay open.` });
      }
      if (Math.abs(creditedCost - expectedCost) > 0.001) {
        const perUnit = rnd2(creditedCost - expectedCost);
        out.push({ type: 'price', text: `Price variance on ${r.product_name}: credited R${creditedCost.toFixed(2)}/unit vs R${expectedCost.toFixed(2)}/unit expected (R${perUnit.toFixed(2)}/unit).` });
      }
    });
    return out;
  }, [viewMode, rows, shortageById]);

  const captured = viewMode ? existingCreditNote.captured_total : (capturedTotal === '' ? null : parseFloat(capturedTotal));
  const variance = (captured != null) ? rnd2(captured - (viewMode ? (existingCreditNote.total || 0) : total)) : null;

  const buildPayloadLines = () => rows.map(r => ({
    shortage_id: r.shortage_id || null,
    return_id: r.return_id || null,
    invoice_line_id: r.invoice_line_id || null,
    product_id: r.product_id,
    product_name: r.product_name,
    product_sku: r.product_sku,
    credit_qty: parseFloat(r.credit_qty) || 0,
    unit_cost_excl: parseFloat(r.unit_cost_excl) || 0,
    tax_rate_id: r.tax_rate_id || null,
    tax_rule: r.tax_rule || '',
    tax_rate: parseFloat(r.tax_rate) || 0,
    line_total_excl: r._excl,
    line_total_incl: r._incl,
  }));

  const buildHeader = (scnNumber) => ({
    scn_number: scnNumber,
    supplierCreditNoteNumber: supplierCnNumber.trim(),
    creditNoteDate,
    notes,
    capturedTotal: capturedTotal === '' ? null : parseFloat(capturedTotal),
  });

  // Save as draft — no matches, no shortage reconciliation.
  // Returns true on success / false on validation-abort or error so it can back the
  // navigation guard's "Save & leave".
  const handleSaveDraft = async () => {
    if (lines.length === 0) { toast.error('Add at least one credit line'); return false; }
    setSaving(true);
    try {
      const scnNumber = existingCreditNote?.scn_number || await nextDocNumber('SCN');
      await saveCreditNoteDraft({
        po,
        header: buildHeader(scnNumber),
        lines: buildPayloadLines(),
        existingId: existingCreditNote?.id || null,
        userName: user?.full_name || user?.email || 'System',
      });
      toast.success('Credit note saved as draft');
      onCreated();
      return true;
    } catch (err) {
      toast.error('Failed: ' + (err?.message || 'Unknown error'));
      return false;
    } finally {
      setSaving(false);
    }
  };

  // Approve — runs reconciliation; updates the draft in place if approving one
  const handleSave = async () => {
    if (!supplierCnNumber.trim()) { toast.error('Enter the supplier credit note number'); return; }
    if (lines.length === 0) { toast.error('Add at least one credit line'); return; }
    setSaving(true);
    try {
      const scnNumber = existingCreditNote?.scn_number || await nextDocNumber('SCN');
      await createCreditNote({
        po,
        header: buildHeader(scnNumber),
        lines: buildPayloadLines(),
        userName: user?.full_name || user?.email || 'System',
        existingId: existingCreditNote?.id || null,
      });
      toast.success('Credit note recorded');
      onCreated();
    } catch (err) {
      toast.error('Failed: ' + (err?.message || 'Unknown error'));
    } finally {
      setSaving(false);
    }
  };

  // Unsaved-changes guard: dirty once the editor has seeded and the current editable
  // surface differs from the baseline snapshot. Read-only (view) mode is never dirty.
  // "Save & leave" is backed by the clean single-status draft save.
  const hasUnsavedChanges = editMode
    && baselineRef.current != null
    && serializeState(buildHeader(existingCreditNote?.scn_number || ''), lines) !== baselineRef.current;
  // No onSave: handleSaveDraft also closes/refreshes the parent via onCreated(),
  // which would double-close when combined with the guard's own leave action.
  // The editor's own "Save draft" button remains the way to save.
  useUnsavedChanges(hasUnsavedChanges, {
    message: 'You have unsaved changes to this credit note. Leave without saving?',
  });
  const guardedClose = useGuardedAction();

  return (
    <div className="fixed inset-0 z-[200] flex flex-col bg-card">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-border shrink-0 bg-card">
        <div>
          <h2 className="text-base font-bold flex items-center gap-2">
            <CreditCard className="w-5 h-5 text-purple-600" />
            {viewMode
              ? `Credit Note ${existingCreditNote.supplier_credit_note_number || existingCreditNote.scn_number}`
              : isDraft ? 'Edit Credit Note (Draft)' : 'New Supplier Credit Note'}
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">{po.po_number} · {po.supplier_name}</p>
        </div>
        <Button variant="ghost" size="icon" onClick={() => guardedClose(onCancel)}><X className="w-5 h-5" /></Button>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-4 space-y-5">
        {/* Header fields */}
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <div className="sm:col-span-2">
            <label className="text-[10px] font-semibold text-muted-foreground uppercase">Supplier Credit Note Number *</label>
            {viewMode ? (
              <p className="text-sm font-mono mt-1">{existingCreditNote.supplier_credit_note_number || existingCreditNote.scn_number}</p>
            ) : (
              <Input value={supplierCnNumber} onChange={e => setSupplierCnNumber(e.target.value)} placeholder="e.g. SCN-001" className="mt-1" />
            )}
          </div>
          <div>
            <label className="text-[10px] font-semibold text-muted-foreground uppercase">Credit Note Date *</label>
            {viewMode ? (
              <p className="text-sm mt-1">{existingCreditNote.credit_note_date}</p>
            ) : (
              <Input type="date" value={creditNoteDate} onChange={e => setCreditNoteDate(e.target.value)} className="mt-1" />
            )}
          </div>
          <div>
            <label className="text-[10px] font-semibold text-muted-foreground uppercase">Status</label>
            <p className="text-sm mt-1 capitalize">{viewMode ? (existingCreditNote.status || '').replace(/_/g, ' ') : 'new'}</p>
          </div>
          {!viewMode && (
            <div className="sm:col-span-4">
              <label className="text-[10px] font-semibold text-muted-foreground uppercase">Notes</label>
              <Input value={notes} onChange={e => setNotes(e.target.value)} placeholder="Optional..." className="mt-1" />
            </div>
          )}
        </div>

        {/* Scope: this PO only, or pick across all of the supplier's open items */}
        {!viewMode && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[10px] font-semibold text-muted-foreground uppercase">Apply to</span>
            <div className="inline-flex rounded-lg border border-border overflow-hidden text-xs">
              <button
                type="button"
                onClick={() => setScope('single')}
                className={`px-3 py-1.5 ${scope === 'single' ? 'bg-purple-600 text-white' : 'text-muted-foreground'}`}
              >
                This PO ({po.po_number})
              </button>
              <button
                type="button"
                onClick={() => setScope('multiple')}
                className={`px-3 py-1.5 border-l border-border ${scope === 'multiple' ? 'bg-purple-600 text-white' : 'text-muted-foreground'}`}
              >
                Multiple — all open shortages &amp; returns
              </button>
            </div>
          </div>
        )}

        {/* Lines */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold text-muted-foreground uppercase">Credit Note Lines</p>
            {!viewMode && (
              <div className="flex gap-2">
                <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setShowOutstanding(true)}>
                  <Plus className="w-3.5 h-3.5" /> Add from Outstanding
                </Button>
                <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setShowPicker(true)}>
                  <Plus className="w-3.5 h-3.5" /> Add Product
                </Button>
              </div>
            )}
          </div>

          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-muted/50 border-b border-border text-[10px] uppercase text-muted-foreground">
                  <th className="text-left px-3 py-2 font-semibold">Product</th>
                  <th className="text-left px-3 py-2 font-semibold">Linked to</th>
                  <th className="text-right px-3 py-2 font-semibold w-28">Credit Qty</th>
                  <th className="text-right px-3 py-2 font-semibold w-32">Unit Cost (excl)</th>
                  <th className="text-left px-3 py-2 font-semibold w-40">Tax Rule</th>
                  <th className="text-right px-3 py-2 font-semibold w-28">Total excl</th>
                  <th className="text-right px-3 py-2 font-semibold w-28">Total incl</th>
                  {!viewMode && <th className="w-8" />}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.length === 0 ? (
                  <tr><td colSpan={viewMode ? 7 : 8} className="px-3 py-6 text-center text-xs text-muted-foreground">No lines.</td></tr>
                ) : rows.map(r => (
                  <tr key={r.key}>
                    <td className="px-3 py-2">
                      <TruncatedCell text={r.product_name} className="font-medium max-w-[280px]" />
                      <TruncatedCell text={r.product_sku} className="text-[10px] font-mono text-muted-foreground max-w-[280px]" placeholder="" />
                    </td>
                    <td className="px-3 py-2 text-xs">
                      {(r.shortage_id || r.return_id)
                        ? <span className="font-mono text-[11px]">{lineRef(r)}<span className="text-muted-foreground">{r.return_id ? ' · return' : ' · shortage'}</span></span>
                        : r.invoice_line_id
                          ? <span className="font-mono text-[11px]">{r.ref || '—'}<span className="text-muted-foreground"> · price variance</span></span>
                          : <span className="text-muted-foreground">— ad-hoc</span>}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {viewMode ? r.credit_qty : (
                        <Input type="number" min="0" step="any" value={r.credit_qty} onChange={e => update(r.key, 'credit_qty', e.target.value)} className="h-8 w-24 text-right text-sm ml-auto" />
                      )}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {viewMode ? fmtR(r.unit_cost_excl) : (
                        <Input type="number" min="0" step="any" value={r.unit_cost_excl} onChange={e => update(r.key, 'unit_cost_excl', e.target.value)} className="h-8 w-28 text-right text-sm ml-auto" />
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {viewMode ? <span className="text-xs">{r.tax_rule}</span> : (
                        <Select value={r.tax_rate_id || ''} onValueChange={v => setLineTax(r.key, v)}>
                          <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Tax..." /></SelectTrigger>
                          <SelectContent className="z-[220]">
                            {taxRates.map(t => <SelectItem key={t.id} value={t.id}>{t.name} ({Math.round((t.rate || 0) * 100)}%)</SelectItem>)}
                          </SelectContent>
                        </Select>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{fmtR(r._excl)}</td>
                    <td className="px-3 py-2 text-right tabular-nums font-medium">{fmtR(r._incl)}</td>
                    {!viewMode && (
                      <td className="px-2 py-2">
                        <Button variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground hover:text-red-600" onClick={() => removeLine(r.key)}>
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Product picker */}
          {showPicker && (
            <>
              <div className="fixed inset-0 bg-black/30 z-[210]" onClick={() => setShowPicker(false)} />
              <div className="fixed inset-0 z-[220] flex items-center justify-center p-4">
                <div className="bg-card rounded-xl shadow-2xl w-full max-w-md p-4 space-y-3">
                  <div className="flex items-center gap-2">
                    <Search className="w-4 h-4 text-muted-foreground shrink-0" />
                    <Input placeholder="Search supplier products..." value={search} onChange={e => setSearch(e.target.value)} autoFocus className="h-8" />
                    <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={() => setShowPicker(false)}><X className="w-4 h-4" /></Button>
                  </div>
                  <div className="max-h-72 overflow-y-auto space-y-1">
                    {filteredSPs.length === 0 ? (
                      <p className="text-center text-sm text-muted-foreground py-4">No products found</p>
                    ) : filteredSPs.map(sp => (
                      <button key={sp.id} className="w-full text-left px-3 py-2 rounded-lg hover:bg-muted/50 transition-colors" onClick={() => addProduct(sp)}>
                        <p className="text-sm font-medium">{sp.product_name}</p>
                        <p className="text-[10px] text-muted-foreground">{sp.product_sku}{sp.last_purchase_price ? ` · R${parseFloat(sp.last_purchase_price).toFixed(2)}` : ''}</p>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </>
          )}

          {/* Outstanding shortages / returns picker (supplier-wide) */}
          {showOutstanding && (
            <>
              <div className="fixed inset-0 bg-black/30 z-[210]" onClick={() => setShowOutstanding(false)} />
              <div className="fixed inset-0 z-[220] flex items-center justify-center p-4">
                <div className="bg-card rounded-xl shadow-2xl w-full max-w-lg p-4 space-y-3">
                  <div className="flex items-center gap-2">
                    <Search className="w-4 h-4 text-muted-foreground shrink-0" />
                    <Input placeholder="Search this supplier's open shortages, returns & price variances..." value={outSearch} onChange={e => setOutSearch(e.target.value)} autoFocus className="h-8" />
                    <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={() => setShowOutstanding(false)}><X className="w-4 h-4" /></Button>
                  </div>
                  <div className="max-h-80 overflow-y-auto space-y-1">
                    {filteredOutstanding.length === 0 ? (
                      <p className="text-center text-sm text-muted-foreground py-4">No outstanding shortages, returns or price variances for this supplier{scope === 'single' ? ' on this PO' : ''}.</p>
                    ) : filteredOutstanding.map(item => (
                      <button key={`${item.kind}-${item.id}`} className="w-full text-left px-3 py-2 rounded-lg hover:bg-muted/50 transition-colors flex items-start justify-between gap-3" onClick={() => addOutstanding(item)}>
                        <div className="min-w-0">
                          <p className="text-sm font-medium">{item.product_name}</p>
                          <p className="text-[10px] text-muted-foreground flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-0.5">
                            <span className={`px-1.5 py-0.5 rounded ${outBadge(item).cls}`}>{outBadge(item).label}</span>
                            {item.po_number && <span>PO {item.po_number}</span>}
                            {item.invoice_number && <span>INV {item.invoice_number}</span>}
                            {item.kind === 'return' && item.line_count > 0 && <span>{item.line_count} product{item.line_count !== 1 ? 's' : ''}</span>}
                          </p>
                        </div>
                        <div className="text-right shrink-0 text-[11px] text-muted-foreground">
                          {item.kind === 'shortage'
                            ? <>qty {item.expected_qty} · {fmtR(item.expected_qty * item.unit_cost)}</>
                            : item.kind === 'price'
                              ? <>+{(item.variance_pct || 0).toFixed(1)}% · {fmtR(item.over_value)}</>
                              : <>{fmtR(item.total_value)}</>}
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </>
          )}
        </div>

        {/* Warnings: short receival + price variance vs the linked shortage */}
        {warnings.length > 0 && (
          <div className="space-y-1.5">
            {warnings.map((w, i) => (
              <div key={i} className="flex items-start gap-2 px-3 py-2 rounded-lg bg-amber-50 border border-amber-200 text-amber-700 text-xs">
                <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                <span>{w.text}</span>
              </div>
            ))}
          </div>
        )}

        {/* Linked shortages & returns — audit trail + expected vs allocated */}
        {linkedSummary.length > 0 && (
          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase mb-2">Linked Shortages & Returns</p>
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-muted/50 border-b border-border text-[10px] uppercase text-muted-foreground">
                    <th className="text-left px-3 py-2 font-semibold">Item</th>
                    <th className="text-left px-3 py-2 font-semibold">Reference</th>
                    <th className="text-right px-3 py-2 font-semibold">Expected Qty</th>
                    <th className="text-right px-3 py-2 font-semibold">Expected Value</th>
                    <th className="text-right px-3 py-2 font-semibold">Allocated Qty</th>
                    <th className="text-right px-3 py-2 font-semibold">Allocated Value</th>
                    <th className="text-right px-3 py-2 font-semibold">Variance</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {linkedSummary.map(it => (
                    <tr key={it.key}>
                      <td className="px-3 py-2">
                        <span className={`px-1.5 py-0.5 rounded text-[10px] ${it.kind === 'return' ? 'bg-blue-100 text-blue-700' : 'bg-amber-100 text-amber-700'} mr-1`}>{it.kind}</span>
                        {it.label}
                      </td>
                      <td className="px-3 py-2 font-mono text-[11px]">{it.ref}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{it.expectedQty != null ? it.expectedQty : '—'}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{it.expectedValue != null ? fmtR(it.expectedValue) : '—'}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{it.allocatedQty}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{fmtR(it.allocatedValue)}</td>
                      <td className={`px-3 py-2 text-right tabular-nums ${it.valueVar != null && Math.abs(it.valueVar) > 0.001 ? 'text-amber-700 font-medium' : 'text-muted-foreground'}`}>
                        {it.valueVar != null ? fmtR(it.valueVar) : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Totals + captured/variance */}
        <div className="flex justify-end">
          <div className="w-72 space-y-1 text-sm">
            <div className="flex justify-between"><span className="text-muted-foreground">Subtotal (excl)</span><span className="tabular-nums">{fmtR(subtotal)}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">VAT</span><span className="tabular-nums">{fmtR(vat)}</span></div>
            <div className="flex justify-between font-semibold border-t border-border pt-1 mt-1"><span>Recalculated Total (incl)</span><span className="tabular-nums">{fmtR(viewMode ? existingCreditNote.total : total)}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Allocated to shortages/returns</span><span className="tabular-nums">{fmtR(allocatedIncl)}</span></div>
            {Math.abs(unallocated) > 0.001 && (
              <div className="flex justify-between text-amber-700"><span className="flex items-center gap-1"><AlertTriangle className="w-3.5 h-3.5" /> Unallocated (ad-hoc)</span><span className="tabular-nums">{fmtR(unallocated)}</span></div>
            )}
            <div className="flex justify-between items-center pt-1.5">
              <span className="text-muted-foreground">Captured Total (incl)</span>
              {viewMode ? (
                <span className="tabular-nums">{existingCreditNote.captured_total != null ? fmtR(existingCreditNote.captured_total) : '—'}</span>
              ) : (
                <Input type="number" step="0.01" min="0" value={capturedTotal} onChange={e => setCapturedTotal(e.target.value)} placeholder="0.00" className="h-8 w-32 text-right text-sm" />
              )}
            </div>
            {variance != null && Math.abs(variance) > 0.001 && (
              <div className="flex justify-between text-amber-700 font-medium pt-1">
                <span className="flex items-center gap-1"><AlertTriangle className="w-3.5 h-3.5" /> Total variance</span>
                <span className="tabular-nums">{fmtR(variance)}</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Footer */}
      {!viewMode && (
        <div className="sticky bottom-0 bg-card border-t border-border px-6 py-4 flex gap-3 shrink-0">
          <Button variant="outline" onClick={() => guardedClose(onCancel)} className="h-10">Cancel</Button>
          <div className="flex-1" />
          <Button variant="outline" onClick={handleSaveDraft} disabled={saving || lines.length === 0} className="gap-2 h-10">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Save Draft
          </Button>
          <Button onClick={handleSave} disabled={saving || lines.length === 0} className="gap-2 h-10 bg-purple-600 hover:bg-purple-700">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <CreditCard className="w-4 h-4" />}
            Record Credit Note
          </Button>
        </div>
      )}
    </div>
  );
}
