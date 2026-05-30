import React, { useState, useMemo, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { X, FileText, AlertTriangle, Loader2, Calendar, CheckCircle2, Plus, Search, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { computeDueDate } from '@/lib/utils';
import { upsertShortage, resolveShortageKind, shortageKind } from '@/lib/shortageEngine';

const PRICE_VARIANCE_THRESHOLD = 5; // percent

export default function CreateInvoiceFromPOModal({ po, onCreated, onCancel }) {
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [invoiceDate, setInvoiceDate] = useState(new Date().toISOString().slice(0, 10));
  const [dueDate, setDueDate] = useState('');
  const [notes, setNotes] = useState('');
  const [lineEdits, setLineEdits] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [showMismatchDialog, setShowMismatchDialog] = useState(false);
  const [mismatchDecisions, setMismatchDecisions] = useState({});
  // Blind receipt free-form line entry
  const [blindLines, setBlindLines] = useState([]);
  const [showProductPicker, setShowProductPicker] = useState(false);
  const [productSearch, setProductSearch] = useState('');

  const { data: poLines = [], isLoading: linesLoading } = useQuery({
    queryKey: ['po-lines', po.id],
    queryFn: () => base44.entities.PurchaseOrderLine.filter({ purchase_order_id: po.id }, 'created_date', 100),
  });

  const { data: grns = [] } = useQuery({
    queryKey: ['grns-for-po', po.id],
    queryFn: () => base44.entities.GoodsReceivedNote.filter(
      { purchase_order_id: po.id, status: 'confirmed' }, '-received_date', 10
    ),
  });
  const latestGRN = grns[0] || null;

  const { data: grnLines = [] } = useQuery({
    queryKey: ['grn-lines', latestGRN?.id],
    queryFn: () => base44.entities.GRNLine.filter({ grn_id: latestGRN.id }, 'product_name', 200),
    enabled: !!latestGRN?.id,
  });

  const { data: supplier = null } = useQuery({
    queryKey: ['supplier-single', po.supplier_id],
    queryFn: async () => {
      const list = await base44.entities.Supplier.filter({ id: po.supplier_id });
      return list[0] || null;
    },
    enabled: !!po.supplier_id,
  });

  // Existing central shortages for this PO — the invoice reflects decisions already
  // made on the GRN rather than re-asking.
  const { data: poShortages = [] } = useQuery({
    queryKey: ['po-shortages-for-invoice', po.id],
    queryFn: () => base44.entities.SupplierShortage.filter({ purchase_order_id: po.id }, '-created_date', 200),
    enabled: !!po.id,
  });

  // Open shortage kinds present per PO line: { [poLineId]: { await?, credit?, review? } }
  const existingByPoLine = useMemo(() => {
    const m = {};
    poShortages.forEach(s => {
      if (!s.po_line_id || ['resolved', 'cancelled'].includes(s.status)) return;
      const kind = shortageKind(s.decision);
      (m[s.po_line_id] = m[s.po_line_id] || {})[kind] = s;
    });
    return m;
  }, [poShortages]);

  const isBlindReceipt = po.type === 'blind_receipt';
  const isBlindMode = isBlindReceipt && !linesLoading && poLines.length === 0;

  // Supplier products for blind receipt product picker
  const { data: supplierProducts = [] } = useQuery({
    queryKey: ['supplier-products-for-invoice-br', po.supplier_id],
    queryFn: () => base44.entities.SupplierProduct.filter({ supplier_id: po.supplier_id, active: true }, 'product_name', 200),
    enabled: !!po.supplier_id && isBlindMode,
  });

  const filteredSPs = useMemo(() => {
    const existing = new Set(blindLines.map(l => l.product_id));
    let list = supplierProducts.filter(sp => !existing.has(sp.product_id));
    if (productSearch) {
      const q = productSearch.toLowerCase();
      list = list.filter(sp =>
        (sp.product_name || '').toLowerCase().includes(q) ||
        (sp.product_sku || '').toLowerCase().includes(q)
      );
    }
    return list.slice(0, 20);
  }, [supplierProducts, blindLines, productSearch]);

  const addBlindProduct = (sp) => {
    setBlindLines(prev => [...prev, {
      product_id: sp.product_id,
      product_name: sp.product_name,
      product_sku: sp.product_sku,
      supplier_product_id: sp.id,
      purchase_uom: sp.purchase_uom || '',
      invoiced_qty: String(1),
      unit_cost: String(parseFloat(sp.last_purchase_price) || 0),
    }]);
    setShowProductPicker(false);
    setProductSearch('');
  };

  const updateBlindLine = (idx, field, value) => {
    setBlindLines(prev => prev.map((l, i) => i === idx ? { ...l, [field]: value } : l));
  };

  const removeBlindLine = (idx) => {
    setBlindLines(prev => prev.filter((_, i) => i !== idx));
  };

  const blindRows = useMemo(() => blindLines.map(l => ({
    ...l,
    invoicedQty: parseFloat(l.invoiced_qty) || 0,
    invCost: parseFloat(l.unit_cost) || 0,
    lineTotal: Math.round((parseFloat(l.invoiced_qty) || 0) * (parseFloat(l.unit_cost) || 0) * 100) / 100,
  })), [blindLines]);

  const grnLineByProductId = useMemo(() => {
    const map = {};
    grnLines.forEach(gl => { if (gl.product_id) map[gl.product_id] = gl; });
    return map;
  }, [grnLines]);

  // Recalculate due date whenever invoice date or supplier payment terms change.
  // supplier loads async so this handles both the initial load and manual date changes.
  useEffect(() => {
    if (!supplier?.payment_terms_basis || !invoiceDate) return;
    const calc = computeDueDate(invoiceDate, supplier.payment_terms_basis, supplier.payment_terms_days, supplier.payment_terms_cutoff_day);
    if (calc) setDueDate(calc.toISOString().slice(0, 10));
  }, [supplier?.payment_terms_basis, supplier?.payment_terms_days, supplier?.payment_terms_cutoff_day, invoiceDate]);

  const handleInvoiceDateChange = (date) => {
    setInvoiceDate(date);
  };

  const getReceivedQty = (poLine) => {
    if (isBlindReceipt) return parseFloat(poLine.ordered_qty) || 0;
    const grnLine = grnLineByProductId[poLine.product_id];
    return parseFloat(grnLine?.received_qty) || 0;
  };

  const getEdit = (poLine) => {
    const receivedQty = getReceivedQty(poLine);
    return {
      invoiced_qty: String(receivedQty || parseFloat(poLine.ordered_qty) || 0),
      unit_cost: String(parseFloat(poLine.unit_cost) || 0),
      ...lineEdits[poLine.id],
    };
  };

  const setEdit = (poLineId, field, value) => {
    setLineEdits(prev => ({ ...prev, [poLineId]: { ...prev[poLineId], [field]: value } }));
  };

  const rows = useMemo(() => poLines.map(poLine => {
    const grnLine = isBlindReceipt ? null : grnLineByProductId[poLine.product_id];
    const edit = getEdit(poLine);
    const orderedQty = parseFloat(poLine.ordered_qty) || 0;
    const receivedQty = getReceivedQty(poLine);
    const invoicedQty = parseFloat(edit.invoiced_qty) || 0;
    const invCost = parseFloat(edit.unit_cost) || 0;
    const poCost = parseFloat(poLine.unit_cost) || 0;
    const varPct = poCost > 0 ? ((invCost - poCost) / poCost) * 100 : 0;
    return {
      poLine,
      grnLine,
      orderedQty,
      receivedQty,
      invoicedQty,
      invCost,
      poCost,
      varPct,
      priceFlag: Math.abs(varPct) >= PRICE_VARIANCE_THRESHOLD,
      qtyMismatch: invoicedQty > receivedQty,
      lineTotal: Math.round(invoicedQty * invCost * 100) / 100,
    };
  }), [poLines, grnLineByProductId, lineEdits, isBlindReceipt]); // eslint-disable-line react-hooks/exhaustive-deps

  const activeRows = isBlindMode ? blindRows : rows;
  const subtotal = activeRows.reduce((s, r) => s + r.lineTotal, 0);
  const taxRate = parseFloat(po.tax_rate) || 0.15;
  const taxAmount = Math.round(subtotal * taxRate * 100) / 100;
  const total = Math.round((subtotal + taxAmount) * 100) / 100;
  const mismatchedRows = isBlindMode ? [] : rows.filter(r => r.qtyMismatch);
  // Only lines billed above received AND with no existing GRN decision need a prompt.
  const linesNeedingDecision = isBlindMode ? [] : rows.filter(r =>
    r.invoicedQty > r.receivedQty && !existingByPoLine[r.poLine.id]
  );

  const handleSubmitClick = () => {
    if (!invoiceNumber.trim()) { toast.error('Enter the supplier invoice number'); return; }
    if (!invoiceDate) { toast.error('Select the invoice date'); return; }
    if (isBlindMode && blindLines.length === 0) { toast.error('Add at least one product line'); return; }
    if (linesNeedingDecision.length > 0) {
      const initial = {};
      linesNeedingDecision.forEach(r => { initial[r.poLine.id] = 'receive_later'; });
      setMismatchDecisions(initial);
      setShowMismatchDialog(true);
      return;
    }
    submitInvoice({});
  };

  const submitInvoice = async (decisions) => {
    setSubmitting(true);
    try {
      // For blind receipts, create PO lines from the entered invoice lines first
      const poLineIdMap = {}; // product_id → po_line_id (for invoice line linking)
      if (isBlindMode) {
        for (const bl of blindLines) {
          const poline = await base44.entities.PurchaseOrderLine.create({
            purchase_order_id: po.id,
            product_id: bl.product_id,
            product_name: bl.product_name,
            product_sku: bl.product_sku,
            supplier_product_id: bl.supplier_product_id || null,
            ordered_qty: parseFloat(bl.invoiced_qty) || 0,
            received_qty: 0,
            unit_cost: parseFloat(bl.unit_cost) || 0,
            uom: bl.purchase_uom || '',
            tax_rule: 'VAT 15%',
            line_total: Math.round((parseFloat(bl.invoiced_qty) || 0) * (parseFloat(bl.unit_cost) || 0) * 100) / 100,
          });
          poLineIdMap[bl.product_id] = poline.id;
        }
      }

      const invoice = await base44.entities.PurchaseInvoice.create({
        invoice_number: invoiceNumber.trim(),
        supplier_id: po.supplier_id,
        supplier_name: po.supplier_name,
        purchase_order_id: po.id,
        grn_id: latestGRN?.id || null,
        invoice_date: invoiceDate,
        due_date: dueDate || null,
        due_date_calculated: dueDate || null,
        source: 'manual',
        status: 'approved',
        payment_status: 'unpaid',
        subtotal: Math.round(subtotal * 100) / 100,
        tax_amount: taxAmount,
        total,
        currency: po.currency || 'ZAR',
        notes: notes || null,
        unmatched_line_count: 0,
      });

      if (isBlindMode) {
        for (const bl of blindLines) {
          const qty = parseFloat(bl.invoiced_qty) || 0;
          const cost = parseFloat(bl.unit_cost) || 0;
          await base44.entities.PurchaseInvoiceLine.create({
            invoice_id: invoice.id,
            po_line_id: poLineIdMap[bl.product_id] || null,
            product_id: bl.product_id,
            product_name: bl.product_name,
            product_sku: bl.product_sku,
            supplier_product_id: bl.supplier_product_id || null,
            ordered_qty: qty,
            received_qty: 0,
            qty,
            unit_cost: cost,
            tax_rule: 'VAT 15%',
            line_total: Math.round(qty * cost * 100) / 100,
            match_status: 'manually_matched',
          });
        }
      } else {
        for (const row of rows) {
          await base44.entities.PurchaseInvoiceLine.create({
            invoice_id: invoice.id,
            po_line_id: row.poLine.id,
            grn_line_id: row.grnLine?.id || null,
            product_id: row.poLine.product_id,
            product_name: row.poLine.product_name,
            product_sku: row.poLine.product_sku,
            supplier_product_id: row.poLine.supplier_product_id || null,
            ordered_qty: row.orderedQty,
            received_qty: row.receivedQty,
            qty: row.invoicedQty,
            unit_cost: row.invCost,
            tax_rule: row.poLine.tax_rule || 'VAT 15%',
            line_total: row.lineTotal,
            match_status: 'manually_matched',
            price_variance_pct: Math.round(row.varPct * 10) / 10,
            price_variance_flagged: row.priceFlag,
            account_code: row.poLine.account_code || null,
          });
        }
      }

      // Reconcile the central shortage(s) for each PO line against this invoice.
      // The invoice READS the existing GRN decision and updates the SAME records —
      // it never creates a duplicate shortage.
      let anyCredit = false;
      let anyAwait = false;
      if (!isBlindMode) {
        for (const row of rows) {
          const lineId = row.poLine.id;
          const billedShort = row.invoicedQty - row.receivedQty;
          const existing = existingByPoLine[lineId] || {};
          const dialogDecision = decisions[lineId]; // only set for lines that needed a choice

          const baseFields = {
            poLineId: lineId,
            purchaseOrderId: po.id,
            productId: row.poLine.product_id,
            grn_id: latestGRN?.id || null,
            grn_line_id: row.grnLine?.id || null,
            supplier_id: po.supplier_id,
            supplier_name: po.supplier_name,
            product_name: row.poLine.product_name,
            product_sku: row.poLine.product_sku,
            ordered_qty: row.orderedQty,
            received_qty: row.receivedQty,
            purchase_uom: row.poLine.purchase_uom || row.grnLine?.purchase_uom || '',
            unit_cost: row.invCost,
            status: 'open',
            invoice_id: invoice.id,
            invoice_number: invoiceNumber.trim(),
          };

          if (billedShort > 0.0001) {
            // Supplier billed for more than was received → credit needed unless we still await stock
            const effective = dialogDecision
              || (existing.credit ? 'request_credit'
                : existing.await ? 'receive_later'
                : existing.review ? 'review'
                : 'request_credit');
            if (effective === 'request_credit') {
              await upsertShortage({ ...baseFields, decision: 'request_credit', shortage_qty: billedShort, credit_qty: billedShort, awaiting_qty: 0, credit_follow_up_status: 'credit_required' });
              anyCredit = true;
            } else if (effective === 'review') {
              await upsertShortage({ ...baseFields, decision: 'review', shortage_qty: billedShort });
              anyAwait = true;
            } else {
              await upsertShortage({ ...baseFields, decision: 'await_receival', shortage_qty: billedShort, awaiting_qty: billedShort, credit_qty: 0 });
              anyAwait = true;
            }
          } else {
            // Invoice billed only the received qty (or less) → no credit required.
            // Close any open credit shortage; an await shortage (stock still expected) stays.
            await resolveShortageKind(
              lineId, 'credit',
              'Supplier invoiced only the received quantity — no credit required',
              { purchaseOrderId: po.id, productId: row.poLine.product_id }
            );
            if (existing.await) anyAwait = true;
          }
        }
      }

      const newPoStatus = anyCredit ? 'credit_note_pending' : anyAwait ? 'partially_received' : 'invoiced';

      await base44.entities.PurchaseOrder.update(po.id, {
        status: newPoStatus,
        invoice_count: (po.invoice_count || 0) + 1,
        supplier_invoice_number: invoiceNumber.trim(),
      });

      toast.success('Invoice created');
      onCreated();
    } catch (err) {
      toast.error('Failed to create invoice: ' + (err?.message || 'Unknown error'));
    } finally {
      setSubmitting(false);
    }
  };

  if (showMismatchDialog) {
    return (
      <div className="fixed inset-0 z-[200] flex items-center justify-center">
        <div className="absolute inset-0 bg-black/40" />
        <div className="relative z-10 bg-card rounded-xl shadow-2xl w-full max-w-lg p-6">
          <div className="flex items-start gap-3 mb-4">
            <AlertTriangle className="w-5 h-5 text-amber-500 mt-0.5 shrink-0" />
            <div>
              <h3 className="font-semibold text-base">Invoice quantity exceeds received quantity</h3>
              <p className="text-sm text-muted-foreground mt-1">
                The supplier invoiced more than was received for the items below. Choose how to handle each difference.
              </p>
            </div>
          </div>

          <div className="space-y-3 mb-6">
            {linesNeedingDecision.map(row => (
              <div key={row.poLine.id} className="border border-border rounded-lg p-3">
                <p className="text-sm font-medium mb-1">{row.poLine.product_name}</p>
                <p className="text-xs text-muted-foreground mb-2">
                  Received: <span className="font-semibold">{row.receivedQty}</span>
                  {' · '}Invoiced: <span className="font-semibold">{row.invoicedQty}</span>
                  {' · '}Difference: <span className="font-semibold text-amber-600">{(row.invoicedQty - row.receivedQty).toFixed(3).replace(/\.?0+$/, '')}</span>
                </p>
                <div className="grid grid-cols-3 gap-2">
                  <button
                    onClick={() => setMismatchDecisions(prev => ({ ...prev, [row.poLine.id]: 'receive_later' }))}
                    className={`text-xs rounded-lg px-3 py-2 border transition-colors text-left ${
                      mismatchDecisions[row.poLine.id] === 'receive_later'
                        ? 'border-blue-500 bg-blue-50 text-blue-700 font-semibold'
                        : 'border-border hover:border-blue-300 text-muted-foreground'
                    }`}
                  >
                    <div className="font-medium">Stock still expected</div>
                    <div className="text-[10px] mt-0.5 opacity-75">PO stays open for another GRN</div>
                  </button>
                  <button
                    onClick={() => setMismatchDecisions(prev => ({ ...prev, [row.poLine.id]: 'request_credit' }))}
                    className={`text-xs rounded-lg px-3 py-2 border transition-colors text-left ${
                      mismatchDecisions[row.poLine.id] === 'request_credit'
                        ? 'border-orange-500 bg-orange-50 text-orange-700 font-semibold'
                        : 'border-border hover:border-orange-300 text-muted-foreground'
                    }`}
                  >
                    <div className="font-medium">Credit note expected</div>
                    <div className="text-[10px] mt-0.5 opacity-75">Moves to Credit Note Pending</div>
                  </button>
                  <button
                    onClick={() => setMismatchDecisions(prev => ({ ...prev, [row.poLine.id]: 'review' }))}
                    className={`text-xs rounded-lg px-3 py-2 border transition-colors text-left ${
                      mismatchDecisions[row.poLine.id] === 'review'
                        ? 'border-gray-500 bg-gray-100 text-gray-700 font-semibold'
                        : 'border-border hover:border-gray-300 text-muted-foreground'
                    }`}
                  >
                    <div className="font-medium">Mark for review</div>
                    <div className="text-[10px] mt-0.5 opacity-75">Decide later</div>
                  </button>
                </div>
              </div>
            ))}
          </div>

          <div className="flex gap-3">
            <Button variant="outline" onClick={() => setShowMismatchDialog(false)} className="flex-1">Back</Button>
            <Button
              onClick={() => { setShowMismatchDialog(false); submitInvoice(mismatchDecisions); }}
              disabled={submitting}
              className="flex-1 gap-2"
            >
              {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
              Confirm &amp; Create Invoice
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[200] flex flex-col bg-card">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border shrink-0 bg-card">
          <div>
            <h2 className="text-base font-bold flex items-center gap-2">
              <FileText className="w-5 h-5 text-primary" />
              Create Supplier Invoice
            </h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              {po.po_number} · {po.supplier_name}
              {latestGRN && <> · GRN {latestGRN.grn_number} received {latestGRN.received_date}</>}
            </p>
          </div>
          <Button variant="ghost" size="icon" onClick={onCancel}><X className="w-5 h-5" /></Button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-5">
          {/* Invoice header fields */}
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <div className="sm:col-span-2">
              <label className="text-[10px] font-semibold text-muted-foreground uppercase">Supplier Invoice Number *</label>
              <Input
                value={invoiceNumber}
                onChange={e => setInvoiceNumber(e.target.value)}
                placeholder="e.g. INV-2024-001"
                className="mt-1"
              />
            </div>
            <div>
              <label className="text-[10px] font-semibold text-muted-foreground uppercase">Invoice Date *</label>
              <Input
                type="date"
                value={invoiceDate}
                onChange={e => handleInvoiceDateChange(e.target.value)}
                className="mt-1"
              />
            </div>
            <div>
              <label className="text-[10px] font-semibold text-muted-foreground uppercase">
                Due Date
                {supplier?.payment_terms_label && (
                  <span className="ml-1 normal-case font-normal text-muted-foreground/70">({supplier.payment_terms_label})</span>
                )}
              </label>
              <Input
                type="date"
                value={dueDate}
                onChange={e => setDueDate(e.target.value)}
                className="mt-1"
              />
            </div>
            <div className="sm:col-span-4">
              <label className="text-[10px] font-semibold text-muted-foreground uppercase">Notes</label>
              <Input
                value={notes}
                onChange={e => setNotes(e.target.value)}
                placeholder="Optional notes..."
                className="mt-1"
              />
            </div>
          </div>

          {/* Lines table */}
          {linesLoading ? (
            <div className="text-center py-8 text-sm text-muted-foreground">Loading lines...</div>
          ) : isBlindMode ? (
            /* Blind receipt: free-form product entry */
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold text-muted-foreground uppercase">Invoice Lines</p>
                <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setShowProductPicker(true)}>
                  <Plus className="w-3.5 h-3.5" /> Add Product
                </Button>
              </div>
              {blindLines.length === 0 ? (
                <div
                  className="text-center py-8 border border-dashed border-border rounded-lg cursor-pointer hover:bg-muted/30 transition-colors"
                  onClick={() => setShowProductPicker(true)}
                >
                  <Plus className="w-5 h-5 text-muted-foreground mx-auto mb-1" />
                  <p className="text-sm text-muted-foreground">Add products from supplier catalog</p>
                </div>
              ) : (
                <div className="overflow-x-auto rounded-lg border border-border">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-muted/50 border-b border-border">
                        <th className="text-left px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase">Product</th>
                        <th className="text-right px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase w-24">Qty</th>
                        <th className="text-right px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase w-28">Unit Cost</th>
                        <th className="text-right px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase w-24">Line Total</th>
                        <th className="w-8" />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {blindLines.map((bl, idx) => (
                        <tr key={idx}>
                          <td className="px-3 py-2">
                            <div className="font-medium">{bl.product_name}</div>
                            <div className="text-[10px] font-mono text-muted-foreground">{bl.product_sku}</div>
                            {bl.purchase_uom && <div className="text-[10px] text-muted-foreground">{bl.purchase_uom}</div>}
                          </td>
                          <td className="px-3 py-2 text-right">
                            <Input type="number" min="0" step="any" value={bl.invoiced_qty}
                              onChange={e => updateBlindLine(idx, 'invoiced_qty', e.target.value)}
                              className="w-20 h-7 text-right text-sm ml-auto" />
                          </td>
                          <td className="px-3 py-2 text-right">
                            <Input type="number" min="0" step="any" value={bl.unit_cost}
                              onChange={e => updateBlindLine(idx, 'unit_cost', e.target.value)}
                              className="w-24 h-7 text-right text-sm ml-auto" />
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums font-medium">
                            R {(Math.round((parseFloat(bl.invoiced_qty) || 0) * (parseFloat(bl.unit_cost) || 0) * 100) / 100).toFixed(2)}
                          </td>
                          <td className="px-2 py-2">
                            <Button variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground hover:text-red-600"
                              onClick={() => removeBlindLine(idx)}>
                              <Trash2 className="w-3.5 h-3.5" />
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Product picker */}
              {showProductPicker && (
                <>
                  <div className="fixed inset-0 bg-black/30 z-[210]" onClick={() => setShowProductPicker(false)} />
                  <div className="fixed inset-0 z-[220] flex items-center justify-center p-4">
                    <div className="bg-card rounded-xl shadow-2xl w-full max-w-md p-4 space-y-3">
                      <div className="flex items-center gap-2">
                        <Search className="w-4 h-4 text-muted-foreground shrink-0" />
                        <Input
                          placeholder="Search supplier products..."
                          value={productSearch}
                          onChange={e => setProductSearch(e.target.value)}
                          autoFocus
                          className="h-8"
                        />
                        <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={() => setShowProductPicker(false)}>
                          <X className="w-4 h-4" />
                        </Button>
                      </div>
                      <div className="max-h-72 overflow-y-auto space-y-1">
                        {filteredSPs.length === 0 ? (
                          <p className="text-center text-sm text-muted-foreground py-4">No products found</p>
                        ) : filteredSPs.map(sp => (
                          <button key={sp.id}
                            className="w-full text-left px-3 py-2 rounded-lg hover:bg-muted/50 transition-colors"
                            onClick={() => addBlindProduct(sp)}
                          >
                            <p className="text-sm font-medium">{sp.product_name}</p>
                            <p className="text-[10px] text-muted-foreground">
                              {sp.product_sku} · {sp.purchase_uom}
                              {sp.last_purchase_price ? ` · R${parseFloat(sp.last_purchase_price).toFixed(2)}` : ''}
                            </p>
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                </>
              )}
            </div>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-muted/50 border-b border-border">
                    <th className="text-left px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase">Product</th>
                    <th className="text-right px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase">Ordered</th>
                    <th className="text-right px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase">Received</th>
                    <th className="text-right px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase">Invoiced Qty</th>
                    <th className="text-right px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase">Expected Cost</th>
                    <th className="text-right px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase">Invoice Cost</th>
                    <th className="text-right px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase">Variance</th>
                    <th className="text-right px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase">Line Total</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr
                      key={row.poLine.id}
                      className={`border-b border-border last:border-0 ${row.qtyMismatch ? 'bg-amber-50/60' : ''}`}
                    >
                      <td className="px-3 py-2">
                        <div className="font-medium">{row.poLine.product_name}</div>
                        {row.poLine.product_sku && (
                          <div className="text-[10px] text-muted-foreground">{row.poLine.product_sku}</div>
                        )}
                        {row.poLine.purchase_uom && (
                          <div className="text-[10px] text-muted-foreground">{row.poLine.purchase_uom}</div>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{row.orderedQty}</td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {row.receivedQty > 0 ? (
                          <span className={row.receivedQty < row.orderedQty ? 'text-amber-600 font-medium' : ''}>
                            {row.receivedQty}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <div className="flex items-center justify-end gap-1">
                          {row.qtyMismatch && <AlertTriangle className="w-3.5 h-3.5 text-amber-500 shrink-0" />}
                          <Input
                            type="number"
                            min="0"
                            step="any"
                            value={getEdit(row.poLine).invoiced_qty}
                            onChange={e => setEdit(row.poLine.id, 'invoiced_qty', e.target.value)}
                            className="w-20 h-7 text-right text-sm"
                          />
                        </div>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                        R {row.poCost.toFixed(2)}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <Input
                          type="number"
                          min="0"
                          step="any"
                          value={getEdit(row.poLine).unit_cost}
                          onChange={e => setEdit(row.poLine.id, 'unit_cost', e.target.value)}
                          className="w-24 h-7 text-right text-sm"
                        />
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {row.priceFlag ? (
                          <span className="inline-flex items-center gap-1 text-amber-600 font-medium">
                            <AlertTriangle className="w-3.5 h-3.5" />
                            {row.varPct > 0 ? '+' : ''}{row.varPct.toFixed(1)}%
                          </span>
                        ) : (
                          <span className="text-muted-foreground text-xs">
                            {row.poCost > 0 ? `${row.varPct > 0 ? '+' : ''}${row.varPct.toFixed(1)}%` : '—'}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums font-medium">
                        R {row.lineTotal.toFixed(2)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Warnings — only for regular PO mode */}
          {rows.some(r => r.priceFlag) && (
            <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-amber-50 border border-amber-200 text-amber-700 text-sm">
              <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
              <span>One or more lines have a price variance of 5% or more compared to the expected purchase order cost. Review before confirming.</span>
            </div>
          )}
          {mismatchedRows.length > 0 && (
            <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-amber-50 border border-amber-200 text-amber-700 text-sm">
              <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
              <span>
                {mismatchedRows.length === 1 ? '1 line has' : `${mismatchedRows.length} lines have`} an invoiced quantity greater than the received quantity.
                {linesNeedingDecision.length > 0
                  ? ' You will be asked how to handle the lines without an existing GRN decision before saving.'
                  : ' These already have a GRN decision, which the invoice will follow.'}
              </span>
            </div>
          )}

          {/* Totals */}
          <div className="flex justify-end">
            <div className="w-64 space-y-1 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Subtotal</span>
                <span className="tabular-nums">R {subtotal.toFixed(2)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">VAT ({Math.round(taxRate * 100)}%)</span>
                <span className="tabular-nums">R {taxAmount.toFixed(2)}</span>
              </div>
              <div className="flex justify-between font-semibold border-t border-border pt-1 mt-1">
                <span>Total</span>
                <span className="tabular-nums">R {total.toFixed(2)}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="sticky bottom-0 bg-card border-t border-border px-6 py-4 flex gap-3 shrink-0">
          <Button variant="outline" onClick={onCancel} className="h-10">Cancel</Button>
          <div className="flex-1" />
          <Button
            onClick={handleSubmitClick}
            disabled={submitting || linesLoading}
            className="gap-2 h-10 bg-purple-600 hover:bg-purple-700"
          >
            {submitting
              ? <Loader2 className="w-4 h-4 animate-spin" />
              : <FileText className="w-4 h-4" />}
            {linesNeedingDecision.length > 0 ? 'Review Differences & Create Invoice' : 'Create Invoice'}
          </Button>
        </div>
    </div>
  );
}
