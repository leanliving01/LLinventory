import React, { useState, useMemo } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, Link, useSearchParams } from 'react-router-dom';
import { RotateCcw, Search, Download, Truck, AlertTriangle } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import TablePagination from '@/components/shared/TablePagination';
import { formatDateTimeSAST } from '@/lib/dateUtils';
import { usePersistentState, useScrollRestoration } from '@/lib/usePersistentState';
import {
  STATUS_LABELS, STATUS_COLORS, COURIER_LABELS,
  matchesTab, returnAggregates,
} from '@/lib/shopifyReturns';

const TABS = [
  { key: 'draft_return', label: 'Draft' },
  { key: 'not_receiving_stock_back', label: 'Not Receiving' },
  { key: 'expected_return', label: 'Expected' },
  { key: 'courier_to_be_booked', label: 'Courier To Book' },
  { key: 'courier_booked', label: 'Courier Booked' },
  { key: 'awaiting_receival', label: 'Awaiting Receival' },
  { key: 'received_pending_qc', label: 'Received / QC' },
  { key: 'qc_exceptions', label: 'QC Exceptions' },
  { key: 'awaiting_refund_decision', label: 'Awaiting Refund' },
  { key: 'written_off', label: 'Written Off' },
  { key: 'returned_to_stock', label: 'Returned to Stock' },
  { key: 'completed', label: 'Completed' },
  { key: 'all', label: 'All' },
];

export default function ShopifyReturns() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const queueParam = searchParams.get('queue');
  // View state persists for the session so returning from a return detail
  // restores the same tab/search/page. A deep-link ?queue= still overrides it.
  const [tab, setTab] = usePersistentState(
    'returns:tab',
    queueParam && TABS.some(t => t.key === queueParam) ? queueParam : 'draft_return',
  );
  // Follow the dashboard deep-link if the query param changes.
  React.useEffect(() => {
    if (queueParam && TABS.some(t => t.key === queueParam)) setTab(queueParam);
  }, [queueParam]);
  const [search, setSearch] = usePersistentState('returns:search', '');
  const [page, setPage] = useState(0); // reset to 0 on tab/search change (effect below)
  const [pageSize, setPageSize] = usePersistentState('returns:pageSize', 25);

  const { data: returns = [], isLoading } = useQuery({
    queryKey: ['shopify-returns'],
    queryFn: () => base44.entities.ShopifyReturn.list('-created_date', 5000),
    staleTime: 30000,
  });

  // Restore scroll position when returning from a return detail.
  useScrollRestoration('returns:scroll', !isLoading);
  const { data: lines = [] } = useQuery({
    queryKey: ['shopify-return-lines-all'],
    queryFn: () => base44.entities.ShopifyReturnLine.list('-created_date', 20000),
    staleTime: 30000,
  });

  const linesByReturn = useMemo(() => {
    const map = {};
    for (const l of lines) (map[l.return_id] ||= []).push(l);
    return map;
  }, [lines]);

  const rows = useMemo(() => {
    return returns.map(r => ({ ...r, agg: returnAggregates(linesByReturn[r.id] || []) }));
  }, [returns, linesByReturn]);

  const tabCounts = useMemo(() => {
    const c = {};
    for (const t of TABS) c[t.key] = rows.filter(r => matchesTab(r, t.key)).length;
    return c;
  }, [rows]);

  const filtered = useMemo(() => {
    let list = rows.filter(r => matchesTab(r, tab));
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(r =>
        (r.order_number || '').toLowerCase().includes(q) ||
        (r.customer_name || '').toLowerCase().includes(q) ||
        (r.return_number || '').toLowerCase().includes(q) ||
        (r.status || '').toLowerCase().includes(q) ||
        (r.agg.skus || '').toLowerCase().includes(q)
      );
    }
    return list;
  }, [rows, tab, search]);

  React.useEffect(() => { setPage(0); }, [tab, search]);

  const kpis = useMemo(() => {
    const totalValue = rows.reduce((s, r) => s + (r.total_return_value || 0), 0);
    const writeOffValue = rows.reduce((s, r) => s + (r.total_write_off_value || 0), 0);
    const expectedOutstanding = rows.filter(r => r.status === 'expected_return').length;
    const courierToBook = rows.filter(r => matchesTab(r, 'courier_to_be_booked')).length;
    const notReceiving = rows.filter(r => r.status === 'not_receiving_stock_back').length;
    return { count: rows.length, totalValue, writeOffValue, expectedOutstanding, courierToBook, notReceiving };
  }, [rows]);

  const exportCsv = () => {
    const header = ['Return #', 'Order #', 'Customer', 'Return Date', 'Status', 'Courier Resp', 'Courier Status', 'SKUs', 'Qty Returned', 'Qty Received', 'Qty To Stock', 'Qty Written Off', 'Return Value', 'Write-Off Value', 'Reason'];
    const lineRows = filtered.map(r => [
      r.return_number, r.order_number || '', r.customer_name || '',
      r.return_date ? new Date(r.return_date).toISOString().slice(0, 10) : '',
      STATUS_LABELS[r.status] || r.status,
      r.courier_responsibility || '', r.courier_status || '',
      r.agg.skus, r.agg.qtyReturned, r.agg.qtyReceived, r.agg.qtyToStock, r.agg.qtyWrittenOff,
      (r.total_return_value || 0).toFixed(2), (r.total_write_off_value || 0).toFixed(2),
      r.shopify_reason || '',
    ]);
    const csv = [header, ...lineRows].map(row => row.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `returns-${tab}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click(); URL.revokeObjectURL(url);
  };

  const pageRows = filtered.slice(page * pageSize, (page + 1) * pageSize);

  return (
    <div className="p-4 md:p-6 space-y-5 max-w-[1500px] mx-auto">
      <div className="flex items-center gap-3">
        <RotateCcw className="w-6 h-6 text-primary" />
        <h1 className="text-2xl font-bold">Customer Returns</h1>
        <span className="text-sm text-muted-foreground ml-auto">{filtered.length} shown</span>
        <button onClick={exportCsv} className="inline-flex items-center gap-1.5 text-sm border rounded-md px-3 py-1.5 hover:bg-muted">
          <Download className="w-4 h-4" /> CSV
        </button>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
        <KpiCard label="Total Returns" value={kpis.count} />
        <KpiCard label="Return Value" value={`R ${kpis.totalValue.toLocaleString('en-ZA', { minimumFractionDigits: 2 })}`} />
        <KpiCard label="Write-Off Value" value={`R ${kpis.writeOffValue.toLocaleString('en-ZA', { minimumFractionDigits: 2 })}`} />
        <KpiCard label="Expected Outstanding" value={kpis.expectedOutstanding} />
        <KpiCard label="Courier To Book" value={kpis.courierToBook} icon={kpis.courierToBook > 0 ? AlertTriangle : Truck} highlight={kpis.courierToBook > 0} />
        <KpiCard label="Not Receiving" value={kpis.notReceiving} />
      </div>

      {/* Tabs */}
      <div className="flex flex-wrap gap-1.5">
        {TABS.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${tab === t.key ? 'bg-primary text-primary-foreground border-primary' : 'bg-card hover:bg-muted'}`}
          >
            {t.label} <span className="opacity-60">{tabCounts[t.key] ?? 0}</span>
          </button>
        ))}
      </div>

      {/* Search */}
      <div className="relative max-w-sm">
        <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Order #, customer, SKU, status..." className="pl-9" />
      </div>

      {/* Table */}
      <div className="bg-card rounded-xl border overflow-hidden">
        <div className="hidden lg:grid grid-cols-[110px_90px_140px_1fr_150px_120px_90px_90px_110px] gap-2 px-4 py-2.5 border-b text-xs font-medium text-muted-foreground bg-muted/40">
          <span>Return #</span><span>Order #</span><span>Customer</span><span>Items</span>
          <span>Status</span><span>Courier</span><span className="text-right">Returned</span>
          <span className="text-right">To Stock</span><span className="text-right">Value</span>
        </div>

        {isLoading ? (
          <div className="flex justify-center py-12"><div className="w-6 h-6 border-2 border-muted border-t-primary rounded-full animate-spin" /></div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground text-sm">No returns found</div>
        ) : (
          <>
            {pageRows.map(r => (
              <button
                key={r.id}
                onClick={() => navigate(`/sales/returns/${r.id}`)}
                className="w-full text-left grid grid-cols-1 lg:grid-cols-[110px_90px_140px_1fr_150px_120px_90px_90px_110px] gap-2 px-4 py-3 border-b last:border-b-0 hover:bg-muted/40 items-center"
              >
                <span className="font-mono text-xs">{r.return_number}</span>
                <span className="text-sm">
                  {r.order_number
                    ? (r.sales_order_id
                        ? <Link to={`/sales/orders/${r.sales_order_id}`} onClick={e => e.stopPropagation()} className="text-primary hover:underline">{r.order_number}</Link>
                        : r.order_number)
                    : '—'}
                </span>
                <span className="text-sm truncate">{r.customer_name || '—'}</span>
                <span className="text-xs text-muted-foreground truncate">{r.agg.skus || '—'}</span>
                <span><Badge className={`text-[10px] ${STATUS_COLORS[r.status] || ''}`}>{STATUS_LABELS[r.status] || r.status}</Badge></span>
                <span className="text-xs text-muted-foreground">
                  {r.courier_responsibility ? `${r.courier_responsibility === 'us' ? 'We book' : 'Customer'}${r.courier_status ? ` · ${COURIER_LABELS[r.courier_status]}` : ''}` : '—'}
                </span>
                <span className="text-sm text-right">{r.agg.qtyReturned}</span>
                <span className="text-sm text-right text-emerald-600">{r.agg.qtyToStock || ''}</span>
                <span className="text-sm text-right font-medium">R {(r.total_return_value || 0).toFixed(2)}</span>
              </button>
            ))}
            <TablePagination
              page={page}
              pageSize={pageSize}
              totalItems={filtered.length}
              onPageChange={setPage}
              onPageSizeChange={v => { setPageSize(v); setPage(0); }}
            />
          </>
        )}
      </div>
    </div>
  );
}

function KpiCard({ label, value, icon: Icon, highlight }) {
  return (
    <div className={`rounded-xl border p-3 ${highlight ? 'border-amber-300 bg-amber-50' : 'bg-card'}`}>
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        {Icon && <Icon className={`w-3.5 h-3.5 ${highlight ? 'text-amber-600' : ''}`} />}
        {label}
      </div>
      <div className="text-lg font-bold mt-0.5">{value}</div>
    </div>
  );
}
