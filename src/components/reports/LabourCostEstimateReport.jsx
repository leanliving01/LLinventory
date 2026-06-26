import React, { useState, useMemo, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { subDays, isWithinInterval, startOfDay } from 'date-fns';
import ReportDateFilter from './ReportDateFilter';
import { downloadCSV } from '@/lib/csvExport';
import { formatZAR } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { getTaskActiveDuration } from '@/lib/taskDuration';

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
  // Labour hours aren't stored on production_runs — derive them from actual task
  // active-durations (started_at→finished_at minus paused intervals from the logs).
  const { data: tasks = [] } = useQuery({
    queryKey: ['report-labour-tasks'],
    queryFn: () => base44.entities.ProductionTask.list('-created_date', 5000),
  });
  const { data: taskLogs = [] } = useQuery({
    queryKey: ['report-labour-task-logs'],
    queryFn: () => base44.entities.ProductionTaskLog.list('-timestamp', 10000),
  });
  const { data: settings = [] } = useQuery({
    queryKey: ['settings-labour'],
    queryFn: () => base44.entities.Setting.filter({ group: 'production', key: 'labour_rate_per_hour' }),
  });

  // TanStack Query v5 removed useQuery onSuccess — sync the configured rate via effect.
  useEffect(() => {
    const v = settings[0]?.value;
    if (v != null && v !== '' && !Number.isNaN(Number(v))) setLabourRate(Number(v));
  }, [settings]);

  const rows = useMemo(() => {
    // Group task active-duration (ms) by run_id.
    const logsByTask = {};
    for (const lg of taskLogs) {
      (logsByTask[lg.task_id] ||= []).push(lg);
    }
    // assigned_members is a JSON-encoded array; a task worked by N people costs N× the
    // wall-clock active duration in labour (person-hours). Fall back to 1.
    const memberCount = (t) => {
      try {
        const arr = t.assigned_members ? JSON.parse(t.assigned_members) : null;
        if (Array.isArray(arr) && arr.length > 0) return arr.length;
      } catch { /* not JSON — fall through */ }
      return 1;
    };
    const hoursByRun = {};
    for (const t of tasks) {
      const ms = getTaskActiveDuration(t, logsByTask[t.id] || []) * memberCount(t);
      if (ms > 0) hoursByRun[t.run_id] = (hoursByRun[t.run_id] || 0) + ms;
    }

    const inRange = runs.filter(r => r.run_date && isWithinInterval(new Date(r.run_date), { start: startOfDay(from), end: to }) && r.status === 'completed');
    return inRange.map(run => {
      const totalMeals = run.total_units || 0;
      const labourHours = (hoursByRun[run.id] || 0) / 3_600_000; // ms → hours
      const labourCost = labourHours * labourRate;
      const costPerMeal = totalMeals > 0 ? labourCost / totalMeals : 0;
      return { run, totalMeals, labourHours, labourCost, costPerMeal };
    });
  }, [runs, tasks, taskLogs, from, to, labourRate]);

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
        {rows.length === 0 && <p className="px-4 py-6 text-sm text-muted-foreground text-center">No completed production runs in this period. Labour hours are derived from recorded task start/finish times.</p>}
      </div>
    </div>
  );
}
