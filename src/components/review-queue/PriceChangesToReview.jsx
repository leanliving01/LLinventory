import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Loader2, TrendingUp, TrendingDown, CheckCheck, Check, X } from 'lucide-react';
import { toast } from 'sonner';

/**
 * "Price changes to review" — supplier prices that moved past their variance
 * threshold on a recurring invoice.
 *
 * The DB trigger (migration 086) keeps a supplier product's price in sync with
 * each new matched invoice automatically, BUT when the change blows past the
 * product's price_variance_threshold it parks the new price in pending_* columns
 * instead of overwriting (a surprise price is often a unit mismatch, not a real
 * increase). Those flagged prices surface here for one-click Accept / Dismiss.
 *
 * Accept  → apply the pending price as the supplier product's live price.
 * Dismiss → keep the old price; just clear the flag.
 */
const money = (n) => (n == null ? '—' : `R${Number(n).toFixed(2)}`);
const CLEAR = {
  pending_price: null, pending_price_per_stock_unit: null, pending_price_previous: null,
  pending_price_variance: null, pending_price_at: null, pending_price_invoice_id: null,
};

export default function PriceChangesToReview() {
  const [busy, setBusy] = useState(null); // 'all' | <id>

  const { data: flagged = [], refetch } = useQuery({
    queryKey: ['supplier-pending-prices'],
    queryFn: () => base44.entities.SupplierProduct.filter(
      { pending_price: { $gt: 0 }, active: true }, '-pending_price_variance', 300,
    ),
  });

  const accept = async (sp) => {
    await base44.entities.SupplierProduct.update(sp.id, {
      last_purchase_price: sp.pending_price,
      nominal_cost: sp.pending_price,
      price_per_stock_unit: sp.pending_price_per_stock_unit ?? sp.price_per_stock_unit,
      last_purchase_date: new Date().toISOString(),
      ...CLEAR,
    });
  };
  const dismiss = (sp) => base44.entities.SupplierProduct.update(sp.id, CLEAR);

  const runOne = async (sp, fn, verb) => {
    setBusy(sp.id);
    try { await fn(sp); refetch(); }
    catch (err) { toast.error(`${verb} failed: ${err.message}`); }
    finally { setBusy(null); }
  };

  const acceptAll = async () => {
    setBusy('all');
    let n = 0;
    for (const sp of flagged) { try { await accept(sp); n++; } catch { /* skip */ } }
    toast.success(`Applied ${n} price change${n !== 1 ? 's' : ''}`);
    refetch();
    setBusy(null);
  };

  if (flagged.length === 0) return null; // silent when nothing to review

  return (
    <div className="border border-amber-200 bg-amber-50/40 rounded-lg p-3 space-y-3">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <p className="text-sm font-semibold flex items-center gap-1.5 text-amber-800">
            <TrendingUp className="w-4 h-4" /> Price changes to review ({flagged.length})
          </p>
          <p className="text-xs text-muted-foreground max-w-2xl mt-0.5">
            These supplier prices moved more than their allowed variance on a recent invoice, so the
            new price was held for you to confirm rather than applied automatically. A big jump is
            often a unit mismatch (billed per kg vs per case) — check before accepting.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={acceptAll} disabled={!!busy} className="gap-1.5 h-8 text-xs shrink-0">
          {busy === 'all' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCheck className="w-3.5 h-3.5" />}
          Accept all ({flagged.length})
        </Button>
      </div>

      <div className="border border-border rounded-lg divide-y divide-border bg-card">
        {flagged.map(sp => {
          const up = (sp.pending_price ?? 0) >= (sp.pending_price_previous ?? 0);
          const pct = sp.pending_price_variance != null ? Math.round(sp.pending_price_variance * 100) : null;
          return (
            <div key={sp.id} className="p-3 flex items-center gap-3 text-xs">
              <div className="flex-1 min-w-0">
                <p className="font-medium truncate">{sp.product_name}</p>
                <p className="text-muted-foreground">{sp.supplier_name}</p>
                <p className="mt-1 flex items-center gap-1.5 flex-wrap">
                  <span className="text-muted-foreground line-through">{money(sp.pending_price_previous)}</span>
                  <span>→</span>
                  <span className={`font-semibold ${up ? 'text-red-600' : 'text-green-700'}`}>{money(sp.pending_price)}</span>
                  <span className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full ${up ? 'bg-red-50 text-red-600' : 'bg-green-50 text-green-700'}`}>
                    {up ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                    {pct != null ? `${up ? '+' : '−'}${pct}%` : ''}
                  </span>
                  <span className="text-muted-foreground">per {sp.purchase_uom_label || sp.purchase_uom || 'unit'}</span>
                </p>
              </div>
              <div className="flex gap-1.5 shrink-0">
                <Button variant="outline" size="sm" className="h-7 text-xs border-primary/40 text-primary gap-1"
                  onClick={() => runOne(sp, accept, 'Accept')} disabled={!!busy}>
                  {busy === sp.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                  Accept
                </Button>
                <Button variant="ghost" size="sm" className="h-7 text-xs text-muted-foreground gap-1"
                  onClick={() => runOne(sp, dismiss, 'Dismiss')} disabled={!!busy}>
                  <X className="w-3.5 h-3.5" /> Keep old
                </Button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
