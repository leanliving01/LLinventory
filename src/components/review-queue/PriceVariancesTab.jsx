import React, { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { base44, resolvePriceReview } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Loader2, TrendingUp, TrendingDown, Check, X, AlertTriangle,
  CheckCheck, Receipt, MessageSquareWarning, ArrowRight,
} from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/lib/AuthContext';

/**
 * "Price Variances" tab of the Review Queue.
 *
 * Supplier prices that jumped past their variance threshold (from a GRN or a
 * matched invoice) are parked by reprice_supplier_product() and surfaced here
 * as a lifecycle tracker:
 *
 *   Pending   → Accept (apply new price) | Keep old (dismiss) | Dispute
 *   Disputed  → Resolve: Update price (agree) | Claim credit (price stays old)
 *   Credits   → tracker of credits owed by suppliers; hand off to Credits & Returns
 *
 * All transitions go through the resolve_price_review RPC so price application
 * and pending_* clearing stay atomic with the status change.
 */
const money = (n) => (n == null ? '—' : `R${Number(n).toFixed(2)}`);
const BUCKETS = [
  { key: 'pending',  label: 'Pending',         statuses: ['pending'] },
  { key: 'disputed', label: 'Disputed',        statuses: ['disputed'] },
  { key: 'credits',  label: 'Credits to claim', statuses: ['resolved_credit'] },
];

function VariancePill({ prev, next, variance }) {
  const up = (next ?? 0) >= (prev ?? 0);
  const pct = variance != null ? Math.round(variance * 100) : null;
  return (
    <span className="mt-1 flex items-center gap-1.5 flex-wrap text-xs">
      <span className="text-muted-foreground line-through">{money(prev)}</span>
      <ArrowRight className="w-3 h-3 text-muted-foreground" />
      <span className={`font-semibold ${up ? 'text-red-600' : 'text-green-700'}`}>{money(next)}</span>
      <span className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full ${up ? 'bg-red-50 text-red-600' : 'bg-green-50 text-green-700'}`}>
        {up ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
        {pct != null ? `${up ? '+' : '−'}${pct}%` : ''}
      </span>
    </span>
  );
}

export default function PriceVariancesTab() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const userName = user?.full_name || user?.email || 'System';
  const [bucket, setBucket] = useState('pending');
  const [busy, setBusy] = useState(null);                 // 'all' | <reviewId>
  const [creditFor, setCreditFor] = useState(null);       // review being resolved as credit
  const [creditAmount, setCreditAmount] = useState('');

  const { data: reviews = [], refetch, isLoading } = useQuery({
    queryKey: ['supplier-price-reviews'],
    queryFn: () => base44.entities.SupplierPriceReview.filter(
      { status: { $in: ['pending', 'disputed', 'resolved_credit'] } }, '-updated_date', 500,
    ),
  });

  const byBucket = useMemo(() => {
    const map = { pending: [], disputed: [], credits: [] };
    for (const r of reviews) {
      if (r.status === 'pending') map.pending.push(r);
      else if (r.status === 'disputed') map.disputed.push(r);
      else if (r.status === 'resolved_credit') map.credits.push(r);
    }
    return map;
  }, [reviews]);

  const act = async (review, action, opts = {}) => {
    setBusy(review.id);
    try {
      await resolvePriceReview(review.id, action, { user: userName, ...opts });
      await refetch();
    } catch (err) {
      toast.error(`Failed: ${err.message}`);
    } finally {
      setBusy(null);
    }
  };

  const acceptAllPending = async () => {
    setBusy('all');
    let n = 0;
    for (const r of byBucket.pending) {
      try { await resolvePriceReview(r.id, 'accept', { user: userName }); n++; } catch { /* skip */ }
    }
    toast.success(`Accepted ${n} price change${n !== 1 ? 's' : ''}`);
    await refetch();
    setBusy(null);
  };

  const confirmCredit = async () => {
    const amt = creditAmount === '' ? null : Number(creditAmount);
    await act(creditFor, 'resolve_credit', { creditAmount: Number.isFinite(amt) ? amt : null });
    setCreditFor(null);
    setCreditAmount('');
  };

  const rows = byBucket[bucket];

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground max-w-3xl">
        Supplier prices that moved more than their allowed variance on a recent GRN or invoice were
        held for review instead of silently changing your cost basis. <strong>Accept</strong> to update the
        price list, <strong>Dispute</strong> to track a follow-up with the supplier, then <strong>Resolve</strong> a
        dispute by either agreeing the new price or claiming a credit.
      </p>

      {/* Sub-buckets */}
      <div className="flex items-center gap-1">
        {BUCKETS.map(b => {
          const count = byBucket[b.key].length;
          return (
            <button
              key={b.key}
              onClick={() => setBucket(b.key)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md flex items-center gap-2 transition-colors ${
                bucket === b.key ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {b.key === 'pending'  && <AlertTriangle className="w-3.5 h-3.5" />}
              {b.key === 'disputed' && <MessageSquareWarning className="w-3.5 h-3.5" />}
              {b.key === 'credits'  && <Receipt className="w-3.5 h-3.5" />}
              {b.label}
              {count > 0 && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-muted">{count}</span>}
            </button>
          );
        })}
        <div className="flex-1" />
        {bucket === 'pending' && byBucket.pending.length > 0 && (
          <Button variant="outline" size="sm" onClick={acceptAllPending} disabled={!!busy} className="gap-1.5 h-8 text-xs">
            {busy === 'all' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCheck className="w-3.5 h-3.5" />}
            Accept all ({byBucket.pending.length})
          </Button>
        )}
      </div>

      {isLoading ? (
        <div className="text-center py-12 text-sm text-muted-foreground">Loading...</div>
      ) : rows.length === 0 ? (
        <div className="text-center py-16">
          <div className="w-16 h-16 rounded-full bg-green-50 flex items-center justify-center mx-auto mb-4">
            <Check className="w-8 h-8 text-green-500" />
          </div>
          <p className="text-sm font-medium text-foreground">
            {bucket === 'pending' ? 'No price changes to review' : bucket === 'disputed' ? 'Nothing under dispute' : 'No credits to claim'}
          </p>
        </div>
      ) : (
        <div className="border border-border rounded-lg divide-y divide-border bg-card">
          {rows.map(r => (
            <div key={r.id} className="p-3 flex items-start gap-3 text-xs">
              <div className="flex-1 min-w-0">
                <p className="font-medium truncate">{r.product_name}</p>
                <p className="text-muted-foreground">
                  {r.supplier_name}
                  {r.purchase_uom ? <span> · per {r.purchase_uom}</span> : null}
                  {r.source ? <span className="ml-1 uppercase tracking-wide text-[10px] bg-muted px-1 py-0.5 rounded">{r.source}</span> : null}
                </p>
                <VariancePill prev={r.previous_price} next={r.new_price} variance={r.variance} />
                {bucket === 'credits' && (
                  <p className="mt-1 text-muted-foreground">
                    Credit owed: <span className="font-semibold text-foreground">{r.credit_amount != null ? money(r.credit_amount) : '— (enter on claim)'}</span>
                    {r.notes ? <span className="italic"> · {r.notes}</span> : null}
                  </p>
                )}
              </div>

              {/* Actions per bucket */}
              <div className="flex flex-col items-end gap-1.5 shrink-0">
                {bucket === 'pending' && (
                  <div className="flex gap-1.5">
                    <Button variant="outline" size="sm" className="h-7 text-xs border-primary/40 text-primary gap-1"
                      onClick={() => act(r, 'accept')} disabled={!!busy}>
                      {busy === r.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                      Accept
                    </Button>
                    <Button variant="outline" size="sm" className="h-7 text-xs border-amber-300 text-amber-700 gap-1"
                      onClick={() => act(r, 'dispute')} disabled={!!busy}>
                      <MessageSquareWarning className="w-3.5 h-3.5" /> Dispute
                    </Button>
                    <Button variant="ghost" size="sm" className="h-7 text-xs text-muted-foreground gap-1"
                      onClick={() => act(r, 'dismiss')} disabled={!!busy}>
                      <X className="w-3.5 h-3.5" /> Keep old
                    </Button>
                  </div>
                )}

                {bucket === 'disputed' && creditFor?.id !== r.id && (
                  <div className="flex gap-1.5">
                    <span className="text-[10px] text-muted-foreground self-center mr-1">Resolve →</span>
                    <Button variant="outline" size="sm" className="h-7 text-xs border-primary/40 text-primary gap-1"
                      onClick={() => act(r, 'resolve_update')} disabled={!!busy}>
                      {busy === r.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                      Update price
                    </Button>
                    <Button variant="outline" size="sm" className="h-7 text-xs border-blue-300 text-blue-700 gap-1"
                      onClick={() => { setCreditFor(r); setCreditAmount(''); }} disabled={!!busy}>
                      <Receipt className="w-3.5 h-3.5" /> Claim credit
                    </Button>
                  </div>
                )}

                {bucket === 'disputed' && creditFor?.id === r.id && (
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] text-muted-foreground">Credit amount</span>
                    <Input
                      type="number" min="0" step="0.01" placeholder="optional"
                      value={creditAmount} onChange={e => setCreditAmount(e.target.value)}
                      className="h-7 w-28 text-xs"
                    />
                    <Button size="sm" className="h-7 text-xs gap-1" onClick={confirmCredit} disabled={busy === r.id}>
                      {busy === r.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                      Confirm
                    </Button>
                    <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setCreditFor(null)}>Cancel</Button>
                  </div>
                )}

                {bucket === 'credits' && (
                  <Button variant="outline" size="sm" className="h-7 text-xs gap-1"
                    onClick={() => navigate('/purchasing/credits-returns')}>
                    Credits &amp; Returns <ArrowRight className="w-3.5 h-3.5" />
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
