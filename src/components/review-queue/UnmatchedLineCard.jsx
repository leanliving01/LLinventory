import React from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Link2, Plus, Ban, Truck, FileText } from 'lucide-react';
import { formatZAR } from '@/lib/utils';

/**
 * One card per supplier+SKU group of unmatched invoice lines.
 * When the same SKU appears on several invoices it is collapsed into a single
 * card; matching / non-stock / create resolves every line in the group at once.
 */
export default function UnmatchedLineCard({ lineGroup, onOpenMatch, onCreateProduct, onMarkNonStock }) {
  const line = lineGroup.representativeLine;
  const invoice = lineGroup.representativeInvoice;
  const count = lineGroup.lines.length;
  const totalQty = lineGroup.lines.reduce((s, l) => s + (l.line.qty || 0), 0);

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 flex items-start gap-3">
        <div className="w-8 h-8 rounded-lg bg-amber-50 flex items-center justify-center mt-0.5 shrink-0">
          <FileText className="w-4 h-4 text-amber-600" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium">{line.xero_description || 'No description'}</p>
          <div className="flex items-center gap-2 mt-0.5 flex-wrap">
            {line.xero_item_code && (
              <Badge variant="outline" className="text-[10px] font-mono">{line.xero_item_code}</Badge>
            )}
            <span className="text-xs text-muted-foreground flex items-center gap-1">
              <Truck className="w-3 h-3" /> {invoice?.supplier_name}
            </span>
            {count > 1 ? (
              <Badge className="text-[10px] bg-amber-100 text-amber-700 hover:bg-amber-100">
                {count} invoices
              </Badge>
            ) : (
              <span className="text-xs font-mono text-muted-foreground">{invoice?.invoice_number}</span>
            )}
            {line.account_code && (
              <span className="text-[10px] text-muted-foreground">Acct: {line.account_code}</span>
            )}
          </div>
          {count > 1 && (
            <p className="text-[11px] text-muted-foreground mt-1">
              On: {lineGroup.lines.map(l => l.invoice?.invoice_number || '—').join(', ')}
            </p>
          )}
        </div>
        <div className="text-right shrink-0">
          <p className="text-sm tabular-nums">
            {count > 1 ? `${totalQty} total` : line.qty} × {formatZAR(line.unit_cost || 0)}
          </p>
          <p className="text-sm font-bold tabular-nums">{formatZAR(line.line_total || 0)}</p>
        </div>
      </div>

      {/* Actions */}
      <div className="px-4 py-2 border-t border-border bg-muted/20 flex items-center gap-2">
        <Button variant="outline" size="sm" onClick={() => onOpenMatch(lineGroup)} className="gap-1.5 text-xs">
          <Link2 className="w-3.5 h-3.5" /> Match Existing
        </Button>
        <Button variant="outline" size="sm" onClick={() => onCreateProduct(lineGroup)} className="gap-1.5 text-xs">
          <Plus className="w-3.5 h-3.5" /> Create Product
        </Button>
        <Button variant="ghost" size="sm" onClick={() => onMarkNonStock(lineGroup)} className="gap-1.5 text-xs text-muted-foreground">
          <Ban className="w-3.5 h-3.5" /> Non-stock
        </Button>
      </div>
    </div>
  );
}
