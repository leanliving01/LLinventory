import React, { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { subDays, isWithinInterval, startOfDay } from 'date-fns';
import ReportDateFilter from './ReportDateFilter';
import { downloadCSV } from '@/lib/csvExport';
import { formatZAR } from '@/lib/utils';

export default function YieldEfficiencyReport() {
  const now = new Date();
  const [from, setFrom] = useState(subDays(now, 30));
  const [to, setTo] = useState(now);

  const { data: runs = [] } = useQuery({
    queryKey: ['report-production-runs'],
    queryFn: () => base44.entities.ProductionRun.list('-run_date', 500),
  });
  const { data: runLines = [] } = useQuery({
    queryKey: ['report-portioning-lines'],
    queryFn: () => base44.entities.PortioningRunLine.list('-created_date', 5000),
  });

  const rows = useMemo(() => {
    const inRange = runs.filter(r => r.run_date && isWithinInterval(new Date(r.run_date), { start: startOfDay(from), end: to }));
    return inRange.map(run => {
      const lines = runLines.filter(l => l.production_run_id === run.id || l.run_id === run.id);
      const plannedTotal = lines.reduce((s, l) => s + (l.planned_qty || 0), 0);
      const actualTotal = lines.reduce((s, l) => s + (l.actual_qty || l.meals_portioned || 0), 0);
      const variance = actualTotal - plannedTotal;
      const pct = plannedTotal > 0 ? (actualTotal / plannedTotal * 100).toFixed(1) : '—';
      return { run, plannedTotal, actualTotal, variance, pct };
    });
  }, [runs, runLines, from, to]);

  const totalPlanned = rows.reduce((s, r) => s + r.plannedTotal, 0);
  const totalActual = rows.reduce((s, r) => s + r.actualTotal, 0);
  const overallPct = totalPlanned > 0 ? (totalActual / totalPlanned * 100).toFixed(1) : '—';

  return (
    <div className="space-y-4">
      <ReportDateFilter from={from} to={to} onChange={(f, t) => { setFrom(f); setTo(t); }}
        onExportCSV={() => downloadCSV('yield_efficiency.csv', rows.map(r => ({
          run: r.run.run_number, date: r.run.run_date, planned: r.plannedTotal, actual: r.actualTotal, variance: r.variance, pct: r.pct,
        })))}
        onPrint={() => window.print()} />
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-card border border-border rounded-lg p-3"><p className="text-xs text-muted-foreground">Planned</p><p className="text-lg font-bold">{totalPlanned.toLocaleString()}</p></div>
        <div className="bg-card border border-border rounded-lg p-3"><p className="text-xs text-muted-foreground">Actual</p><p className="text-lg font-bold">{totalActual.toLocaleString()}</p></div>
        <div className="bg-card border border-border rounded-lg p-3"><p className="text-xs text-muted-foreground">Yield</p><p className={`text-lg font-bold ${parseFloat(overallPct) < 95 ? 'text-amber-600' : 'text-green-600'}`}>{overallPct}%</p></div>
      </div>
      <div className="bg-card rounded-xl border border-border overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-muted/50 border-b border-border">
              <th className="text-left px-4 py-2.5 text-[10px] font-semibold text-muted-foreground uppercase">Run</th>
              <th className="text-right px-4 py-2.5 text-[10px] font-semibold text-muted-foreground uppercase w-24">Planned</th>
              <th className="text-right px-4 py-2.5 text-[10px] font-semibold text-muted-foreground uppercase w-24">Actual</th>
              <th className="text-right px-4 py-2.5 text-[10px] font-semibold text-muted-foreground uppercase w-20">Variance</th>
              <th className="text-right px-4 py-2.5 text-[10px] font-semibold text-muted-foreground uppercase w-16">Yield</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((r, i) => (
              <tr key={i}>
                <td className="px-4 py-2.5">
                  <p className="text-xs font-medium">{r.run.run_number}</p>
                  <p className="text-[10px] text-muted-foreground">{r.run.run_date}</p>
                </td>
                <td className="px-4 py-2.5 text-right text-xs">{r.plannedTotal.toLocaleString()}</td>
                <td className="px-4 py-2.5 text-right text-xs">{r.actualTotal.toLocaleString()}</td>
                <td className={`px-4 py-2.5 text-right text-xs font-medium ${r.variance < 0 ? 'text-red-600' : r.variance > 0 ? 'text-green-600' : ''}`}>
                  {r.variance > 0 ? '+' : ''}{r.variance}
                </td>
                <td className={`px-4 py-2.5 text-right text-xs font-semibold ${parseFloat(r.pct) < 95 ? 'text-amber-600' : 'text-green-600'}`}>{r.pct}%</td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && <p className="px-4 py-6 text-sm text-muted-foreground text-center">No production runs in this period</p>}
      </div>
    </div>
  );
}
