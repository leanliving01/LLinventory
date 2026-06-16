import React, { useState, useMemo } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, Link, useSearchParams } from 'react-router-dom';
import { Send, Search, Plus, Loader2, X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import TablePagination from '@/components/shared/TablePagination';
import { formatDateTimeSAST } from '@/lib/dateUtils';
import { toast } from 'sonner';
import { RESEND_STATUS_LABELS, RESEND_STATUS_COLORS, reasonLabel, resendMatchesQueue } from '@/lib/salesResends';
import { createResendFromOrder } from '@/lib/createResend';

// Composite dashboard queues (not plain statuses) deep-linked from Operations.
const QUEUE_LABELS = {
  resend_awaiting_decision: 'Awaiting Re-send Decision',
  resend_to_pack: 'Re-sends To Be Packed / Sent',
};

const TABS = [
  { key: 'draft', label: 'Draft' },
  { key: 'pending_approval', label: 'Pending Approval' },
  { key: 'approved', label: 'Approved' },
  { key: 'picked_packed', label: 'Picked / Packed' },
  { key: 'sent', label: 'Sent' },
  { key: 'completed', label: 'Completed' },
  { key: 'cancelled', label: 'Cancelled' },
  { key: 'all', label: 'All' },
];

export default function SalesResends() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const queueParam = searchParams.get('queue'); // composite queue from Operations dashboard
  const [tab, setTab] = useState('draft');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const [showNew, setShowNew] = useState(false);

  const { data: resends = [], isLoading } = useQuery({
    queryKey: ['sales-resends'],
    queryFn: () => base44.entities.SalesResend.list('-created_date', 5000),
    staleTime: 20000,
  });
  const { data: lines = [] } = useQuery({
    queryKey: ['sales-resend-lines-all'],
    queryFn: () => base44.entities.SalesResendLine.list('-created_date', 20000),
    staleTime: 20000,
  });

  const linesByResend = useMemo(() => {
    const m = {};
    for (const l of lines) (m[l.resend_id] ||= []).push(l);
    return m;
  }, [lines]);

  const rows = useMemo(() => resends.map(r => {
    const rl = linesByResend[r.id] || [];
    return { ...r, qty: rl.reduce((s, l) => s + (l.qty || 0), 0), skus: rl.map(l => l.sku).filter(Boolean).join(', ') };
  }), [resends, linesByResend]);

  const tabCounts = useMemo(() => {
    const c = {};
    for (const t of TABS) c[t.key] = t.key === 'all' ? rows.length : rows.filter(r => r.status === t.key).length;
    return c;
  }, [rows]);

  const filtered = useMemo(() => {
    let list = queueParam
      ? rows.filter(r => resendMatchesQueue(r, queueParam))
      : (tab === 'all' ? rows : rows.filter(r => r.status === tab));
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(r =>
        (r.order_number || '').toLowerCase().includes(q) ||
        (r.customer_name || '').toLowerCase().includes(q) ||
        (r.resend_number || '').toLowerCase().includes(q) ||
        (r.reason || '').toLowerCase().includes(q) ||
        (r.skus || '').toLowerCase().includes(q)
      );
    }
    return list;
  }, [rows, tab, search]);

  React.useEffect(() => { setPage(0); }, [tab, search, queueParam]);

  const pageRows = filtered.slice(page * pageSize, (page + 1) * pageSize);

  return (
    <div className="p-4 md:p-6 space-y-5 max-w-[1400px] mx-auto">
      <div className="flex items-center gap-3">
        <Send className="w-6 h-6 text-primary" />
        <h1 className="text-2xl font-bold">Re-sends</h1>
        <span className="text-sm text-muted-foreground ml-auto">{filtered.length} shown</span>
        <Button onClick={() => setShowNew(true)} className="gap-1.5"><Plus className="w-4 h-4" /> New Re-send</Button>
      </div>

      {queueParam ? (
        <div className="flex items-center gap-2 text-sm">
          <Badge className="bg-primary/10 text-primary">{QUEUE_LABELS[queueParam] || queueParam}</Badge>
          <span className="text-muted-foreground">{filtered.length} re-send(s)</span>
          <button onClick={() => setSearchParams({})} className="text-xs text-primary hover:underline inline-flex items-center gap-1">
            <X className="w-3 h-3" /> Clear filter
          </button>
        </div>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {TABS.map(t => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${tab === t.key ? 'bg-primary text-primary-foreground border-primary' : 'bg-card hover:bg-muted'}`}>
              {t.label} <span className="opacity-60">{tabCounts[t.key] ?? 0}</span>
            </button>
          ))}
        </div>
      )}

      <div className="relative max-w-sm">
        <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Resend #, order #, customer, SKU, reason..." className="pl-9" />
      </div>

      <div className="bg-card rounded-xl border overflow-hidden">
        <div className="hidden lg:grid grid-cols-[120px_90px_150px_1fr_150px_70px_140px] gap-2 px-4 py-2.5 border-b text-xs font-medium text-muted-foreground bg-muted/40">
          <span>Re-send #</span><span>Order #</span><span>Customer</span><span>Items</span>
          <span>Status</span><span className="text-right">Qty</span><span>Reason</span>
        </div>
        {isLoading ? (
          <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground text-sm">No re-sends found</div>
        ) : (
          <>
            {pageRows.map(r => (
              <button key={r.id} onClick={() => navigate(`/sales/resends/${r.id}`)}
                className="w-full text-left grid grid-cols-1 lg:grid-cols-[120px_90px_150px_1fr_150px_70px_140px] gap-2 px-4 py-3 border-b last:border-b-0 hover:bg-muted/40 items-center">
                <span className="font-mono text-xs">{r.resend_number}</span>
                <span className="text-sm">
                  {r.order_number
                    ? (r.sales_order_id
                        ? <Link to={`/sales/orders/${r.sales_order_id}`} onClick={e => e.stopPropagation()} className="text-primary hover:underline">{r.order_number}</Link>
                        : r.order_number)
                    : '—'}
                </span>
                <span className="text-sm truncate">{r.customer_name || '—'}</span>
                <span className="text-xs text-muted-foreground truncate">{r.skus || '—'}</span>
                <span><Badge className={`text-[10px] ${RESEND_STATUS_COLORS[r.status] || ''}`}>{RESEND_STATUS_LABELS[r.status] || r.status}</Badge></span>
                <span className="text-sm text-right">{r.qty}</span>
                <span className="text-xs text-muted-foreground truncate">{reasonLabel(r.reason)}</span>
              </button>
            ))}
            <TablePagination page={page} pageSize={pageSize} totalItems={filtered.length}
              onPageChange={setPage} onPageSizeChange={v => { setPageSize(v); setPage(0); }} />
          </>
        )}
      </div>

      {showNew && <NewResendModal onClose={() => setShowNew(false)} onCreated={id => navigate(`/sales/resends/${id}`)} />}
    </div>
  );
}

function NewResendModal({ onClose, onCreated }) {
  const [q, setQ] = useState('');
  const [creating, setCreating] = useState(false);

  const { data: matches = [], isFetching } = useQuery({
    queryKey: ['order-search-for-resend', q],
    queryFn: () => base44.entities.SalesOrder.filter({ order_number: { $ilike: q.trim() } }, '-order_date', 20),
    enabled: q.trim().length >= 2,
  });

  const pick = async (order) => {
    setCreating(true);
    try {
      const id = await createResendFromOrder(order.id);
      toast.success('Draft re-send created');
      onCreated(id);
    } catch (e) {
      toast.error(e.message || 'Could not create re-send');
      setCreating(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative z-10 w-full max-w-lg bg-card rounded-xl shadow-xl">
        <div className="flex items-center justify-between px-5 py-3 border-b">
          <h2 className="font-bold">New Re-send — find original order</h2>
          <Button variant="ghost" size="icon" onClick={onClose}><X className="w-5 h-5" /></Button>
        </div>
        <div className="p-5 space-y-3">
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="Type the Shopify order number..." className="pl-9" />
          </div>
          {creating ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-6 justify-center"><Loader2 className="w-4 h-4 animate-spin" /> Creating draft...</div>
          ) : q.trim().length < 2 ? (
            <p className="text-xs text-muted-foreground">Enter at least 2 characters of the order number.</p>
          ) : isFetching ? (
            <div className="flex justify-center py-6"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
          ) : matches.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">No orders match “{q}”.</p>
          ) : (
            <div className="border rounded-lg divide-y max-h-72 overflow-y-auto">
              {matches.map(o => (
                <button key={o.id} onClick={() => pick(o)} className="w-full text-left px-3 py-2 hover:bg-muted flex items-center justify-between">
                  <span>
                    <span className="font-medium text-sm">{o.order_number}</span>
                    <span className="text-xs text-muted-foreground ml-2">{o.customer_name || '—'}</span>
                  </span>
                  <span className="text-xs text-muted-foreground">{o.order_date ? new Date(o.order_date).toLocaleDateString('en-ZA') : ''}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
