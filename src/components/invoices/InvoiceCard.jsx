import React from 'react';
import { Badge } from '@/components/ui/badge';
import { FileText, ChevronRight, Truck, Clock, AlertCircle } from 'lucide-react';

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

export default function InvoiceCard({ invoice, onClick }) {
  return (
    <button
      onClick={() => onClick(invoice)}
      className="w-full text-left bg-card border border-border rounded-xl p-4 hover:shadow-md transition-all flex items-center justify-between group"
    >
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
          <FileText className="w-5 h-5 text-primary" />
        </div>
        <div>
          <div className="flex items-center gap-2 mb-0.5">
            <span className="text-sm font-bold font-mono">{invoice.invoice_number}</span>
            <Badge className={`text-[10px] ${STATUS_STYLES[invoice.status] || ''}`}>
              {(invoice.status || '').replace('_', ' ')}
            </Badge>
            <Badge className={`text-[10px] ${PAYMENT_STYLES[invoice.payment_status] || ''}`}>
              {invoice.payment_status}
            </Badge>
            {(invoice.unmatched_line_count || 0) > 0 && (
              <Badge className="text-[10px] bg-amber-100 text-amber-700">
                <AlertCircle className="w-3 h-3 mr-0.5" /> {invoice.unmatched_line_count} unmatched
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <Truck className="w-3.5 h-3.5" /> {invoice.supplier_name}
            </span>
            <span className="flex items-center gap-1">
              <Clock className="w-3.5 h-3.5" /> {invoice.invoice_date}
            </span>
            <span className="font-medium text-foreground">
              R {(invoice.total || 0).toLocaleString('en-ZA', { minimumFractionDigits: 2 })}
            </span>
          </div>
        </div>
      </div>
      <ChevronRight className="w-4 h-4 text-muted-foreground group-hover:text-foreground" />
    </button>
  );
}