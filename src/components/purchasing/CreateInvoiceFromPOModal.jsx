import React, { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { X, FileText, AlertTriangle, Loader2, Calendar, CheckCircle2 } from 'lucide-react';
import { toast } from 'sonner';
import { calculateDueDate } from '@/lib/utils';

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

  const isBlindReceipt = po.type === 'blind_receipt';

  const grnLineByProductId = useMemo(() => {
    const map = {};
    grnLines.forEach(gl => { if (gl.product_id) map[gl.product_id] = gl; });
    return map;
  }, [grnLines]);

  const handleInvoiceDateChange = (date) => {
    setInvoiceDate(date);
    if (supplier?.payment_terms_basis && date) {
      const calc = calculateDueDate(date, supplier.payment_terms_basis, supplier.payment_terms_days);
      if (calc) setDueDate(calc.toISOString().slice(0, 10));
    }
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

  const subtotal = rows.reduce((s, r) => s + r.lineTotal, 0);
  const taxRate = parseFloat(po.tax_rate) || 0.15;
  const taxAmount = Math.round(subtotal * taxRate * 100) / 100;
  const total = Math.round((subtotal + taxAmount) * 100) / 100;
  const mismatchedRows = rows.filter(r => r.qtyMismatch);

  const handleSubmitClick = () => {
    if (!invoiceNumber.trim()) { toast.error('Enter the supplier invoice number'); return; }
    if (!invoiceDate) { toast.error('Select the invoice date'); return; }
    if (mismatchedRows.length > 0) {
      const initial = {};
      mismatchedRows.forEach(r => { initial[r.poLine.id] = 'receive_later'; });
      setMismatchDecisions(initial);
      setShowMismatchDialog(true);
      return;
    }
    submitInvoice({});
  };

  const submitInvoice = async (decisions) => {
    setSubmitting(true);
    try {
      const decisionValues = Object.values(decisions);
      const newPoStatus = decisionValues.some(d => d === 'request_credit')
        ? 'credit_note_pending'
        : decisionValues.some(d => d === 'receive_later')
          ? 'partially_received'
          : 'invoiced';

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

      // Create SupplierShortage for request_credit decisions
      for (const [poLineId, decision] of Object.entries(decisions)) {
        if (decision !== 'request_credit') continue;
        const row = rows.find(r => r.poLine.id === poLineId);
        if (!row) continue;
        const shortageQty = row.invoicedQty - row.receivedQty;
        await base44.entities.SupplierShortage.create({
          grn_id: latestGRN?.id || null,
          grn_line_id: row.grnLine?.id || null,
          supplier_id: po.supplier_id,
          supplier_name: po.supplier_name,
          product_id: row.poLine.product_id,
          product_name: row.poLine.product_name,
          product_sku: row.poLine.product_sku,
          shortage_qty: shortageQty,
          shortage_value: Math.round(shortageQty * row.invCost * 100) / 100,
          purchase_uom: row.poLine.purchase_uom || row.grnLine?.purchase_uom || '',
          unit_cost: row.invCost,
          status: 'open',
          credit_follow_up_status: 'credit_required',
          invoice_id: invoice.id,
          invoice_number: invoiceNumber.trim(),
        });
      }

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
      <div className="fixed inset-0 z-[60] flex items-center justify-center">
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
            {mismatchedRows.map(row => (
              <div key={row.poLine.id} className="border border-border rounded-lg p-3">
                <p className="text-sm font-medium mb-1">{row.poLine.product_name}</p>
                <p className="text-xs text-muted-foreground mb-2">
                  Received: <span className="font-semibold">{row.receivedQty}</span>
                  {' · '}Invoiced: <span className="font-semibold">{row.invoicedQty}</span>
                  {' · '}Difference: <span className="font-semibold text-amber-600">{(row.invoicedQty - row.receivedQty).toFixed(3).replace(/\.?0+$/, '')}</span>
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={() => setMismatchDecisions(prev => ({ ...prev, [row.poLine.id]: 'receive_later' }))}
                    className={`flex-1 text-xs rounded-lg px-3 py-2 border transition-colors text-left ${
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
                    className={`flex-1 text-xs rounded-lg px-3 py-2 border transition-colors text-left ${
                      mismatchDecisions[row.poLine.id] === 'request_credit'
                        ? 'border-orange-500 bg-orange-50 text-orange-700 font-semibold'
                        : 'border-border hover:border-orange-300 text-muted-foreground'
                    }`}
                  >
                    <div className="font-medium">Credit note expected</div>
                    <div className="text-[10px] mt-0.5 opacity-75">Moves to Credit Note Pending</div>
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
    <div className="fixed inset-0 z-[60] flex flex-col bg-card">
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

          {/* Warnings */}
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
                You will be asked how to handle the difference before the invoice is saved.
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
            {mismatchedRows.length > 0 ? 'Review Differences & Create Invoice' : 'Create Invoice'}
          </Button>
        </div>
    </div>
  );
}
