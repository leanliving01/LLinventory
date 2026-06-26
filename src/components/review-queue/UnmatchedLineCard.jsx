import React from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Link2, Plus, Ban, Truck, FileText, EyeOff, Sparkles, ExternalLink, Check, Loader2, Pencil, HelpCircle } from 'lucide-react';
import { formatZAR, effectiveUnitCost } from '@/lib/utils';

// Confidence → colour for the AI proposal badge.
function confTone(c) {
  if (c >= 0.9) return 'bg-green-100 text-green-700';
  if (c >= 0.75) return 'bg-amber-100 text-amber-700';
  return 'bg-muted text-muted-foreground';
}

/**
 * One card per supplier+SKU group of unmatched invoice lines.
 * When the same SKU appears on several invoices it is collapsed into a single
 * card; matching / non-stock / create resolves every line in the group at once.
 */
export default function UnmatchedLineCard({ lineGroup, possibleMatches = [], proposal = null, approving = false, pdfByInvoice = {}, onOpenMatch, onCreateProduct, onMarkNonStock, onIgnore, onApprove, onReject }) {
  const line = lineGroup.representativeLine;
  const invoice = lineGroup.representativeInvoice;
  const invoicePdfUrl = invoice?.id ? pdfByInvoice[invoice.id] : null;
  const count = lineGroup.lines.length;
  const totalQty = lineGroup.lines.reduce((s, l) => s + (l.line.qty || 0), 0);
  // Price PER UNIT (not the line total, which is qty × unit price). effectiveUnitCost
  // repairs legacy rows where the total was stored in the unit-cost column.
  const unitCost = effectiveUnitCost(line);
  const perUnitLabel = line.unit ? `per ${line.unit}` : 'per unit';
  const unitLabel = line.unit ? ` ${line.unit}` : '';
  const topMatch = possibleMatches[0];

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
            ) : invoicePdfUrl ? (
              <a
                href={invoicePdfUrl} target="_blank" rel="noopener noreferrer"
                onClick={e => e.stopPropagation()}
                className="text-xs font-mono text-primary hover:underline inline-flex items-center gap-1"
                title="Open the supplier invoice PDF"
              >
                {invoice?.invoice_number} <ExternalLink className="w-3 h-3" />
              </a>
            ) : (
              <span className="text-xs font-mono text-muted-foreground">{invoice?.invoice_number}</span>
            )}
            {line.account_code && (
              <span className="text-[10px] text-muted-foreground">Acct: {line.account_code}</span>
            )}
          </div>
          {count > 1 && (
            <p className="text-[11px] text-muted-foreground mt-1">
              On: {lineGroup.lines.map((l, i) => {
                const url = l.invoice?.id ? pdfByInvoice[l.invoice.id] : null;
                const num = l.invoice?.invoice_number || '—';
                return (
                  <React.Fragment key={l.line?.id || i}>
                    {i > 0 && ', '}
                    {url ? (
                      <a href={url} target="_blank" rel="noopener noreferrer"
                        className="text-primary hover:underline inline-flex items-center gap-0.5">
                        {num}<ExternalLink className="w-2.5 h-2.5" />
                      </a>
                    ) : num}
                  </React.Fragment>
                );
              })}
            </p>
          )}
        </div>
        <div className="text-right shrink-0">
          {/* Price per UNIT is the headline — the line total is secondary. */}
          <p className="text-sm font-bold tabular-nums">{formatZAR(unitCost)} <span className="text-[11px] font-normal text-muted-foreground">{perUnitLabel}</span></p>
          <p className="text-[11px] text-muted-foreground tabular-nums">
            {count > 1 ? `${totalQty}${unitLabel} total` : `${line.qty}${unitLabel}`} · {formatZAR(line.line_total || 0)} line total
          </p>
        </div>
      </div>

      {/* AI proposal (from "Auto-fill"): a pre-filled product + purchasing unit
          ready for one-click Approve. A proposal with no product means the AI
          wasn't confident — link it manually. */}
      {proposal && proposal.proposed_product_id ? (
        <div className="px-4 py-2 border-t border-border bg-green-50/60 flex items-center gap-2 flex-wrap">
          <Sparkles className="w-3.5 h-3.5 text-green-600 shrink-0" />
          <span className="text-xs text-green-900">
            AI match: <span className="font-medium">{proposal.proposed_product_name}</span>
            {proposal.proposed_product_sku && <span className="font-mono text-green-700"> ({proposal.proposed_product_sku})</span>}
            {proposal.conversion_factor != null && proposal.proposed_stock_uom && (
              <span className="text-green-700"> · 1 {proposal.purchase_uom} = {proposal.conversion_factor} {proposal.proposed_stock_uom}</span>
            )}
            {proposal.nominal_cost != null && <span className="text-green-700"> · {formatZAR(proposal.nominal_cost)}</span>}
          </span>
          <Badge className={`text-[10px] ${confTone(proposal.confidence || 0)}`}>
            {Math.round((proposal.confidence || 0) * 100)}% · {proposal.match_method}
          </Badge>
          <div className="flex items-center gap-1.5 ml-auto">
            <Button variant="ghost" size="sm" onClick={() => onReject?.(lineGroup, proposal)} disabled={approving}
              className="gap-1 text-xs h-7 text-muted-foreground" title="Dismiss this suggestion">
              Reject
            </Button>
            <Button variant="outline" size="sm" onClick={() => onOpenMatch(lineGroup)} disabled={approving}
              className="gap-1 text-xs h-7" title="Review / edit before saving">
              <Pencil className="w-3 h-3" /> Edit
            </Button>
            <Button size="sm" onClick={() => onApprove?.(lineGroup, proposal)} disabled={approving}
              className="gap-1.5 text-xs h-7 bg-green-600 hover:bg-green-700">
              {approving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />} Approve
            </Button>
          </div>
        </div>
      ) : proposal && proposal.match_method === 'none' ? (
        <div className="px-4 py-2 border-t border-border bg-amber-50/60 flex items-center gap-2 flex-wrap">
          <HelpCircle className="w-3.5 h-3.5 text-amber-600 shrink-0" />
          <span className="text-xs text-amber-800">
            AI couldn't confidently match this — <span className="font-medium">link it manually</span>.
            {proposal.reasoning && <span className="text-amber-600"> {proposal.reasoning}</span>}
          </span>
          <Button variant="outline" size="sm" onClick={() => onOpenMatch(lineGroup)}
            className="gap-1.5 text-xs h-7 ml-auto border-amber-300 text-amber-800 hover:bg-amber-100">
            <Link2 className="w-3 h-3" /> Link
          </Button>
        </div>
      ) : null}

      {/* Possible product to link this new item to (suggestion only — already-linked
          items are auto-matched and never reach this queue). Hidden once an AI
          proposal exists. */}
      {!proposal && topMatch && (
        <div className="px-4 py-2 border-t border-border bg-amber-50/60 flex items-center gap-2 flex-wrap">
          <Sparkles className="w-3.5 h-3.5 text-amber-600 shrink-0" />
          <span className="text-xs text-amber-800">
            Possible match: <span className="font-medium">{topMatch.product.name}</span>
            {topMatch.product.sku && <span className="font-mono text-amber-700"> ({topMatch.product.sku})</span>}
            <span className="text-amber-600"> — {topMatch.reasons[0]}</span>
            {possibleMatches.length > 1 && <span className="text-amber-600"> · +{possibleMatches.length - 1} more</span>}
          </span>
          <Button
            variant="outline" size="sm" onClick={() => onOpenMatch(lineGroup)}
            className="gap-1.5 text-xs h-7 ml-auto border-amber-300 text-amber-800 hover:bg-amber-100"
          >
            <Link2 className="w-3 h-3" /> Link
          </Button>
        </div>
      )}

      {/* Actions */}
      <div className="px-4 py-2 border-t border-border bg-muted/20 flex items-center gap-2 flex-wrap">
        <Button variant="outline" size="sm" onClick={() => onOpenMatch(lineGroup)} className="gap-1.5 text-xs">
          <Link2 className="w-3.5 h-3.5" /> Link to Product
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
