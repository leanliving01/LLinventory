import React, { useState, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { AlertTriangle, ExternalLink, Link2, X, CheckCircle2, Plus, RotateCcw, Loader2, Pencil, FileText } from 'lucide-react';
import { toast } from 'sonner';
import { formatPaymentTerms } from '@/lib/utils';
import ValidationErrorBanner from '@/components/purchasing/ValidationErrorBanner';
import CreateInvoiceFromPOModal from '@/components/purchasing/CreateInvoiceFromPOModal';

// Round a qty for display: 2 decimals, no trailing zeros.
const fmtQty = (n) => {
  const v = parseFloat(n);
  if (!isFinite(v) || v === 0) return '0';
  return String(Math.round(v * 100) / 100);
};
const fmtMoney = (n) =>
  `R ${(parseFloat(n) || 0).toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function validateInvoice(invoice, invoiceLines) {
  const errors = [];
  if (!invoice) { errors.push('No invoice linked to this PO.'); return errors; }
  if (!invoice.invoice_number) errors.push('Invoice number is missing.');
  if (!invoice.invoice_date) errors.push('Invoice date is missing.');
  if (!invoice.supplier_id) errors.push('Supplier is not linked.');
  if ((invoice.total || 0) <= 0) errors.push('Invoice total must be greater than zero.');
  if (invoiceLines.length === 0) errors.push('Invoice has no line items.');
  invoiceLines.forEach((l, i) => {
    if (!l.product_id && !l.description) errors.push(`Line ${i + 1}: product mapping or description is required.`);
    if ((parseFloat(l.qty) || 0) <= 0) errors.push(`Line ${i + 1}: quantity must be greater than zero.`);
  });
  return errors;
}

// ---------------------------------------------------------------------------
// Purchase order line — Ordered / Received (now live from the PO line itself)
// ---------------------------------------------------------------------------
function POLineRow({ line, receivedOverride }) {
  const sp = line.supplier_product_url;
  const ordered = parseFloat(line.ordered_qty) || 0;
  // Prefer the live GRN-derived figure (covers legacy POs whose received_qty was
  // never written back); fall back to the PO line's own column.
  const received = receivedOverride != null ? receivedOverride : (parseFloat(line.received_qty) || 0);
  const short = Math.max(0, ordered - received);
  return (
    <tr>
      <td className="px-3 py-2">
        <p className="text-sm font-medium">{line.product_name}</p>
        <p className="text-[10px] font-mono text-muted-foreground">{line.product_sku}</p>
        {sp && (
          <a href={sp} target="_blank" rel="noopener noreferrer"
            className="text-[10px] text-primary hover:underline flex items-center gap-0.5 mt-0.5">
            Supplier <ExternalLink className="w-2.5 h-2.5" />
          </a>
        )}
      </td>
      <td className="px-3 py-2 text-right text-sm tabular-nums">{fmtQty(ordered)}</td>
      <td className="px-3 py-2 text-right text-sm tabular-nums">
        {received > 0 ? (
          <span className={received < ordered ? 'text-amber-600 font-medium' : 'text-green-700 font-medium'}>
            {fmtQty(received)}
          </span>
        ) : <span className="text-muted-foreground">—</span>}
      </td>
      <td className="px-3 py-2 text-right text-sm tabular-nums">
        {short > 0 ? <span className="text-amber-600 font-medium">{fmtQty(short)}</span> : <span className="text-muted-foreground">—</span>}
      </td>
      <td className="px-3 py-2 text-right text-sm tabular-nums">{fmtMoney(line.unit_cost)}</td>
      <td className="px-3 py-2 text-right text-sm font-medium tabular-nums">{fmtMoney(line.line_total)}</td>
    </tr>
  );
}

// ---------------------------------------------------------------------------
// Invoice line — Ordered / Received / Invoiced / Short / Unit Cost / Variance / Total
// Reads the real columns: qty (invoiced), unit_cost, ordered_qty, received_qty,
// price_variance_pct. Falls back to the matched PO line where the invoice line
// didn't capture ordered/received (older rows).
// ---------------------------------------------------------------------------
function InvoiceLineRow({ line, poLine, receivedOverride }) {
  const invoicedQty = parseFloat(line.qty) || 0;
  const unitCost = parseFloat(line.unit_cost) || 0;
  const orderedQty = parseFloat(line.ordered_qty ?? poLine?.ordered_qty) || 0;
  const receivedQty = receivedOverride != null
    ? receivedOverride
    : parseFloat(line.received_qty ?? poLine?.received_qty) || 0;
  const lineTotal = line.line_total != null ? parseFloat(line.line_total) : invoicedQty * unitCost;

  const shortReceived = Math.max(0, orderedQty - receivedQty);
  const billedOverReceived = receivedQty > 0 && invoicedQty > receivedQty;

  // Price variance: prefer the stored pct; else derive from the PO cost.
  const poCost = parseFloat(poLine?.unit_cost) || 0;
  const varPct = line.price_variance_pct != null
    ? parseFloat(line.price_variance_pct)
    : (poCost > 0 ? ((unitCost - poCost) / poCost) * 100 : null);
  const priceFlagged = !!line.price_variance_flagged || (varPct != null && Math.abs(varPct) >= 5);

  const rowFlagged = billedOverReceived || priceFlagged;

  return (
    <tr className={rowFlagged ? 'bg-amber-50' : ''}>
      <td className="px-3 py-2">
        <p className="text-sm font-medium">{line.product_name || line.description}</p>
        <p className="text-[10px] font-mono text-muted-foreground">{line.product_sku}</p>
      </td>
      <td className="px-3 py-2 text-right text-sm tabular-nums text-muted-foreground">
        {orderedQty > 0 ? fmtQty(orderedQty) : '—'}
      </td>
      <td className="px-3 py-2 text-right text-sm tabular-nums">
        {receivedQty > 0
          ? <span className={receivedQty < orderedQty ? 'text-amber-600 font-medium' : ''}>{fmtQty(receivedQty)}</span>
          : <span className="text-muted-foreground">—</span>}
      </td>
      <td className={`px-3 py-2 text-right text-sm tabular-nums ${billedOverReceived ? 'text-amber-700 font-semibold' : ''}`}>
        <span className="inline-flex items-center justify-end gap-1">
          {billedOverReceived && <AlertTriangle className="w-3 h-3 text-amber-500" />}
          {fmtQty(invoicedQty)}
        </span>
      </td>
      <td className="px-3 py-2 text-right text-sm tabular-nums">
        {shortReceived > 0 ? <span className="text-amber-600 font-medium">{fmtQty(shortReceived)}</span> : <span className="text-muted-foreground">—</span>}
      </td>
      <td className="px-3 py-2 text-right text-sm tabular-nums">{fmtMoney(unitCost)}</td>
      <td className="px-3 py-2 text-right text-sm tabular-nums">
        {varPct == null ? (
          <span className="text-muted-foreground">—</span>
        ) : priceFlagged ? (
          <span className="inline-flex items-center gap-1 text-amber-600 font-semibold">
            <AlertTriangle className="w-3 h-3" />{varPct > 0 ? '+' : ''}{varPct.toFixed(1)}%
          </span>
        ) : (
          <span className="text-muted-foreground">{varPct > 0 ? '+' : ''}{varPct.toFixed(1)}%</span>
        )}
      </td>
      <td className="px-3 py-2 text-right text-sm font-medium tabular-nums">{fmtMoney(lineTotal)}</td>
    </tr>
  );
}

// ---------------------------------------------------------------------------
// Invoice detail header — number, dates, terms, status, totals, variance
// ---------------------------------------------------------------------------
function InvoiceDetail({ invoice, supplier }) {
  const terms = supplier?.payment_term_type
    ? formatPaymentTerms(supplier.payment_term_type, supplier.payment_term_value)
    : null;
  const statusLabel = invoice.status === 'approved'
    ? 'Authorised'
    : invoice.status === 'pending_match'
      ? 'Awaiting authorisation'
      : invoice.status === 'draft'
        ? 'Draft'
        : invoice.status;
  const statusColor = invoice.status === 'approved'
    ? 'bg-green-100 text-green-700'
    : invoice.status === 'draft'
      ? 'bg-gray-100 text-gray-600'
      : 'bg-amber-100 text-amber-700';

  const Field = ({ label, value, mono }) => (
    <div>
      <dt className="text-[10px] uppercase font-semibold text-muted-foreground">{label}</dt>
      <dd className={`text-sm font-medium mt-0.5 ${mono ? 'font-mono' : ''} ${value ? '' : 'text-muted-foreground'}`}>
        {value || '—'}
      </dd>
    </div>
  );

  const variance = invoice.total_variance != null ? parseFloat(invoice.total_variance) : null;

  return (
    <div className="bg-muted/30 border border-border rounded-xl p-5 space-y-4">
      <div className="flex items-center gap-2">
        <FileText className="w-4 h-4 text-primary" />
        <h3 className="text-sm font-semibold">Invoice Detail</h3>
        <Badge className={`text-[10px] ${statusColor}`}>{statusLabel}</Badge>
        {invoice.payment_status && (
          <Badge className={`text-[10px] ${invoice.payment_status === 'paid' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}`}>
            {invoice.payment_status === 'paid' ? 'Paid' : 'Unpaid'}
          </Badge>
        )}
      </div>

      <dl className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
        <Field label="Invoice Number" value={invoice.invoice_number} mono />
        <Field label="Invoice Date" value={invoice.invoice_date} />
        <Field label="Due Date" value={invoice.due_date_calculated || invoice.due_date} />
        <Field label="Payment Terms" value={terms} />
      </dl>

      {invoice.notes && (
        <div>
          <dt className="text-[10px] uppercase font-semibold text-muted-foreground">Notes</dt>
          <dd className="text-sm mt-0.5 text-muted-foreground">{invoice.notes}</dd>
        </div>
      )}

      {/* Totals */}
      <div className="max-w-sm ml-auto space-y-1 pt-2 border-t border-border">
        <div className="flex justify-between text-sm">
          <span className="text-muted-foreground">Subtotal (excl)</span>
          <span className="tabular-nums">{fmtMoney(invoice.subtotal)}</span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-muted-foreground">VAT</span>
          <span className="tabular-nums">{fmtMoney(invoice.tax_amount)}</span>
        </div>
        <div className="flex justify-between text-base font-bold pt-1 border-t border-border">
          <span>Total (incl)</span>
          <span className="tabular-nums">{fmtMoney(invoice.total)}</span>
        </div>
        {invoice.captured_total != null && (
          <div className="flex justify-between text-sm pt-1">
            <span className="text-muted-foreground">Invoice total (per supplier)</span>
            <span className="tabular-nums">{fmtMoney(invoice.captured_total)}</span>
          </div>
        )}
        {variance != null && Math.abs(variance) > 0.001 && (
          <div className="flex justify-between text-sm text-amber-700 font-medium">
            <span className="flex items-center gap-1"><AlertTriangle className="w-3.5 h-3.5" /> Total variance</span>
            <span className="tabular-nums">{fmtMoney(variance)}</span>
          </div>
        )}
      </div>
    </div>
  );
}

export default function WorkspaceLinesTab({ po, poLines = [], invoice, invoiceLines = [], onInvoiceAuthorised }) {
  const qc = useQueryClient();
  const [authorising, setAuthorising] = useState(false);
  const [reverting, setReverting] = useState(false);
  const [validationErrors, setValidationErrors] = useState([]);
  const [dismissedMatch, setDismissedMatch] = useState(false);
  const [showCreateInvoice, setShowCreateInvoice] = useState(false);
  const [showEditInvoice, setShowEditInvoice] = useState(false);

  // Supplier — for payment terms on the invoice detail header
  const { data: supplier = null } = useQuery({
    queryKey: ['supplier-single', po?.supplier_id],
    queryFn: async () => {
      const list = await base44.entities.Supplier.filter({ id: po.supplier_id });
      return list[0] || null;
    },
    enabled: !!po?.supplier_id,
  });

  // Check for match suggestions
  const { data: matchSuggestions = [] } = useQuery({
    queryKey: ['match-suggestions', po?.id],
    queryFn: () => base44.entities.InvoicePOMatchSuggestion.filter({ po_id: po.id, dismissed: false }, '-created_date', 5),
    enabled: !!po?.id && !invoice,
  });
  const bestSuggestion = matchSuggestions[0];

  // Live received quantities derived from confirmed GRNs — used as a fallback so
  // POs received before received_qty was written back to the line still display.
  const { data: confirmedGrnLines = [] } = useQuery({
    queryKey: ['lines-tab-grn-lines', po?.id],
    queryFn: async () => {
      const grns = await base44.entities.GoodsReceivedNote.filter({ purchase_order_id: po.id, status: 'confirmed' }, '-received_date', 50);
      if (!grns.length) return [];
      const chunks = await Promise.all(grns.map(g => base44.entities.GRNLine.filter({ grn_id: g.id }, 'product_name', 200)));
      return chunks.flat();
    },
    enabled: !!po?.id,
  });
  const receivedByPoLineId = useMemo(() => {
    const m = {};
    confirmedGrnLines.forEach(l => {
      if (l.po_line_id) m[l.po_line_id] = (m[l.po_line_id] || 0) + (parseFloat(l.received_qty) || 0);
    });
    return m;
  }, [confirmedGrnLines]);
  const receivedByProductId = useMemo(() => {
    const m = {};
    confirmedGrnLines.forEach(l => {
      if (l.product_id) m[l.product_id] = (m[l.product_id] || 0) + (parseFloat(l.received_qty) || 0);
    });
    return m;
  }, [confirmedGrnLines]);
  // Received for a PO line: prefer the po_line_id sum, fall back to product match.
  const receivedForPoLine = (poLine) => {
    if (!poLine) return null;
    if (receivedByPoLineId[poLine.id] != null) return receivedByPoLineId[poLine.id];
    if (receivedByProductId[poLine.product_id] != null) return receivedByProductId[poLine.product_id];
    return null;
  };

  const handleAuthorise = async () => {
    const errors = validateInvoice(invoice, invoiceLines);
    if (errors.length > 0) {
      setValidationErrors(errors);
      return;
    }
    setValidationErrors([]);
    setAuthorising(true);
    try {
      await base44.entities.PurchaseInvoice.update(invoice.id, {
        status: 'approved',
      });
      if (po.status !== 'invoiced') {
        await base44.entities.PurchaseOrder.update(po.id, { status: 'invoiced' });
      }
      qc.invalidateQueries({ queryKey: ['workspace-invoices', po.id] });
      qc.invalidateQueries({ queryKey: ['po', po.id] });
      toast.success('Invoice authorised');
      onInvoiceAuthorised && onInvoiceAuthorised();
    } catch (err) {
      toast.error(`Failed: ${err.message}`);
    } finally {
      setAuthorising(false);
    }
  };

  const handleRevertInvoice = async () => {
    if (!invoice) return;
    setReverting(true);
    try {
      await base44.entities.PurchaseInvoice.update(invoice.id, { status: 'pending_match' });
      // Restore PO status to received (undo invoiced)
      if (['invoiced'].includes(po.status)) {
        await base44.entities.PurchaseOrder.update(po.id, { status: 'received' });
      }
      qc.invalidateQueries({ queryKey: ['workspace-invoices', po.id] });
      qc.invalidateQueries({ queryKey: ['po', po.id] });
      toast.success('Invoice reverted to pending — you can now edit it');
    } catch (err) {
      toast.error(`Failed: ${err.message}`);
    } finally {
      setReverting(false);
    }
  };

  const handleDismissMatch = async () => {
    if (!bestSuggestion) return;
    try {
      await base44.entities.InvoicePOMatchSuggestion.update(bestSuggestion.id, {
        dismissed: true,
        dismissed_at: new Date().toISOString(),
      });
      qc.invalidateQueries({ queryKey: ['match-suggestions', po.id] });
    } catch {}
    setDismissedMatch(true);
  };

  const poLineMap = useMemo(() => {
    const m = {};
    poLines.forEach(l => { m[l.product_id] = l; });
    return m;
  }, [poLines]);

  const poTableHead = (
    <thead>
      <tr className="bg-muted/50 border-b border-border">
        <th className="text-left px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase">Product</th>
        <th className="text-right px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase w-20">Ordered</th>
        <th className="text-right px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase w-20">Received</th>
        <th className="text-right px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase w-20">Short</th>
        <th className="text-right px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase w-28">Unit Cost</th>
        <th className="text-right px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase w-24">Total</th>
      </tr>
    </thead>
  );

  const invTableHead = (
    <thead>
      <tr className="bg-muted/50 border-b border-border">
        <th className="text-left px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase">Product</th>
        <th className="text-right px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase w-20">Ordered</th>
        <th className="text-right px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase w-20">Received</th>
        <th className="text-right px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase w-20">Invoiced</th>
        <th className="text-right px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase w-20">Short</th>
        <th className="text-right px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase w-28">Unit Cost</th>
        <th className="text-right px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase w-24">Variance</th>
        <th className="text-right px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase w-24">Total</th>
      </tr>
    </thead>
  );

  return (
    <div className="space-y-4">
      {/* Match suggestion banner */}
      {bestSuggestion && !dismissedMatch && (
        <div className="flex items-start gap-3 p-3 rounded-lg bg-blue-50 border border-blue-200 text-blue-800">
          <Link2 className="w-4 h-4 mt-0.5 shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold">Possible Invoice Match Found</p>
            <p className="text-xs mt-0.5">Confidence: {bestSuggestion.confidence}% — {(bestSuggestion.reasons || []).join('; ')}</p>
          </div>
          <Button variant="ghost" size="icon" className="h-7 w-7 text-blue-600 hover:text-blue-800" onClick={handleDismissMatch}>
            <X className="w-4 h-4" />
          </Button>
        </div>
      )}

      {/* Validation errors for authorisation */}
      <ValidationErrorBanner errors={validationErrors} />

      {/* PO Lines — hidden for blind receipts with no lines (invoice is the source of truth) */}
      {!(po.type === 'blind_receipt' && poLines.length === 0) && (
        <div>
          <h3 className="text-sm font-semibold mb-2">Purchase Order Lines</h3>
          <div className="border border-border rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              {poTableHead}
              <tbody className="divide-y divide-border">
                {poLines.length === 0 ? (
                  <tr><td colSpan={6} className="px-3 py-6 text-center text-xs text-muted-foreground">No PO lines.</td></tr>
                ) : (
                  poLines.map(l => <POLineRow key={l.id} line={l} receivedOverride={receivedForPoLine(l)} />)
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Invoice detail header */}
      {invoice && <InvoiceDetail invoice={invoice} supplier={supplier} />}

      {/* Invoice Lines */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-semibold">Invoice Lines</h3>
          {!invoice && (
            <Button size="sm" className="gap-1.5" onClick={() => setShowCreateInvoice(true)}>
              <Plus className="w-3.5 h-3.5" /> Add Invoice
            </Button>
          )}
          {invoice?.status === 'draft' && (
            <div className="flex items-center gap-2">
              <Badge className="text-[10px] bg-gray-100 text-gray-600">Draft</Badge>
              <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setShowEditInvoice(true)}>
                <Pencil className="w-3.5 h-3.5" /> Edit Draft Invoice
              </Button>
            </div>
          )}
          {invoice && invoice.status === 'pending_match' && (
            <Button size="sm" className="gap-1.5" onClick={handleAuthorise} disabled={authorising}>
              {authorising ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />} Authorise Invoice
            </Button>
          )}
          {invoice?.status === 'approved' && invoice?.payment_status === 'unpaid' && (
            <div className="flex items-center gap-2">
              <Badge className="text-[10px] bg-green-100 text-green-700">Authorised</Badge>
              <Button
                variant="ghost" size="sm"
                className="gap-1 text-xs h-7 text-muted-foreground"
                onClick={handleRevertInvoice}
                disabled={reverting}
                title="Revert invoice back to pending for editing"
              >
                {reverting ? <Loader2 className="w-3 h-3 animate-spin" /> : <RotateCcw className="w-3 h-3" />}
                Revert
              </Button>
            </div>
          )}
          {invoice?.status === 'approved' && invoice?.payment_status !== 'unpaid' && (
            <Badge className="text-[10px] bg-green-100 text-green-700">Authorised</Badge>
          )}
        </div>
        {!invoice ? (
          <div
            className="text-center py-10 border border-dashed border-border rounded-lg cursor-pointer hover:bg-muted/30 transition-colors"
            onClick={() => setShowCreateInvoice(true)}
          >
            <Plus className="w-6 h-6 text-muted-foreground mx-auto mb-2" />
            <p className="text-sm font-medium">No invoice yet</p>
            <p className="text-xs text-muted-foreground mt-1">Click to add a supplier invoice — PO lines will be pre-populated</p>
          </div>
        ) : (
          <div className="border border-border rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              {invTableHead}
              <tbody className="divide-y divide-border">
                {invoiceLines.length === 0 ? (
                  <tr><td colSpan={8} className="px-3 py-6 text-center text-xs text-muted-foreground">No invoice lines.</td></tr>
                ) : (
                  invoiceLines.map(l => {
                    const pl = l.po_line_id
                      ? poLines.find(p => p.id === l.po_line_id) || poLineMap[l.product_id]
                      : poLineMap[l.product_id];
                    return (
                      <InvoiceLineRow key={l.id} line={l} poLine={pl} receivedOverride={receivedForPoLine(pl)} />
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {(showCreateInvoice || showEditInvoice) && (
        <CreateInvoiceFromPOModal
          po={po}
          existingInvoice={showEditInvoice ? invoice : null}
          onCreated={() => {
            setShowCreateInvoice(false);
            setShowEditInvoice(false);
            qc.invalidateQueries({ queryKey: ['workspace-invoices', po.id] });
            qc.invalidateQueries({ queryKey: ['workspace-invoice-lines', invoice?.id] });
            qc.invalidateQueries({ queryKey: ['po', po.id] });
            qc.invalidateQueries({ queryKey: ['workspace-shortages', po.id] });
            qc.invalidateQueries({ queryKey: ['po-shortages-for-invoice', po.id] });
          }}
          onCancel={() => { setShowCreateInvoice(false); setShowEditInvoice(false); }}
        />
      )}
    </div>
  );
}
