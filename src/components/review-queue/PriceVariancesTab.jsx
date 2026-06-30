import React, { useState, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { base44, resolvePriceReview } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Loader2, TrendingUp, TrendingDown, Minus, Check, X, AlertTriangle,
  CheckCheck, Receipt, MessageSquareWarning, ArrowRight, History, Search, Pencil,
} from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/lib/AuthContext';

/**
 * "Price Variances" tab of the Review Queue.
 *
 * Two complementary views, switched by the sub-buckets:
 *
 *   Workflow (Pending / Disputed / Credits) — supplier prices that jumped past
 *   their variance threshold (from a GRN or matched invoice) were parked by
 *   reprice_supplier_product() and surface here as a lifecycle tracker:
 *     Pending   → Accept (apply new price) | Keep old (dismiss) | Dispute
 *     Disputed  → Resolve: Update price (agree) | Claim credit (price stays old)
 *     Credits   → tracker of credits owed by suppliers; hand off to Credits & Returns
 *   All transitions go through the resolve_price_review RPC so price application
 *   and pending_* clearing stay atomic with the status change.
 *
 *   All changes — the full audit trail of every recorded price change
 *   (SupplierPriceHistory), including the small under-threshold ones that were
 *   auto-applied and never parked. Search, filter, and "Mark reviewed" to sign off.
 */
const money = (n) => (n == null ? '—' : `R${Number(n).toFixed(2)}`);
const BUCKETS = [
  { key: 'pending',  label: 'Pending',         statuses: ['pending'] },
  { key: 'disputed', label: 'Disputed',        statuses: ['disputed'] },
  { key: 'credits',  label: 'Credits to claim', statuses: ['resolved_credit'] },
  { key: 'history',  label: 'All changes',     statuses: [] },
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

// ── "All changes" audit-trail view (full SupplierPriceHistory, beyond just the
//    parked variances). Lets you spot every movement and sign each one off. ──────
const isHistVariance = (h) => Math.abs(Number(h.change_pct) || 0) >= 0.01;

function HistVarianceIndicator({ changePct }) {
  if (changePct === 0 || changePct == null) {
    return <span className="text-xs text-muted-foreground flex items-center gap-0.5"><Minus className="w-3 h-3" /> 0%</span>;
  }
  if (changePct > 0) {
    return <span className="text-xs text-red-600 font-medium flex items-center gap-0.5"><TrendingUp className="w-3 h-3" /> +{changePct.toFixed(1)}%</span>;
  }
  return <span className="text-xs text-green-600 font-medium flex items-center gap-0.5"><TrendingDown className="w-3 h-3" /> {changePct.toFixed(1)}%</span>;
}

function PriceHistoryView({ user }) {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [reviewFilter, setReviewFilter] = useState('needs_review');
  const [savingId, setSavingId] = useState(null);

  const { data: history = [], isLoading } = useQuery({
    queryKey: ['price-history'],
    queryFn: () => base44.entities.SupplierPriceHistory.list('-created_date', 500),
  });

  const variances = useMemo(() => history.filter(isHistVariance), [history]);

  const filtered = useMemo(() => {
    return variances.filter(h => {
      if (search) {
        const q = search.toLowerCase();
        if (!(h.product_name || '').toLowerCase().includes(q) &&
            !(h.product_sku || '').toLowerCase().includes(q) &&
            !(h.supplier_name || '').toLowerCase().includes(q)) return false;
      }
      if (reviewFilter === 'needs_review' && h.review_status === 'reviewed') return false;
      if (reviewFilter === 'reviewed' && h.review_status !== 'reviewed') return false;
      if (filter === 'flagged') return Math.abs(h.change_pct || 0) > 10;
      if (filter === 'increases') return (h.change_pct || 0) > 0;
      if (filter === 'decreases') return (h.change_pct || 0) < 0;
      return true;
    });
  }, [variances, search, filter, reviewFilter]);

  const grouped = useMemo(() => {
    const groups = {};
    filtered.forEach(h => {
      const key = h.supplier_name || 'Unknown';
      if (!groups[key]) groups[key] = [];
      groups[key].push(h);
    });
    return Object.entries(groups).sort((a, b) => b[1].length - a[1].length);
  }, [filtered]);

  const totalChanges = variances.length;
  const increases = variances.filter(h => (h.change_pct || 0) > 0).length;
  const decreases = variances.filter(h => (h.change_pct || 0) < 0).length;
  const needsReview = variances.filter(h => h.review_status !== 'reviewed').length;

  const handleReview = async (h) => {
    setSavingId(h.id);
    try {
      await base44.entities.SupplierPriceHistory.update(h.id, {
        review_status: 'reviewed',
        reviewed_by: user?.full_name || user?.email || 'Unknown',
        reviewed_at: new Date().toISOString(),
      });
      queryClient.invalidateQueries({ queryKey: ['price-history'] });
      toast.success('Variance marked as reviewed');
    } catch (err) {
      toast.error(err.message || 'Failed to mark reviewed');
    } finally {
      setSavingId(null);
    }
  };

  const FILTER_TABS = [
    { key: 'all', label: 'All Changes' },
    { key: 'flagged', label: 'Flagged (>10%)' },
    { key: 'increases', label: 'Increases' },
    { key: 'decreases', label: 'Decreases' },
  ];
  const REVIEW_TABS = [
    { key: 'needs_review', label: 'Needs review' },
    { key: 'reviewed', label: 'Reviewed' },
    { key: 'all', label: 'All' },
  ];

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground max-w-3xl">
        Every recorded supplier price change (vs the previous purchase price) — including the small
        ones that were auto-applied without parking. Sign each off with <strong>Mark reviewed</strong>.
      </p>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-card border border-border rounded-xl px-4 py-3">
          <p className="text-[10px] text-muted-foreground uppercase font-semibold">Total Variances</p>
          <p className="text-lg font-bold">{totalChanges}</p>
        </div>
        <div className="bg-card border border-border rounded-xl px-4 py-3">
          <p className="text-[10px] text-red-600 uppercase font-semibold">Price Increases</p>
          <p className="text-lg font-bold text-red-600">{increases}</p>
        </div>
        <div className="bg-card border border-border rounded-xl px-4 py-3">
          <p className="text-[10px] text-green-600 uppercase font-semibold">Price Decreases</p>
          <p className="text-lg font-bold text-green-600">{decreases}</p>
        </div>
        <div className="bg-card border border-border rounded-xl px-4 py-3">
          <p className="text-[10px] text-amber-600 uppercase font-semibold">Needs Review</p>
          <p className="text-lg font-bold text-amber-600">{needsReview}</p>
        </div>
      </div>

      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex gap-2 flex-wrap">
          {FILTER_TABS.map(tab => (
            <button
              key={tab.key}
              onClick={() => setFilter(tab.key)}
              className={`text-xs px-3 py-1.5 rounded-full font-medium transition-all ${
                filter === tab.key
                  ? 'bg-primary/10 text-primary ring-2 ring-primary/30'
                  : 'bg-muted text-muted-foreground hover:bg-muted/80'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <div className="flex gap-2 flex-wrap">
          {REVIEW_TABS.map(tab => (
            <button
              key={tab.key}
              onClick={() => setReviewFilter(tab.key)}
              className={`text-xs px-3 py-1.5 rounded-full font-medium transition-all ${
                reviewFilter === tab.key
                  ? 'bg-foreground text-background'
                  : 'bg-muted text-muted-foreground hover:bg-muted/80'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input placeholder="Search product, SKU, or supplier..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
        </div>
        {search && (
          <Button variant="ghost" size="sm" onClick={() => setSearch('')} className="gap-1">
            <X className="w-3.5 h-3.5" /> Clear
          </Button>
        )}
      </div>

      {isLoading ? (
        <div className="text-center py-12 text-sm text-muted-foreground">Loading price history...</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12 text-sm text-muted-foreground">
          {history.length === 0 ? 'No price changes recorded yet. Confirm a GRN to start tracking.' : 'No results match your filter.'}
        </div>
      ) : (
        <div className="space-y-4">
          {grouped.map(([supplierName, records]) => (
            <div key={supplierName} className="bg-card border border-border rounded-xl overflow-hidden">
              <div className="px-4 py-3 bg-muted/30 border-b border-border flex items-center justify-between">
                <h3 className="text-sm font-semibold">{supplierName}</h3>
                <span className="text-xs text-muted-foreground">{records.length} change{records.length !== 1 ? 's' : ''}</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="text-left px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase">Product</th>
                      <th className="text-right px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase">Previous</th>
                      <th className="text-right px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase">New Price</th>
                      <th className="text-right px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase">Change</th>
                      <th className="text-left px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase">UoM</th>
                      <th className="text-left px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase">Source</th>
                      <th className="text-left px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase">Date</th>
                      <th className="text-left px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase">Review</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {records.slice(0, 15).map(h => {
                      const isFlagged = Math.abs(h.change_pct || 0) > 10;
                      return (
                        <tr key={h.id} className={`hover:bg-muted/20 ${isFlagged ? 'bg-amber-50/50' : ''}`}>
                          <td className="px-3 py-2">
                            <div className="text-sm font-medium">{h.product_name}</div>
                            <div className="text-[11px] font-mono text-muted-foreground">{h.product_sku}</div>
                          </td>
                          <td className="px-3 py-2 text-sm text-right tabular-nums text-muted-foreground">
                            {(h.previous_price || 0) > 0 ? `R ${h.previous_price.toFixed(2)}` : '—'}
                          </td>
                          <td className="px-3 py-2 text-sm text-right tabular-nums font-medium">
                            R {(h.price || 0).toFixed(2)}
                          </td>
                          <td className="px-3 py-2 text-right">
                            <HistVarianceIndicator changePct={h.change_pct} />
                          </td>
                          <td className="px-3 py-2 text-xs">{h.purchase_uom || '—'}</td>
                          <td className="px-3 py-2">
                            <Badge variant="outline" className="text-[10px]">{h.source_ref || h.source}</Badge>
                          </td>
                          <td className="px-3 py-2 text-xs text-muted-foreground">{h.effective_date}</td>
                          <td className="px-3 py-2 text-xs">
                            {h.review_status === 'reviewed' ? (
                              <span className="text-green-600">
                                <span className="inline-flex items-center gap-1 font-medium"><Check className="w-3 h-3" /> Reviewed</span>
                                {h.reviewed_by && (
                                  <span className="block text-[10px] text-muted-foreground">
                                    {h.reviewed_by}{h.reviewed_at ? ` · ${new Date(h.reviewed_at).toLocaleDateString('en-ZA')}` : ''}
                                  </span>
                                )}
                              </span>
                            ) : (
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 px-2 gap-1 text-xs"
                                disabled={savingId === h.id}
                                onClick={() => handleReview(h)}
                              >
                                {savingId === h.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
                                Mark reviewed
                              </Button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {records.length > 15 && (
                  <div className="px-3 py-2 text-xs text-muted-foreground text-center border-t border-border">
                    + {records.length - 15} more — use search to narrow
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
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

  const [editId, setEditId] = useState(null);   // cost-fix row being price-corrected
  const [editCost, setEditCost] = useState('');  // corrected cost per stock unit

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

  const startEdit = (r) => {
    setEditId(r.id);
    setEditCost(r.new_price_per_stock_unit != null ? String(r.new_price_per_stock_unit) : '');
  };

  // Save a hand-corrected per-unit cost, then accept. Keeps the supplier purchase
  // price consistent with the corrected unit cost (price = unit cost × pack).
  const saveAndAccept = async (r) => {
    const cost = Number(editCost);
    if (!Number.isFinite(cost) || cost <= 0) { toast.error('Enter a valid cost per unit'); return; }
    setBusy(r.id);
    try {
      const cf = Number(r.new_conversion_factor) || Number(r.conversion_factor) || 1;
      await base44.entities.SupplierPriceReview.update(r.id, {
        new_price_per_stock_unit: Math.round(cost * 10000) / 10000,
        new_price: Math.round(cost * cf * 10000) / 10000,
        confidence: 'high',
        derivation: `${r.derivation ? r.derivation + ' · ' : ''}Hand-corrected to R${cost}/unit`,
      });
      await resolvePriceReview(r.id, 'accept', { user: userName });
      setEditId(null);
      await refetch();
      toast.success('Corrected cost saved & applied');
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
      // Don't sweep away cost-fix rows that still need a pack size — accepting
      // them is a no-op that would just hide the flag.
      if (r.kind === 'cost_fix' && r.new_price_per_stock_unit == null) continue;
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

  const rows = bucket === 'history' ? [] : byBucket[bucket];

  return (
    <div className="space-y-4">
      {bucket !== 'history' && (
        <p className="text-xs text-muted-foreground max-w-3xl">
          Supplier prices that moved more than their allowed variance on a recent GRN or invoice were
          held for review instead of silently changing your cost basis. <strong>Accept</strong> to update the
          price list, <strong>Dispute</strong> to track a follow-up with the supplier, then <strong>Resolve</strong> a
          dispute by either agreeing the new price or claiming a credit. The <strong>All changes</strong> tab
          shows the full history of every price movement.
        </p>
      )}

      {/* Sub-buckets */}
      <div className="flex items-center gap-1">
        {BUCKETS.map(b => {
          const count = b.key === 'history' ? null : byBucket[b.key].length;
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
              {b.key === 'history'  && <History className="w-3.5 h-3.5" />}
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

      {bucket === 'history' ? (
        <PriceHistoryView user={user} />
      ) : isLoading ? (
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
                <p className="font-medium truncate">
                  {r.product_name}
                  {r.kind === 'cost_fix' && (
                    <span className="ml-1.5 align-middle text-[10px] uppercase tracking-wide bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded">Cost fix</span>
                  )}
                  {r.kind === 'cost_fix' && r.confidence && (
                    <span className={`ml-1 align-middle text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded ${
                      r.confidence === 'high' ? 'bg-green-50 text-green-700' : 'bg-amber-50 text-amber-700'}`}>
                      {r.confidence === 'high' ? 'auto' : 'needs pack size'}
                    </span>
                  )}
                </p>
                <p className="text-muted-foreground">
                  {r.supplier_name}
                  {r.purchase_uom ? <span> · per {r.purchase_uom}</span> : null}
                  {r.source ? <span className="ml-1 uppercase tracking-wide text-[10px] bg-muted px-1 py-0.5 rounded">{r.source}</span> : null}
                </p>
                {r.kind === 'cost_fix' ? (
                  <>
                    {editId === r.id ? (
                      <div className="mt-1 flex items-center gap-2 flex-wrap">
                        <span className="text-[11px] text-muted-foreground">Cost per unit R</span>
                        <Input
                          type="number" min="0" step="0.0001" autoFocus
                          value={editCost} onChange={e => setEditCost(e.target.value)}
                          className="h-7 w-28 text-xs"
                          onKeyDown={e => { if (e.key === 'Enter') saveAndAccept(r); }}
                        />
                        {Number(editCost) > 0 && (r.new_conversion_factor || r.conversion_factor) ? (
                          <span className="text-[11px] text-muted-foreground">
                            = {money(Number(editCost) * (Number(r.new_conversion_factor) || Number(r.conversion_factor) || 1))} per {r.purchase_uom || 'pack'}
                          </span>
                        ) : null}
                      </div>
                    ) : r.new_price_per_stock_unit != null ? (
                      <VariancePill prev={r.current_pps} next={r.new_price_per_stock_unit} variance={r.variance} />
                    ) : null}
                    {r.derivation && editId !== r.id ? <p className="mt-1 text-[11px] text-muted-foreground italic">{r.derivation}</p> : null}
                  </>
                ) : (
                  <VariancePill prev={r.previous_price} next={r.new_price} variance={r.variance} />
                )}
                {bucket === 'credits' && (
                  <p className="mt-1 text-muted-foreground">
                    Credit owed: <span className="font-semibold text-foreground">{r.credit_amount != null ? money(r.credit_amount) : '— (enter on claim)'}</span>
                    {r.notes ? <span className="italic"> · {r.notes}</span> : null}
                  </p>
                )}
              </div>

              {/* Actions per bucket */}
              <div className="flex flex-col items-end gap-1.5 shrink-0">
                {bucket === 'pending' && editId === r.id && (
                  <div className="flex gap-1.5">
                    <Button size="sm" className="h-7 text-xs gap-1"
                      onClick={() => saveAndAccept(r)} disabled={busy === r.id}>
                      {busy === r.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                      Save &amp; Accept
                    </Button>
                    <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setEditId(null)} disabled={busy === r.id}>Cancel</Button>
                  </div>
                )}
                {bucket === 'pending' && editId !== r.id && (
                  <div className="flex gap-1.5">
                    {r.kind === 'cost_fix' && r.new_price_per_stock_unit == null ? null : (
                      <Button variant="outline" size="sm" className="h-7 text-xs border-primary/40 text-primary gap-1"
                        onClick={() => act(r, 'accept')} disabled={!!busy}>
                        {busy === r.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                        Accept
                      </Button>
                    )}
                    {r.kind === 'cost_fix' && (
                      <Button variant="outline" size="sm" className="h-7 text-xs border-blue-300 text-blue-700 gap-1"
                        onClick={() => startEdit(r)} disabled={!!busy}>
                        <Pencil className="w-3.5 h-3.5" /> {r.new_price_per_stock_unit == null ? 'Set price' : 'Correct'}
                      </Button>
                    )}
                    {r.kind !== 'cost_fix' && (
                      <Button variant="outline" size="sm" className="h-7 text-xs border-amber-300 text-amber-700 gap-1"
                        onClick={() => act(r, 'dispute')} disabled={!!busy}>
                        <MessageSquareWarning className="w-3.5 h-3.5" /> Dispute
                      </Button>
                    )}
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
