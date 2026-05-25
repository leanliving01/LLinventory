import React, { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { subDays, isWithinInterval, startOfDay } from 'date-fns';
import ReportDateFilter from './ReportDateFilter';
import { downloadCSV } from '@/lib/csvExport';
import { formatZAR } from '@/lib/utils';
import { Input } from '@/components/ui/input';

const DEFAULT_LABOUR_RATE = 180; // R/hour

export default function LabourCostEstimateReport() {
  const now = new Date();
  const [from, setFrom] = useState(subDays(now, 30));
  const [to, setTo] = useState(now);
  const [labourRate, setLabourRate] = useState(DEFAULT_LABOUR_RATE);

  const { data: runs = [] } = useQuery({
    queryKey: ['report-production-runs'],
    queryFn: () => base44.entities.ProductionRun.list('-run_date', 500),
  });
  const { data: settings = [] } = useQuery({
    queryKey: ['settings-labour'],
    queryFn: () => base44.entities.Setting.filter({ group: 'production', key: 'labour_rate_per_hour' }),
    onSuccess: (data) => { if (data[0]?.value) setLabourRate(Number(data[0].value)); },
  });

  const rows = useMemo(() => {
    const inRange = runs.filter(r => r.run_date && isWithinInterval(new Date(r.run_date), { start: startOfDay(from), end: to }) && r.status === 'completed');
    return inRange.map(run => {
      const totalMeals = run.total_meals_portioned || run.total_portioned || 0;
      const labourHours = run.labour_hours || run.total_labour_hours || 0;
      const labourCost = labourHours * labourRate;
      const costPerMeal = totalMeals > 0 ? labourCost / totalMeals : 0;
      return { run, totalMeals, labourHours, labourCost, costPerMeal };
    });
  }, [runs, from, to, labourRate]);

  const totals = useMemo(() => ({
    meals: rows.reduce((s, r) => s + r.totalMeals, 0),
    hours: rows.reduce((s, r) => s + r.labourHours, 0),
    cost: rows.reduce((s, r) => s + r.labourCost, 0),
  }), [rows]);

  const avgCostPerMeal = totals.meals > 0 ? totals.cost / totals.meals : 0;

  return (
    <div className="space-y-4">
      <ReportDateFilter from={from} to={to} onChange={(f, t) => { setFrom(f); setTo(t); }}
        onExportCSV={() => downloadCSV('labour_cost.csv', rows.map(r => ({
          run: r.run.run_number, date: r.run.run_date, meals: r.totalMeals,
          hours: r.labourHours, cost: r.labourCost.toFixed(2), per_meal: r.costPerMeal.toFixed(2),
        })))}
        onPrint={() => window.print()} />

      <div className="flex items-center gap-3">
        <label className="text-xs font-semibold text-muted-foreground whitespace-nowrap">Labour rate (R/hr)</label>
        <Input type="number" value={labourRate} onChange={e => setLabourRate(Number(e.target.value))} className="w-28 h-8 text-xs" min="0" step="10" />
      </div>

      <div className="grid grid-cols-4 gap-3">
        <div className="bg-card border border-border rounded-lg p-3"><p className="text-xs text-muted-foreground">Runs</p><p className="text-lg font-bold">{rows.length}</p></div>
        <div className="bg-card border border-border rounded-lg p-3"><p className="text-xs text-muted-foreground">Meals</p><p className="text-lg font-bold">{totals.meals.toLocaleString()}</p></div>
        <div className="bg-card border border-border rounded-lg p-3"><p className="text-xs text-muted-foreground">Labour Cost</p><p className="text-lg font-bold">{formatZAR(totals.cost)}</p></div>
        <div className="bg-card border border-border rounded-lg p-3"><p className="text-xs text-muted-foreground">Cost / Meal</p><p className="text-lg font-bold">{formatZAR(avgCostPerMeal)}</p></div>
      </div>

      <div className="bg-card rounded-xl border border-border overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-muted/50 border-b border-border">
              <th className="text-left px-4 py-2.5 text-[10px] font-semibold text-muted-foreground uppercase">Run</th>
              <th className="text-right px-4 py-2.5 text-[10px] font-semibold text-muted-foreground uppercase w-24">Meals</th>
              <th className="text-right px-4 py-2.5 text-[10px] font-semibold text-muted-foreground uppercase w-24">Hours</th>
              <th className="text-right px-4 py-2.5 text-[10px] font-semibold text-muted-foreground uppercase w-28">Labour Cost</th>
              <th className="text-right px-4 py-2.5 text-[10px] font-semibold text-muted-foreground uppercase w-28">Per Meal</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((r, i) => (
              <tr key={i}>
                <td className="px-4 py-2.5">
                  <p className="text-xs font-medium">{r.run.run_number}</p>
                  <p className="text-[10px] text-muted-foreground">{r.run.run_date}</p>
                </td>
                <td className="px-4 py-2.5 text-right text-xs">{r.totalMeals.toLocaleString()}</td>
                <td className="px-4 py-2.5 text-right text-xs">{r.labourHours.toFixed(1)}h</td>
                <td className="px-4 py-2.5 text-right text-xs font-medium">{formatZAR(r.labourCost)}</td>
                <td className="px-4 py-2.5 text-right text-xs font-medium">{formatZAR(r.costPerMeal)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && <p className="px-4 py-6 text-sm text-muted-foreground text-center">No completed runs with labour data in this period. Ensure runs have labour_hours recorded.</p>}
      </div>
    </div>
  );
}
