import React, { useState, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { AlertTriangle, Link2, X, CheckCircle2, Plus, RotateCcw, Loader2, Pencil, FileText } from 'lucide-react';
import { toast } from 'sonner';
import { formatPaymentTerms } from '@/lib/utils';
import ValidationErrorBanner from '@/components/purchasing/ValidationErrorBanner';
import CreateInvoiceFromPOModal from '@/components/purchasing/CreateInvoiceFromPOModal';
import { DocSheet, DocTitle, Party, MetaField, MetaGrid, DocTable, Th, Td, TotalsBox, fmtMoney, fmtQty } from './documentUi';

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

// One invoice line — ordered / received / invoiced / short / unit cost / variance / total
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

  const poCost = parseFloat(poLine?.unit_cost) || 0;
  const varPct = line.price_variance_pct != null
    ? parseFloat(line.price_variance_pct)
    : (poCost > 0 ? ((unitCost - poCost) / poCost) * 100 : null);
  const priceFlagged = !!line.price_variance_flagged || (varPct != null && Math.abs(varPct) >= 5);
  const rowFlagged = billedOverReceived || priceFlagged;

  return (
    <tr className={rowFlagged ? 'bg-amber-50' : ''}>
      <Td>
        <p className="font-medium text-foreground">{line.product_name || line.description}</p>
        {line.product_sku && <p className="text-xs font-mono text-muted-foreground mt-0.5">{line.product_sku}</p>}
      </Td>
      <Td align="right"><span className="text-sm text-muted-foreground">{orderedQty > 0 ? fmtQty(orderedQty) : '—'}</span></Td>
      <Td align="right">
        {receivedQty > 0
          ? <span className={`text-sm ${receivedQty < orderedQty ? 'text-amber-600 font-medium' : ''}`}>{fmtQty(receivedQty)}</span>
          : <span className="text-sm text-muted-foreground">—</span>}
      </Td>
      <Td align="right" className={billedOverReceived ? 'text-amber-700 font-semibold' : ''}>
        <span className="inline-flex items-center justify-end gap-1 text-sm">
          {billedOverReceived && <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />}
          {fmtQty(invoicedQty)}
        </span>
      </Td>
      <Td align="right">
        {shortReceived > 0 ? <span className="text-sm text-amber-600 font-medium">{fmtQty(shortReceived)}</span> : <span className="text-sm text-muted-foreground">—</span>}
      </Td>
      <Td align="right"><span className="text-sm">{fmtMoney(unitCost)}</span></Td>
      <Td align="right">
        {varPct == null ? (
          <span className="text-sm text-muted-foreground">—</span>
        ) : priceFlagged ? (
          <span className="inline-flex items-center gap-1 text-sm text-amber-600 font-semibold">
            <AlertTriangle className="w-3.5 h-3.5" />{varPct > 0 ? '+' : ''}{varPct.toFixed(1)}%
          </span>
        ) : (
          <span className="text-sm text-muted-foreground">{varPct > 0 ? '+' : ''}{varPct.toFixed(1)}%</span>
        )}
      </Td>
      <Td align="right"><span className="text-sm font-medium">{fmtMoney(lineTotal)}</span></Td>
    </tr>
  );
}

export default function WorkspaceInvoiceTab({ po, poLines = [], invoice, invoiceLines = [], onInvoiceAuthorised }) {
  const qc = useQueryClient();
  const [authorising, setAuthorising] = useState(false);
  const [reverting, setReverting] = useState(false);
  const [validationErrors, setValidationErrors] = useState([]);
  const [dismissedMatch, setDismissedMatch] = useState(false);
  const [showCreateInvoice, setShowCreateInvoice] = useState(false);
  const [showEditInvoice, setShowEditInvoice] = useState(false);

  const { data: supplier = null } = useQuery({
    queryKey: ['supplier-single', po?.supplier_id],
    queryFn: async () => {
      const list = await base44.entities.Supplier.filter({ id: po.supplier_id });
      return list[0] || null;
    },
    enabled: !!po?.supplier_id,
  });

  const { data: settings = [] } = useQuery({
    queryKey: ['settings'],
    queryFn: () => base44.entities.Setting.list('-created_date', 100),
    staleTime: 300000,
  });
  const orgName = useMemo(() => {
    const byKey = {};
    settings.forEach(s => { byKey[s.key] = s.value; });
    return byKey.trading_name || byKey.company_name || 'Lean Living';
  }, [settings]);

  const { data: matchSuggestions = [] } = useQuery({
    queryKey: ['match-suggestions', po?.id],
    queryFn: () => base44.entities.InvoicePOMatchSuggestion.filter({ po_id: po.id, dismissed: false }, '-created_date', 5),
    enabled: !!po?.id && !invoice,
  });
  const bestSuggestion = matchSuggestions[0];

  // Live received quantities from confirmed GRNs (fallback for legacy lines)
  const { data: confirmedGrnLines = [] } = useQuery({
    queryKey: ['inv-doc-grn-lines', po?.id],
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
    confirmedGrnLines.forEach(l => { if (l.po_line_id) m[l.po_line_id] = (m[l.po_line_id] || 0) + (parseFloat(l.received_qty) || 0); });
    return m;
  }, [confirmedGrnLines]);
  const receivedByProductId = useMemo(() => {
    const m = {};
    confirmedGrnLines.forEach(l => { if (l.product_id) m[l.product_id] = (m[l.product_id] || 0) + (parseFloat(l.received_qty) || 0); });
    return m;
  }, [confirmedGrnLines]);
  const receivedForPoLine = (poLine) => {
    if (!poLine) return null;
    if (receivedByPoLineId[poLine.id] != null) return receivedByPoLineId[poLine.id];
    if (receivedByProductId[poLine.product_id] != null) return receivedByProductId[poLine.product_id];
    return null;
  };

  const poLineMap = useMemo(() => {
    const m = {};
    poLines.forEach(l => { m[l.product_id] = l; });
    return m;
  }, [poLines]);

  const handleAuthorise = async () => {
    const errors = validateInvoice(invoice, invoiceLines);
    if (errors.length > 0) { setValidationErrors(errors); return; }
    setValidationErrors([]);
    setAuthorising(true);
    try {
      await base44.entities.PurchaseInvoice.update(invoice.id, { status: 'approved' });
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
        dismissed: true, dismissed_at: new Date().toISOString(),
      });
      qc.invalidateQueries({ queryKey: ['match-suggestions', po.id] });
    } catch {}
    setDismissedMatch(true);
  };

  const invoiceModal = (showCreateInvoice || showEditInvoice) && (
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
  );

  // ── Empty state — no invoice yet ──
  if (!invoice) {
    return (
      <div className="space-y-4">
        {bestSuggestion && !dismissedMatch && (
          <div className="flex items-start gap-3 p-4 rounded-xl bg-blue-50 border border-blue-200 text-blue-800">
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
        <DocSheet>
          <div
            className="text-center py-16 border-2 border-dashed border-border rounded-xl cursor-pointer hover:bg-muted/30 transition-colors"
            onClick={() => setShowCreateInvoice(true)}
          >
            <FileText className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
            <p className="text-base font-semibold">No supplier invoice yet</p>
            <p className="text-sm text-muted-foreground mt-1.5 max-w-md mx-auto">
              Add the supplier invoice to match it against this order. The PO lines will be pre-populated for you.
            </p>
            <Button className="gap-1.5 mt-5" onClick={(e) => { e.stopPropagation(); setShowCreateInvoice(true); }}>
              <Plus className="w-4 h-4" /> Add Invoice
            </Button>
          </div>
        </DocSheet>
        {invoiceModal}
      </div>
    );
  }

  // ── Invoice document ──
  const statusLabel = invoice.status === 'approved'
    ? 'Authorised'
    : invoice.status === 'pending_match'
      ? 'Awaiting authorisation'
      : invoice.status === 'draft' ? 'Draft' : invoice.status;
  const statusColor = invoice.status === 'approved'
    ? 'bg-green-100 text-green-700'
    : invoice.status === 'draft' ? 'bg-gray-100 text-gray-600' : 'bg-amber-100 text-amber-700';
  const terms = supplier?.payment_term_type
    ? formatPaymentTerms(supplier.payment_term_type, supplier.payment_term_value)
    : null;
  const variance = invoice.total_variance != null ? parseFloat(invoice.total_variance) : null;
  const supplierAddress = supplier?.physical_address || supplier?.billing_address || '';
  const supplierVat = supplier?.vat_number || '';

  const totalsRows = [
    { label: 'Subtotal (excl. VAT)', value: fmtMoney(invoice.subtotal) },
    { label: 'VAT', value: fmtMoney(invoice.tax_amount) },
  ];
  if (invoice.captured_total != null) {
    totalsRows.push({ label: 'Invoice total (per supplier)', value: fmtMoney(invoice.captured_total) });
  }
  if (variance != null && Math.abs(variance) > 0.001) {
    totalsRows.push({ label: 'Total variance', value: fmtMoney(variance), tone: 'amber' });
  }

  return (
    <div className="space-y-4">
      <ValidationErrorBanner errors={validationErrors} />

      <DocSheet>
        <DocTitle
          kicker="TAX INVOICE"
          number={invoice.invoice_number}
          right={
            <div className="flex flex-col items-end gap-2">
              <div className="flex items-center gap-2">
                <Badge className={`text-xs ${statusColor}`}>{statusLabel}</Badge>
                {invoice.payment_status && (
                  <Badge className={`text-xs ${invoice.payment_status === 'paid' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}`}>
                    {invoice.payment_status === 'paid' ? 'Paid' : 'Unpaid'}
                  </Badge>
                )}
              </div>
              {invoice.status === 'draft' && (
                <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setShowEditInvoice(true)}>
                  <Pencil className="w-3.5 h-3.5" /> Edit Draft
                </Button>
              )}
              {invoice.status === 'pending_match' && (
                <Button size="sm" className="gap-1.5" onClick={handleAuthorise} disabled={authorising}>
                  {authorising ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />} Authorise Invoice
                </Button>
              )}
              {invoice.status === 'approved' && invoice.payment_status === 'unpaid' && (
                <Button variant="ghost" size="sm" className="gap-1 text-xs h-7 text-muted-foreground"
                  onClick={handleRevertInvoice} disabled={reverting} title="Revert invoice to pending for editing">
                  {reverting ? <Loader2 className="w-3 h-3 animate-spin" /> : <RotateCcw className="w-3 h-3" />} Revert
                </Button>
              )}
            </div>
          }
        />

        {/* Parties — invoice is FROM the supplier, billed TO us */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 py-8">
          <Party
            label="From (Supplier)"
            name={invoice.supplier_name || po.supplier_name}
            lines={[supplierAddress, supplierVat ? `VAT: ${supplierVat}` : '', supplier?.email]}
          />
          <Party label="Bill To" name={orgName} lines={[po.po_number ? `Against PO ${po.po_number}` : '']} />
        </div>

        {/* Meta strip */}
        <div className="py-6 border-y border-border">
          <MetaGrid>
            <MetaField label="Invoice Number" value={invoice.invoice_number} mono />
            <MetaField label="Invoice Date" value={invoice.invoice_date} />
            <MetaField label="Due Date" value={invoice.due_date_calculated || invoice.due_date} />
            <MetaField label="Payment Terms" value={terms} />
          </MetaGrid>
          {invoice.notes && (
            <div className="mt-5">
              <MetaField label="Notes" value={invoice.notes} />
            </div>
          )}
        </div>

        {/* Invoice lines */}
        <div className="py-8">
          <p className="text-[11px] uppercase tracking-wider font-semibold text-muted-foreground mb-3">Invoice Lines</p>
          <DocTable
            head={
              <>
                <Th>Description</Th>
                <Th align="right">Ordered</Th>
                <Th align="right">Received</Th>
                <Th align="right">Invoiced</Th>
                <Th align="right">Short</Th>
                <Th align="right">Unit Cost</Th>
                <Th align="right">Variance</Th>
                <Th align="right">Total</Th>
              </>
            }
          >
            {invoiceLines.length === 0 ? (
              <tr><td colSpan={8} className="px-4 py-10 text-center text-sm text-muted-foreground">No invoice lines.</td></tr>
            ) : (
              invoiceLines.map(l => {
                const pl = l.po_line_id
                  ? poLines.find(p => p.id === l.po_line_id) || poLineMap[l.product_id]
                  : poLineMap[l.product_id];
                return <InvoiceLineRow key={l.id} line={l} poLine={pl} receivedOverride={receivedForPoLine(pl)} />;
              })
            )}
          </DocTable>
        </div>

        {/* Totals */}
        <div className="pb-2">
          <TotalsBox rows={totalsRows} grand={{ label: 'Total (incl. VAT)', value: fmtMoney(invoice.total) }} />
        </div>
      </DocSheet>

      {invoiceModal}
    </div>
  );
}
