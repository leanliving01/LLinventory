import React, { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Badge } from '@/components/ui/badge';
import { format, subDays, isWithinInterval, startOfDay } from 'date-fns';
import ReportDateFilter from './ReportDateFilter';
import { downloadCSV } from '@/lib/csvExport';
import { formatZAR } from '@/lib/utils';

const STATUS_STYLES = {
  draft_return: 'bg-muted text-muted-foreground',
  not_receiving_stock_back: 'bg-slate-100 text-slate-700',
  expected_return: 'bg-blue-100 text-blue-700',
  partially_received: 'bg-amber-100 text-amber-700',
  received_pending_qc: 'bg-amber-100 text-amber-700',
  returned_to_stock: 'bg-green-100 text-green-700',
  written_off: 'bg-red-100 text-red-700',
  partially_returned_partially_written_off: 'bg-orange-100 text-orange-700',
  completed: 'bg-emerald-100 text-emerald-700',
};

export default function ReturnsReport() {
  const now = new Date();
  const [from, setFrom] = useState(subDays(now, 30));
  const [to, setTo] = useState(now);

  // Returns are dated by return_date (the business date), not created_date.
  const { data: returns = [] } = useQuery({
    queryKey: ['report-returns', startOfDay(from).toISOString(), to.toISOString()],
    queryFn: () => base44.entities.ShopifyReturn.filter(
      { return_date: { $gte: startOfDay(from).toISOString(), $lte: to.toISOString() } },
      '-return_date', 5000
    ),
  });

  const filtered = useMemo(() =>
    returns.filter(r => r.return_date && isWithinInterval(new Date(r.return_date), { start: startOfDay(from), end: to })),
    [returns, from, to]
  );

  // Scope lines to the in-range returns (not a global newest-N cap, which could miss lines).
  const returnIds = useMemo(() => filtered.map(r => r.id), [filtered]);
  const { data: lines = [] } = useQuery({
    queryKey: ['report-return-lines', returnIds],
    queryFn: () => returnIds.length
      ? base44.entities.ShopifyReturnLine.filter({ return_id: returnIds }, '-created_date', 20000)
      : Promise.resolve([]),
    enabled: returnIds.length > 0,
  });

  const totals = useMemo(() => {
    const ids = new Set(filtered.map(r => r.id));
    const inLines = lines.filter(l => ids.has(l.return_id));
    return {
      count: filtered.length,
      returnValue: filtered.reduce((s, r) => s + (r.total_return_value || 0), 0),
      writeOffValue: filtered.reduce((s, r) => s + (r.total_write_off_value || 0), 0),
      // Refunds only count once the refund is actually paid.
      refunded: filtered.filter(r => r.refund_status === 'paid').reduce((s, r) => s + (r.refund_amount || 0), 0),
      qtyToStock: inLines.reduce((s, l) => s + (l.qty_to_stock || 0), 0),
      qtyWrittenOff: inLines.reduce((s, l) => s + (l.qty_written_off || 0), 0),
    };
  }, [filtered, lines]);

  const handleExport = () => {
    downloadCSV('returns_report.csv', filtered.map(r => ({
      return_number: r.return_number, order: r.order_number || r.shopify_order_id || '',
      customer: r.customer_name || '', source: r.source,
      date: r.return_date ? format(new Date(r.return_date), 'yyyy-MM-dd') : '',
      status: r.status, return_value: r.total_return_value, write_off_value: r.total_write_off_value,
      refund_amount: r.refund_amount, refund_status: r.refund_status || '',
    })));
  };

  return (
    <div className="space-y-4">
      <ReportDateFilter from={from} to={to} onChange={(f, t) => { setFrom(f); setTo(t); }} onExportCSV={handleExport} onPrint={() => window.print()} />

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <SumCard label="Returns" value={totals.count} />
        <SumCard label="Return Value" value={formatZAR(totals.returnValue)} />
        <SumCard label="Refunded (paid)" value={formatZAR(totals.refunded)} accent />
        <SumCard label="Written Off" value={formatZAR(totals.writeOffValue)} />
        <SumCard label="Qty Restocked" value={totals.qtyToStock.toLocaleString()} />
        <SumCard label="Qty Written Off" value={totals.qtyWrittenOff.toLocaleString()} />
      </div>

      <div className="border border-border rounded-lg overflow-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-muted/50 border-b border-border">
              <th className="text-left px-4 py-2.5 text-[10px] font-semibold text-muted-foreground uppercase">Return</th>
              <th className="text-left px-4 py-2.5 text-[10px] font-semibold text-muted-foreground uppercase">Order</th>
              <th className="text-left px-4 py-2.5 text-[10px] font-semibold text-muted-foreground uppercase">Customer</th>
              <th className="text-left px-4 py-2.5 text-[10px] font-semibold text-muted-foreground uppercase">Date</th>
              <th className="text-right px-4 py-2.5 text-[10px] font-semibold text-muted-foreground uppercase">Return Value</th>
              <th className="text-right px-4 py-2.5 text-[10px] font-semibold text-muted-foreground uppercase">Refund</th>
              <th className="text-center px-4 py-2.5 text-[10px] font-semibold text-muted-foreground uppercase">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {filtered.length === 0 ? (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-muted-foreground text-sm">No returns in period</td></tr>
            ) : filtered.slice(0, 100).map(r => (
              <tr key={r.id} className="hover:bg-muted/30">
                <td className="px-4 py-2.5 font-medium font-mono text-xs">{r.return_number}</td>
                <td className="px-4 py-2.5 text-muted-foreground text-xs">{r.order_number || r.shopify_order_id || '—'}</td>
                <td className="px-4 py-2.5 text-muted-foreground">{r.customer_name || '—'}</td>
                <td className="px-4 py-2.5 text-muted-foreground">{r.return_date ? format(new Date(r.return_date), 'dd MMM yyyy') : '—'}</td>
                <td className="px-4 py-2.5 text-right">{formatZAR(r.total_return_value || 0)}</td>
                <td className="px-4 py-2.5 text-right">
                  {formatZAR(r.refund_amount || 0)}
                  {r.refund_status && <span className="block text-[10px] text-muted-foreground">{r.refund_status}</span>}
                </td>
                <td className="px-4 py-2.5 text-center">
                  <Badge className={`text-[10px] ${STATUS_STYLES[r.status] || ''}`}>{(r.status || '').replace(/_/g, ' ')}</Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length > 100 && <p className="text-xs text-muted-foreground text-center py-2">Showing 100 of {filtered.length} — export CSV for full data</p>}
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
