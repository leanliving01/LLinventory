import React, { useState, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { AlertTriangle, ExternalLink, Link2, X, CheckCircle2 } from 'lucide-react';
import { toast } from 'sonner';
import ValidationErrorBanner from '@/components/purchasing/ValidationErrorBanner';
import { findBestPOMatch } from '@/lib/purchaseMatchingEngine';

function validateInvoice(invoice, invoiceLines, po) {
  const errors = [];
  if (!invoice) { errors.push('No invoice linked to this PO.'); return errors; }
  if (!invoice.invoice_number) errors.push('Invoice number is missing.');
  if (!invoice.invoice_date) errors.push('Invoice date is missing.');
  if (!invoice.supplier_id) errors.push('Supplier is not linked.');
  if ((invoice.total || 0) <= 0) errors.push('Invoice total must be greater than zero.');
  if (invoiceLines.length === 0) errors.push('Invoice has no line items.');
  invoiceLines.forEach((l, i) => {
    if (!l.product_id && !l.description) errors.push(`Line ${i + 1}: product mapping or description is required.`);
    if ((parseFloat(l.quantity) || 0) <= 0) errors.push(`Line ${i + 1}: quantity must be greater than zero.`);
  });
  return errors;
}

function POLineRow({ line }) {
  const sp = line.supplier_product_url;
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
      <td className="px-3 py-2 text-right text-sm">{line.ordered_qty}</td>
      <td className="px-3 py-2 text-right text-sm">{line.received_qty || '—'}</td>
      <td className="px-3 py-2 text-right text-sm">R {(line.unit_cost || 0).toFixed(2)}</td>
      <td className="px-3 py-2 text-right text-sm font-medium">R {(line.line_total || 0).toFixed(2)}</td>
    </tr>
  );
}

function InvoiceLineRow({ line, poLine }) {
  const qtyVariance = poLine ? parseFloat(line.quantity) - parseFloat(poLine.ordered_qty || 0) : null;
  const costVariance = poLine ? parseFloat(line.unit_price) - parseFloat(poLine.unit_cost || 0) : null;
  const hasVariance = (qtyVariance != null && Math.abs(qtyVariance) > 0.001) ||
                      (costVariance != null && Math.abs(costVariance) > 0.01);
  return (
    <tr className={hasVariance ? 'bg-amber-50' : ''}>
      <td className="px-3 py-2">
        <p className="text-sm font-medium">{line.product_name || line.description}</p>
        <p className="text-[10px] font-mono text-muted-foreground">{line.product_sku}</p>
        {hasVariance && <span className="text-[10px] text-amber-700 bg-amber-100 rounded px-1">Variance</span>}
      </td>
      <td className={`px-3 py-2 text-right text-sm ${qtyVariance && Math.abs(qtyVariance) > 0.001 ? 'text-amber-700 font-semibold' : ''}`}>
        {line.quantity}
      </td>
      <td className="px-3 py-2 text-right text-sm">—</td>
      <td className={`px-3 py-2 text-right text-sm ${costVariance && Math.abs(costVariance) > 0.01 ? 'text-amber-700 font-semibold' : ''}`}>
        R {(parseFloat(line.unit_price) || 0).toFixed(2)}
      </td>
      <td className="px-3 py-2 text-right text-sm font-medium">
        R {((parseFloat(line.quantity) || 0) * (parseFloat(line.unit_price) || 0)).toFixed(2)}
      </td>
    </tr>
  );
}

export default function WorkspaceLinesTab({ po, poLines = [], invoice, invoiceLines = [], onInvoiceAuthorised }) {
  const qc = useQueryClient();
  const [authorising, setAuthorising] = useState(false);
  const [validationErrors, setValidationErrors] = useState([]);
  const [dismissedMatch, setDismissedMatch] = useState(false);

  // Check for match suggestions
  const { data: matchSuggestions = [] } = useQuery({
    queryKey: ['match-suggestions', po?.id],
    queryFn: () => base44.entities.InvoicePOMatchSuggestion.filter({ po_id: po.id, dismissed: false }, '-created_date', 5),
    enabled: !!po?.id && !invoice,
  });
  const bestSuggestion = matchSuggestions[0];

  const handleAuthorise = async () => {
    const errors = validateInvoice(invoice, invoiceLines, po);
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

  const tableHead = (
    <thead>
      <tr className="bg-muted/50 border-b border-border">
        <th className="text-left px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase">Product</th>
        <th className="text-right px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase w-20">Ordered</th>
        <th className="text-right px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase w-20">Received</th>
        <th className="text-right px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase w-28">Unit Cost</th>
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

      {/* PO Lines */}
      <div>
        <h3 className="text-sm font-semibold mb-2">Purchase Order Lines</h3>
        <div className="border border-border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            {tableHead}
            <tbody className="divide-y divide-border">
              {poLines.length === 0 ? (
                <tr><td colSpan={5} className="px-3 py-6 text-center text-xs text-muted-foreground">No PO lines.</td></tr>
              ) : (
                poLines.map(l => <POLineRow key={l.id} line={l} />)
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Invoice Lines */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-semibold">Invoice Lines</h3>
          {invoice && invoice.status === 'pending_match' && (
            <Button size="sm" className="gap-1.5" onClick={handleAuthorise} disabled={authorising}>
              <CheckCircle2 className="w-4 h-4" /> Authorise Invoice
            </Button>
          )}
          {invoice?.status === 'approved' && (
            <Badge className="text-[10px] bg-green-100 text-green-700">Authorised</Badge>
          )}
        </div>
        {!invoice ? (
          <div className="text-center py-8 text-sm text-muted-foreground border border-dashed border-border rounded-lg">
            No invoice linked. Add a supplier invoice to this PO.
          </div>
        ) : (
          <div className="border border-border rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              {tableHead}
              <tbody className="divide-y divide-border">
                {invoiceLines.length === 0 ? (
                  <tr><td colSpan={5} className="px-3 py-6 text-center text-xs text-muted-foreground">No invoice lines.</td></tr>
                ) : (
                  invoiceLines.map(l => (
                    <InvoiceLineRow key={l.id} line={l} poLine={poLineMap[l.product_id]} />
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
