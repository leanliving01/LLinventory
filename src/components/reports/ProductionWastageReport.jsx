import React, { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Badge } from '@/components/ui/badge';
import { format, subDays, isWithinInterval, startOfDay } from 'date-fns';
import ReportDateFilter from './ReportDateFilter';
import { downloadCSV } from '@/lib/csvExport';
import { formatZAR } from '@/lib/utils';

const REASON_LABELS = {
  burned_overcooked: 'Burned / overcooked',
  undercooked_food_safety: 'Undercooked (food safety)',
  contaminated: 'Contaminated',
  equipment_failure: 'Equipment failure',
  handling_dropping: 'Handling / dropping',
  other: 'Other',
};

const REVIEW_STYLES = {
  pending: 'bg-amber-100 text-amber-700',
  approved: 'bg-green-100 text-green-700',
  rejected: 'bg-red-100 text-red-700',
  flagged: 'bg-orange-100 text-orange-700',
};

export default function ProductionWastageReport() {
  const now = new Date();
  const [from, setFrom] = useState(subDays(now, 30));
  const [to, setTo] = useState(now);

  const { data: events = [] } = useQuery({
    queryKey: ['report-prod-wastage', startOfDay(from).toISOString(), to.toISOString()],
    queryFn: () => base44.entities.ProductionWastageEvent.filter(
      { created_date: { $gte: startOfDay(from).toISOString(), $lte: to.toISOString() } },
      '-created_date', 5000
    ),
  });

  const filtered = useMemo(() =>
    events.filter(e => e.created_date && isWithinInterval(new Date(e.created_date), { start: startOfDay(from), end: to })),
    [events, from, to]
  );

  const totals = useMemo(() => {
    const byReason = {};
    let kg = 0, cost = 0;
    for (const e of filtered) {
      const r = e.reason_code || 'other';
      byReason[r] = (byReason[r] || 0) + (e.total_cost || 0);
      kg += e.qty_kg || 0;
      cost += e.total_cost || 0;
    }
    return { count: filtered.length, kg, cost, byReason: Object.entries(byReason).sort((a, b) => b[1] - a[1]) };
  }, [filtered]);

  const handleExport = () => {
    downloadCSV('production_wastage.csv', filtered.map(e => ({
      cooking_run: e.cooking_run_number || '', product: e.bulk_product_name || '',
      qty_kg: e.qty_kg, reason: REASON_LABELS[e.reason_code] || e.reason_code,
      total_cost: e.total_cost, review_status: e.review_status,
      recorded_by: e.recorded_by_name || '',
      date: e.created_date ? format(new Date(e.created_date), 'yyyy-MM-dd') : '',
    })));
  };

  return (
    <div className="space-y-4">
      <ReportDateFilter from={from} to={to} onChange={(f, t) => { setFrom(f); setTo(t); }} onExportCSV={handleExport} onPrint={() => window.print()} />

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <SumCard label="Events" value={totals.count} />
        <SumCard label="Total Kg Wasted" value={`${totals.kg.toFixed(1)} kg`} />
        <SumCard label="Total Cost" value={formatZAR(totals.cost)} accent />
      </div>

      {totals.byReason.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {totals.byReason.map(([reason, val]) => (
            <Badge key={reason} variant="outline" className="text-[11px]">{REASON_LABELS[reason] || reason}: {formatZAR(val)}</Badge>
          ))}
        </div>
      )}

      <div className="border border-border rounded-lg overflow-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-muted/50 border-b border-border">
              <th className="text-left px-4 py-2.5 text-[10px] font-semibold text-muted-foreground uppercase">Cooking Run</th>
              <th className="text-left px-4 py-2.5 text-[10px] font-semibold text-muted-foreground uppercase">Product</th>
              <th className="text-left px-4 py-2.5 text-[10px] font-semibold text-muted-foreground uppercase">Reason</th>
              <th className="text-left px-4 py-2.5 text-[10px] font-semibold text-muted-foreground uppercase">Date</th>
              <th className="text-right px-4 py-2.5 text-[10px] font-semibold text-muted-foreground uppercase">Qty</th>
              <th className="text-right px-4 py-2.5 text-[10px] font-semibold text-muted-foreground uppercase">Cost</th>
              <th className="text-center px-4 py-2.5 text-[10px] font-semibold text-muted-foreground uppercase">Review</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {filtered.length === 0 ? (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-muted-foreground text-sm">No production wastage in period</td></tr>
            ) : filtered.slice(0, 100).map(e => (
              <tr key={e.id} className="hover:bg-muted/30">
                <td className="px-4 py-2.5 font-mono text-xs">{e.cooking_run_number || '—'}</td>
                <td className="px-4 py-2.5">{e.bulk_product_name || '—'}</td>
                <td className="px-4 py-2.5 text-muted-foreground text-xs">{REASON_LABELS[e.reason_code] || e.reason_code}</td>
                <td className="px-4 py-2.5 text-muted-foreground">{e.created_date ? format(new Date(e.created_date), 'dd MMM yyyy') : '—'}</td>
                <td className="px-4 py-2.5 text-right">{(e.qty_kg || 0).toFixed(2)} kg</td>
                <td className="px-4 py-2.5 text-right font-medium">{formatZAR(e.total_cost || 0)}</td>
                <td className="px-4 py-2.5 text-center">
                  <Badge className={`text-[10px] ${REVIEW_STYLES[e.review_status] || ''}`}>{e.review_status || '—'}</Badge>
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
