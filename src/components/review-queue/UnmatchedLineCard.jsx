import React from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Link2, Plus, Ban, Truck, FileText, EyeOff, Sparkles, CheckCircle2 } from 'lucide-react';
import { formatZAR, effectiveUnitCost } from '@/lib/utils';

/**
 * One card per supplier+SKU group of unmatched invoice lines.
 * When the same SKU appears on several invoices it is collapsed into a single
 * card; matching / non-stock / create resolves every line in the group at once.
 */
export default function UnmatchedLineCard({ lineGroup, possibleMatches = [], onOpenMatch, onCreateProduct, onMarkNonStock, onIgnore }) {
  const line = lineGroup.representativeLine;
  const invoice = lineGroup.representativeInvoice;
  const count = lineGroup.lines.length;
  const totalQty = lineGroup.lines.reduce((s, l) => s + (l.line.qty || 0), 0);
  const unitCost = effectiveUnitCost(line);
  const unitLabel = line.unit ? ` ${line.unit}` : '';
  const topMatch = possibleMatches[0];
  // When the best match already has a supplier_products link, this line is really
  // an already-known product — the action is to confirm its purchasing unit, not
  // to create / match from scratch.
  const alreadyLinked = !!topMatch?.supplierProduct;

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
            {count > 1 ? `${totalQty}${unitLabel} total` : `${line.qty}${unitLabel}`} × {formatZAR(unitCost)}
          </p>
          <p className="text-sm font-bold tabular-nums">{formatZAR(line.line_total || 0)}</p>
        </div>
      </div>

      {/* Match hint — green when the product is already linked (just confirm the
          purchasing unit), amber when it's a likely-but-unlinked product. */}
      {topMatch && (
        <div className={`px-4 py-2 border-t border-border flex items-center gap-2 flex-wrap ${alreadyLinked ? 'bg-green-50/70' : 'bg-amber-50/60'}`}>
          {alreadyLinked
            ? <CheckCircle2 className="w-3.5 h-3.5 text-green-600 shrink-0" />
            : <Sparkles className="w-3.5 h-3.5 text-amber-600 shrink-0" />}
          <span className={`text-xs ${alreadyLinked ? 'text-green-800' : 'text-amber-800'}`}>
            {alreadyLinked ? 'Already linked: ' : 'Possible match: '}
            <span className="font-medium">{topMatch.product.name}</span>
            {topMatch.product.sku && <span className={`font-mono ${alreadyLinked ? 'text-green-700' : 'text-amber-700'}`}> ({topMatch.product.sku})</span>}
            <span className={alreadyLinked ? 'text-green-600' : 'text-amber-600'}> — {alreadyLinked ? 'confirm the purchasing unit' : topMatch.reasons[0]}</span>
            {possibleMatches.length > 1 && <span className={alreadyLinked ? 'text-green-600' : 'text-amber-600'}> · +{possibleMatches.length - 1} more</span>}
          </span>
          <Button
            variant="outline" size="sm" onClick={() => onOpenMatch(lineGroup)}
            className={`gap-1.5 text-xs h-7 ml-auto ${alreadyLinked ? 'border-green-300 text-green-800 hover:bg-green-100' : 'border-amber-300 text-amber-800 hover:bg-amber-100'}`}
          >
            {alreadyLinked ? <><CheckCircle2 className="w-3 h-3" /> Confirm unit</> : <><Link2 className="w-3 h-3" /> Review match</>}
          </Button>
        </div>
      )}

      {/* Actions */}
      <div className="px-4 py-2 border-t border-border bg-muted/20 flex items-center gap-2 flex-wrap">
        <Button variant="outline" size="sm" onClick={() => onOpenMatch(lineGroup)} className="gap-1.5 text-xs">
          {alreadyLinked ? <><CheckCircle2 className="w-3.5 h-3.5" /> Confirm Unit</> : <><Link2 className="w-3.5 h-3.5" /> Match Existing</>}
        </Button>
        <Button variant="outline" size="sm" onClick={() => onCreateProduct(lineGroup)} className="gap-1.5 text-xs">
          <Plus className="w-3.5 h-3.5" /> Create Product
        </Button>
        <Button variant="ghost" size="sm" onClick={() => onMarkNonStock(lineGroup)} className="gap-1.5 text-xs text-muted-foreground">
          <Ban className="w-3.5 h-3.5" /> Non-stock
        </Button>
        {onIgnore && (
          <Button variant="ghost" size="sm" onClick={() => onIgnore(lineGroup)} className="gap-1.5 text-xs text-muted-foreground ml-auto">
            <EyeOff className="w-3.5 h-3.5" /> Ignore
          </Button>
        )}
      </div>
    </div>
  );
}
