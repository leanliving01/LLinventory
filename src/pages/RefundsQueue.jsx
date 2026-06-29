import React, { useState, useMemo } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, Link, useSearchParams } from 'react-router-dom';
import { DollarSign, Search, Loader2 } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import TablePagination from '@/components/shared/TablePagination';
import { formatDateTimeSAST } from '@/lib/dateUtils';
import { hasRefund, refundIsOpen, refundCompleted } from '@/lib/shopifyReturns';
import { REFUND_DECISIONS } from '@/lib/salesResends';
import { usePersistentState, useScrollRestoration } from '@/lib/usePersistentState';

// Refunds queue (Phase 7) — a lens over shopify_returns. Open vs Completed.
// A refund-only record is just a return with stock_path='not_receiving'.
const decisionLabel = (v) => REFUND_DECISIONS.find(d => d.value === v)?.label || v || '—';

export default function RefundsQueue() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = searchParams.get('tab') === 'completed' ? 'completed'
    : searchParams.get('tab') === 'all' ? 'all' : 'open';
  const setTab = (t) => setSearchParams(t === 'open' ? {} : { tab: t });
  // Search/page-size persist for the session so returning from a refund detail
  // restores the same view. Page resets to 0 on tab/search change (effect below).
  const [search, setSearch] = usePersistentState('refunds:search', '');
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = usePersistentState('refunds:pageSize', 25);

  const { data: returns = [], isLoading } = useQuery({
    queryKey: ['shopify-returns'],
    queryFn: () => base44.entities.ShopifyReturn.list('-created_date', 5000),
    staleTime: 20000,
  });

  // Restore scroll position when returning from a refund detail.
  useScrollRestoration('refunds:scroll', !isLoading);

  // Only returns that participate in a refund.
  const refundRows = useMemo(() => returns.filter(hasRefund), [returns]);

  const counts = useMemo(() => ({
    open: refundRows.filter(refundIsOpen).length,
    completed: refundRows.filter(refundCompleted).length,
    all: refundRows.length,
  }), [refundRows]);

  const filtered = useMemo(() => {
    let list = refundRows;
    if (tab === 'open') list = list.filter(refundIsOpen);
    else if (tab === 'completed') list = list.filter(refundCompleted);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(r =>
        (r.order_number || '').toLowerCase().includes(q) ||
        (r.customer_name || '').toLowerCase().includes(q) ||
        (r.return_number || '').toLowerCase().includes(q));
    }
    return list;
  }, [refundRows, tab, search]);

  React.useEffect(() => { setPage(0); }, [tab, search]);

  const totalOpen = useMemo(() => refundRows.filter(refundIsOpen).reduce((s, r) => s + (Number(r.refund_amount) || 0), 0), [refundRows]);
  const pageRows = filtered.slice(page * pageSize, (page + 1) * pageSize);

  const TABS = [
    { key: 'open', label: 'Open Refunds' },
    { key: 'completed', label: 'Completed' },
    { key: 'all', label: 'All' },
  ];

  return (
    <div className="p-4 md:p-6 space-y-5 max-w-[1400px] mx-auto">
      <div className="flex items-center gap-3">
        <DollarSign className="w-6 h-6 text-primary" />
        <h1 className="text-2xl font-bold">Refunds</h1>
        <span className="text-sm text-muted-foreground ml-auto">{filtered.length} shown</span>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi label="Open Refunds" value={counts.open} highlight={counts.open > 0} />
        <Kpi label="Open Refund Value" value={`R ${totalOpen.toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`} />
        <Kpi label="Completed" value={counts.completed} />
        <Kpi label="All Refunds" value={counts.all} />
      </div>

      <div className="flex flex-wrap gap-1.5">
        {TABS.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${tab === t.key ? 'bg-primary text-primary-foreground border-primary' : 'bg-card hover:bg-muted'}`}>
            {t.label} <span className="opacity-60">{counts[t.key] ?? 0}</span>
          </button>
        ))}
      </div>

      <div className="relative max-w-sm">
        <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Order #, customer, return #..." className="pl-9" />
      </div>

      <p className="text-xs text-muted-foreground">
        Refunds are recorded against returns — they never move stock. To record a refund with no return,
        open the order and create a return with “Not Receiving Stock Back”, then set the refund decision.
      </p>

      <div className="bg-card rounded-xl border overflow-hidden">
        <div className="hidden lg:grid grid-cols-[110px_90px_150px_140px_130px_120px_110px] gap-2 px-4 py-2.5 border-b text-xs font-medium text-muted-foreground bg-muted/40">
          <span>Return #</span><span>Order #</span><span>Customer</span><span>Decision</span>
          <span>Status</span><span>Completed</span><span className="text-right">Amount</span>
        </div>
        {isLoading ? (
          <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground text-sm">No refunds in this view</div>
        ) : (
          <>
            {pageRows.map(r => (
              <button key={r.id} onClick={() => navigate(`/sales/refunds/${r.id}`)}
                className="w-full text-left grid grid-cols-1 lg:grid-cols-[110px_90px_150px_140px_130px_120px_110px] gap-2 px-4 py-3 border-b last:border-b-0 hover:bg-muted/40 items-center">
                <span className="font-mono text-xs">{r.return_number}</span>
                <span className="text-sm">
                  {r.order_number
                    ? (r.sales_order_id
                        ? <Link to={`/sales/orders/${r.sales_order_id}`} onClick={e => e.stopPropagation()} className="text-primary hover:underline">{r.order_number}</Link>
                        : r.order_number)
                    : '—'}
                </span>
                <span className="text-sm truncate">{r.customer_name || '—'}</span>
                <span className="text-xs text-muted-foreground">{decisionLabel(r.refund_decision)}</span>
                <span>
                  <Badge className={`text-[10px] ${refundCompleted(r) ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>
                    {refundCompleted(r) ? 'Completed' : (r.refund_status || 'Open')}
                  </Badge>
                </span>
                <span className="text-xs text-muted-foreground">{r.refund_completed_at ? formatDateTimeSAST(r.refund_completed_at) : '—'}</span>
                <span className="text-sm text-right font-medium">R {(Number(r.refund_amount) || 0).toFixed(2)}</span>
              </button>
            ))}
            <TablePagination page={page} pageSize={pageSize} totalItems={filtered.length}
              onPageChange={setPage} onPageSizeChange={v => { setPageSize(v); setPage(0); }} />
          </>
        )}
      </div>
    </div>
  );
}

function Kpi({ label, value, highlight }) {
  return (
    <div className={`rounded-xl border p-3 ${highlight ? 'border-amber-300 bg-amber-50' : 'bg-card'}`}>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-lg font-bold mt-0.5">{value}</div>
    </div>
  );
}
