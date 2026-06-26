import React, { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Badge } from '@/components/ui/badge';
import { format, subDays, isWithinInterval, startOfDay } from 'date-fns';
import ReportDateFilter from './ReportDateFilter';
import { downloadCSV } from '@/lib/csvExport';

const STATUS_STYLES = {
  pending: 'bg-muted text-muted-foreground',
  picking: 'bg-blue-100 text-blue-700',
  packed: 'bg-purple-100 text-purple-700',
  shipped: 'bg-green-100 text-green-700',
  cancelled: 'bg-red-100 text-red-700',
  refunded: 'bg-red-100 text-red-700',
};

export default function SalesReport() {
  const now = new Date();
  const [from, setFrom] = useState(subDays(now, 30));
  const [to, setTo] = useState(now);

  // Push the date range into the query so we don't silently cap at the newest 1000
  // orders (a busy Shopify store exceeds that fast, hiding older in-range orders).
  const { data: orders = [] } = useQuery({
    queryKey: ['report-sales', startOfDay(from).toISOString(), to.toISOString()],
    queryFn: () => base44.entities.SalesOrder.filter(
      { order_date: { $gte: startOfDay(from).toISOString(), $lte: to.toISOString() } },
      '-order_date', 5000
    ),
  });

  const filtered = useMemo(() =>
    orders.filter(o => o.order_date && isWithinInterval(new Date(o.order_date), { start: startOfDay(from), end: to })),
    [orders, from, to]
  );

  // Exclude cancelled/refunded by EITHER the workflow status or the Shopify lifecycle_state —
  // synced orders often carry that state only on lifecycle_state, not status.
  const isVoided = (o) =>
    ['cancelled', 'refunded'].includes(o.status) ||
    ['cancelled', 'refunded'].includes(o.lifecycle_state);

  const totals = useMemo(() => {
    const valid = filtered.filter(o => !isVoided(o));
    return {
      count: filtered.length,
      revenue: valid.reduce((s, o) => s + (o.total_amount || 0), 0),
      fulfilled: filtered.filter(o => o.fulfillment_status === 'fulfilled').length,
      unfulfilled: filtered.filter(o => o.fulfillment_status === 'unfulfilled' && o.payment_status === 'paid').length,
    };
  }, [filtered]);

  const orderRef = (o) => o.order_number || o.internal_order_number || o.shopify_order_id || '—';

  const handleExport = () => {
    downloadCSV('sales_report.csv', filtered.map(o => ({
      order_id: orderRef(o), source: o.order_source || 'shopify', customer: o.customer_name, status: o.status,
      date: o.order_date ? format(new Date(o.order_date), 'yyyy-MM-dd') : '',
      total: o.total_amount, payment: o.payment_status, fulfillment: o.fulfillment_status,
    })));
  };

  return (
    <div className="space-y-4">
      <ReportDateFilter from={from} to={to} onChange={(f, t) => { setFrom(f); setTo(t); }} onExportCSV={handleExport} onPrint={() => window.print()} />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <SumCard label="Orders" value={totals.count} />
        <SumCard label="Revenue (incl VAT)" value={`R ${totals.revenue.toLocaleString()}`} accent />
        <SumCard label="Fulfilled" value={totals.fulfilled} />
        <SumCard label="Unfulfilled" value={totals.unfulfilled} />
      </div>

      <div className="border border-border rounded-lg overflow-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-muted/50 border-b border-border">
              <th className="text-left px-4 py-2.5 text-[10px] font-semibold text-muted-foreground uppercase">Order</th>
              <th className="text-left px-4 py-2.5 text-[10px] font-semibold text-muted-foreground uppercase">Customer</th>
              <th className="text-left px-4 py-2.5 text-[10px] font-semibold text-muted-foreground uppercase">Date</th>
              <th className="text-right px-4 py-2.5 text-[10px] font-semibold text-muted-foreground uppercase">Total</th>
              <th className="text-center px-4 py-2.5 text-[10px] font-semibold text-muted-foreground uppercase">Status</th>
              <th className="text-center px-4 py-2.5 text-[10px] font-semibold text-muted-foreground uppercase">Fulfilment</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {filtered.length === 0 ? (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-muted-foreground text-sm">No sales orders in period</td></tr>
            ) : filtered.slice(0, 50).map(o => (
              <tr key={o.id} className="hover:bg-muted/30">
                <td className="px-4 py-2.5 font-medium">{orderRef(o)}</td>
                <td className="px-4 py-2.5 text-muted-foreground">{o.customer_name || '—'}</td>
                <td className="px-4 py-2.5 text-muted-foreground">{o.order_date ? format(new Date(o.order_date), 'dd MMM yyyy') : '—'}</td>
                <td className="px-4 py-2.5 text-right font-medium">R {(o.total_amount || 0).toLocaleString()}</td>
                <td className="px-4 py-2.5 text-center">
                  <Badge className={`text-[10px] ${STATUS_STYLES[o.status] || ''}`}>{o.status || '—'}</Badge>
                </td>
                <td className="px-4 py-2.5 text-center">
                  <Badge variant="outline" className="text-[10px]">{o.fulfillment_status || '—'}</Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length > 50 && <p className="text-xs text-muted-foreground text-center py-2">Showing 50 of {filtered.length} — export CSV for full data</p>}
      </div>
    </div>
  );
}

function SumCard({ label, value, accent }) {
  return (
    <div className={`rounded-lg px-4 py-3 ${accent ? 'bg-primary/10 border border-primary/20' : 'bg-muted/50 border border-border'}`}>
      <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">{label}</p>
      <p className={`text-lg font-bold mt-0.5 ${accent ? 'text-primary' : 'text-foreground'}`}>{value}</p>
    </div>
  );
}