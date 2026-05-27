import React from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  X, FileText, Truck, Calendar, DollarSign
} from 'lucide-react';
import { toast } from 'sonner';
import InvoiceLineMatchRow from './InvoiceLineMatchRow';

const STATUS_STYLES = {
  pending_match: 'bg-amber-100 text-amber-700',
  matched: 'bg-green-100 text-green-700',
  approved: 'bg-blue-100 text-blue-700',
  disputed: 'bg-red-100 text-red-600',
  on_hold: 'bg-gray-100 text-gray-500',
};

const PAYMENT_STYLES = {
  unpaid: 'bg-red-50 text-red-600',
  partially_paid: 'bg-amber-50 text-amber-600',
  paid: 'bg-green-50 text-green-600',
};

export default function InvoiceDrawer({ invoice, onClose, onUpdated, canEdit }) {
  const queryClient = useQueryClient();

  const { data: lines = [], isLoading } = useQuery({
    queryKey: ['invoice-lines', invoice.id],
    queryFn: () => base44.entities.PurchaseInvoiceLine.filter({ invoice_id: invoice.id }, 'xero_description', 200),
  });

  const { data: supplierProducts = [] } = useQuery({
    queryKey: ['sp-for-invoice', invoice.supplier_id],
    queryFn: () => base44.entities.SupplierProduct.filter(
      { supplier_id: invoice.supplier_id, active: true }, 'product_name', 200
    ),
  });

  const handleMatch = async (line, sp) => {
    await base44.entities.PurchaseInvoiceLine.update(line.id, {
      supplier_product_id: sp.id,
      product_id: sp.product_id,
      product_name: sp.product_name,
      product_sku: sp.product_sku,
      match_status: 'manually_matched',
    });
    // Recount unmatched
    const updatedLines = await base44.entities.PurchaseInvoiceLine.filter({ invoice_id: invoice.id }, 'xero_description', 200);
    const unmatchedCount = updatedLines.filter(l => l.match_status === 'unmatched').length;
    await base44.entities.PurchaseInvoice.update(invoice.id, {
      unmatched_line_count: unmatchedCount,
      status: unmatchedCount === 0 ? 'matched' : 'pending_match',
    });
    queryClient.invalidateQueries({ queryKey: ['invoice-lines', invoice.id] });
    toast.success(`Matched: ${sp.product_name}`);
    onUpdated?.();
  };

  const handleUnmatch = async (line) => {
    await base44.entities.PurchaseInvoiceLine.update(line.id, {
      supplier_product_id: '',
      product_id: '',
      product_name: '',
      product_sku: '',
      match_status: 'unmatched',
    });
    const updatedLines = await base44.entities.PurchaseInvoiceLine.filter({ invoice_id: invoice.id }, 'xero_description', 200);
    const unmatchedCount = updatedLines.filter(l => l.match_status === 'unmatched').length;
    await base44.entities.PurchaseInvoice.update(invoice.id, {
      unmatched_line_count: unmatchedCount,
      status: 'pending_match',
    });
    queryClient.invalidateQueries({ queryKey: ['invoice-lines', invoice.id] });
    toast.success('Match removed');
    onUpdated?.();
  };

  const matchedCount = lines.filter(l => l.match_status === 'auto_matched' || l.match_status === 'manually_matched').length;
  const unmatchedCount = lines.filter(l => l.match_status === 'unmatched').length;

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative z-10 w-full max-w-2xl bg-card shadow-xl flex flex-col">
        {/* Header */}
        <div className="sticky top-0 bg-card border-b border-border px-6 py-4 flex items-start justify-between z-10 shrink-0">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Badge className={`text-[10px] ${STATUS_STYLES[invoice.status] || ''}`}>
                {(invoice.status || '').replace('_', ' ')}
              </Badge>
              <Badge className={`text-[10px] ${PAYMENT_STYLES[invoice.payment_status] || ''}`}>
                {invoice.payment_status}
              </Badge>
            </div>
            <h2 className="text-lg font-bold flex items-center gap-2">
              <FileText className="w-5 h-5 text-primary" />
              {invoice.invoice_number}
            </h2>
            <div className="flex items-center gap-3 text-xs text-muted-foreground mt-1">
              <span className="flex items-center gap-1"><Truck className="w-3.5 h-3.5" />{invoice.supplier_name}</span>
              <span className="flex items-center gap-1"><Calendar className="w-3.5 h-3.5" />{invoice.invoice_date}</span>
              {invoice.due_date && <span>Due: {invoice.due_date}</span>}
            </div>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose}><X className="w-5 h-5" /></Button>
        </div>

        {/* Summary strip */}
        <div className="px-6 py-3 border-b border-border flex items-center gap-6 text-sm bg-muted/30">
          <div>
            <span className="text-muted-foreground">Subtotal: </span>
            <span className="font-medium tabular-nums">R {(invoice.subtotal || 0).toFixed(2)}</span>
          </div>
          <div>
            <span className="text-muted-foreground">VAT: </span>
            <span className="font-medium tabular-nums">R {(invoice.tax_amount || 0).toFixed(2)}</span>
          </div>
          <div>
            <span className="text-muted-foreground">Total: </span>
            <span className="font-bold tabular-nums">R {(invoice.total || 0).toFixed(2)}</span>
          </div>
          <div className="ml-auto flex gap-2">
            <span className="text-green-600 font-medium">{matchedCount} matched</span>
            {unmatchedCount > 0 && <span className="text-amber-600 font-medium">{unmatchedCount} unmatched</span>}
          </div>
        </div>

        {/* Lines */}
        <div className="flex-1 overflow-y-auto">
          {isLoading ? (
            <div className="text-center py-12 text-sm text-muted-foreground">Loading...</div>
          ) : lines.length === 0 ? (
            <div className="text-center py-12 text-sm text-muted-foreground">No lines on this invoice.</div>
          ) : (
            lines.map(line => (
              <InvoiceLineMatchRow
                key={line.id}
                line={line}
                supplierProducts={supplierProducts}
                onMatch={handleMatch}
                onUnmatch={handleUnmatch}
                editable={canEdit && invoice.status !== 'approved'}
              />
            ))
          )}
        </div>

        {/* Source info */}
        {invoice.source === 'xero_sync' && (
          <div className="px-6 py-2 border-t border-border bg-muted/20 text-xs text-muted-foreground">
            Synced from Xero · Bill ID: {invoice.xero_bill_id?.substring(0, 12)}...
          </div>
        )}
      </div>
    </div>
  );
}