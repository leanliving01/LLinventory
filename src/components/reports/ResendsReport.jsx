import React, { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Badge } from '@/components/ui/badge';
import { format, subDays, isWithinInterval, startOfDay } from 'date-fns';
import ReportDateFilter from './ReportDateFilter';
import { downloadCSV } from '@/lib/csvExport';
import { formatZAR } from '@/lib/utils';

const STATUS_STYLES = {
  draft: 'bg-muted text-muted-foreground',
  pending_approval: 'bg-amber-100 text-amber-700',
  approved: 'bg-blue-100 text-blue-700',
  picked_packed: 'bg-purple-100 text-purple-700',
  sent: 'bg-green-100 text-green-700',
  cancelled: 'bg-red-100 text-red-700',
  completed: 'bg-emerald-100 text-emerald-700',
};

export default function ResendsReport() {
  const now = new Date();
  const [from, setFrom] = useState(subDays(now, 30));
  const [to, setTo] = useState(now);

  // sales_resends has no order_date/return_date — date by created_date (NOT -order_date,
  // which would error on .order() and silently return []).
  const { data: resends = [] } = useQuery({
    queryKey: ['report-resends', startOfDay(from).toISOString(), to.toISOString()],
    queryFn: () => base44.entities.SalesResend.filter(
      { created_date: { $gte: startOfDay(from).toISOString(), $lte: to.toISOString() } },
      '-created_date', 5000
    ),
  });

  const filtered = useMemo(() =>
    resends.filter(r => r.created_date && isWithinInterval(new Date(r.created_date), { start: startOfDay(from), end: to })),
    [resends, from, to]
  );

  // Scope lines to the in-range re-sends (not a global newest-N cap).
  const resendIds = useMemo(() => filtered.map(r => r.id), [filtered]);
  const { data: lines = [] } = useQuery({
    queryKey: ['report-resend-lines', resendIds],
    queryFn: () => resendIds.length
      ? base44.entities.SalesResendLine.filter({ resend_id: resendIds }, '-created_date', 20000)
      : Promise.resolve([]),
    enabled: resendIds.length > 0,
  });

  const valueByResend = useMemo(() => {
    const m = {};
    for (const l of lines) {
      m[l.resend_id] = (m[l.resend_id] || 0) + (l.qty || 0) * (l.unit_price || 0);
    }
    return m;
  }, [lines]);

  const totals = useMemo(() => {
    const byReason = {};
    let value = 0, deducted = 0;
    for (const r of filtered) {
      const reason = r.reason || 'unspecified';
      byReason[reason] = (byReason[reason] || 0) + 1;
      // Don't count value for cancelled re-sends — they never shipped.
      if (r.status !== 'cancelled') value += valueByResend[r.id] || 0;
      if (r.stock_deducted) deducted++;
    }
    return {
      count: filtered.length,
      value,
      deducted,
      sent: filtered.filter(r => ['sent', 'completed'].includes(r.status)).length,
      byReason: Object.entries(byReason).sort((a, b) => b[1] - a[1]),
    };
  }, [filtered, valueByResend]);

  const handleExport = () => {
    downloadCSV('resends_report.csv', filtered.map(r => ({
      resend_number: r.resend_number, order: r.order_number || r.shopify_order_id || '',
      customer: r.customer_name || '', reason: r.reason || '',
      created: r.created_date ? format(new Date(r.created_date), 'yyyy-MM-dd') : '',
      dispatch_date: r.dispatch_date || '', status: r.status,
      stock_deducted: r.stock_deducted ? 'yes' : 'no', value: (valueByResend[r.id] || 0).toFixed(2),
    })));
  };

  return (
    <div className="space-y-4">
      <ReportDateFilter from={from} to={to} onChange={(f, t) => { setFrom(f); setTo(t); }} onExportCSV={handleExport} onPrint={() => window.print()} />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <SumCard label="Re-sends" value={totals.count} />
        <SumCard label="Value Resent" value={formatZAR(totals.value)} accent />
        <SumCard label="Sent / Completed" value={totals.sent} />
        <SumCard label="Stock Deducted" value={totals.deducted} />
      </div>

      {totals.byReason.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {totals.byReason.map(([reason, n]) => (
            <Badge key={reason} variant="outline" className="text-[11px]">{reason.replace(/_/g, ' ')}: {n}</Badge>
          ))}
        </div>
      )}

      <div className="border border-border rounded-lg overflow-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-muted/50 border-b border-border">
              <th className="text-left px-4 py-2.5 text-[10px] font-semibold text-muted-foreground uppercase">Re-send</th>
              <th className="text-left px-4 py-2.5 text-[10px] font-semibold text-muted-foreground uppercase">Order</th>
              <th className="text-left px-4 py-2.5 text-[10px] font-semibold text-muted-foreground uppercase">Customer</th>
              <th className="text-left px-4 py-2.5 text-[10px] font-semibold text-muted-foreground uppercase">Reason</th>
              <th className="text-left px-4 py-2.5 text-[10px] font-semibold text-muted-foreground uppercase">Date</th>
              <th className="text-right px-4 py-2.5 text-[10px] font-semibold text-muted-foreground uppercase">Value</th>
              <th className="text-center px-4 py-2.5 text-[10px] font-semibold text-muted-foreground uppercase">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {filtered.length === 0 ? (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-muted-foreground text-sm">No re-sends in period</td></tr>
            ) : filtered.slice(0, 100).map(r => (
              <tr key={r.id} className="hover:bg-muted/30">
                <td className="px-4 py-2.5 font-medium font-mono text-xs">{r.resend_number}</td>
                <td className="px-4 py-2.5 text-muted-foreground text-xs">{r.order_number || r.shopify_order_id || '—'}</td>
                <td className="px-4 py-2.5 text-muted-foreground">{r.customer_name || '—'}</td>
                <td className="px-4 py-2.5 text-muted-foreground text-xs">{(r.reason || '—').replace(/_/g, ' ')}</td>
                <td className="px-4 py-2.5 text-muted-foreground">{r.created_date ? format(new Date(r.created_date), 'dd MMM yyyy') : '—'}</td>
                <td className="px-4 py-2.5 text-right">{formatZAR(valueByResend[r.id] || 0)}</td>
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
