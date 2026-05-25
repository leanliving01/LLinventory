import React, { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { subDays, isWithinInterval, startOfDay, differenceInMinutes } from 'date-fns';
import ReportDateFilter from './ReportDateFilter';
import { downloadCSV } from '@/lib/csvExport';

export default function StationThroughputReport() {
  const now = new Date();
  const [from, setFrom] = useState(subDays(now, 30));
  const [to, setTo] = useState(now);

  const { data: tasks = [] } = useQuery({
    queryKey: ['report-production-tasks'],
    queryFn: () => base44.entities.ProductionTask.list('-created_date', 2000),
  });

  const rows = useMemo(() => {
    const inRange = tasks.filter(t =>
      t.status === 'completed' &&
      t.started_at && t.completed_at &&
      isWithinInterval(new Date(t.created_date || t.started_at), { start: startOfDay(from), end: to })
    );
    const byStation = {};
    for (const t of inRange) {
      const station = t.station || 'Unknown';
      if (!byStation[station]) byStation[station] = { count: 0, totalMinutes: 0 };
      const mins = differenceInMinutes(new Date(t.completed_at), new Date(t.started_at));
      if (mins > 0) {
        byStation[station].count++;
        byStation[station].totalMinutes += mins;
      }
    }
    return Object.entries(byStation)
      .map(([station, data]) => ({
        station,
        count: data.count,
        avgMinutes: data.count > 0 ? Math.round(data.totalMinutes / data.count) : 0,
        totalHours: (data.totalMinutes / 60).toFixed(1),
      }))
      .sort((a, b) => b.count - a.count);
  }, [tasks, from, to]);

  return (
    <div className="space-y-4">
      <ReportDateFilter from={from} to={to} onChange={(f, t) => { setFrom(f); setTo(t); }}
        onExportCSV={() => downloadCSV('station_throughput.csv', rows.map(r => ({
          station: r.station, tasks: r.count, avg_minutes: r.avgMinutes, total_hours: r.totalHours,
        })))}
        onPrint={() => window.print()} />
      <div className="bg-card rounded-xl border border-border overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-muted/50 border-b border-border">
              <th className="text-left px-4 py-2.5 text-[10px] font-semibold text-muted-foreground uppercase">Station</th>
              <th className="text-right px-4 py-2.5 text-[10px] font-semibold text-muted-foreground uppercase w-24">Tasks Done</th>
              <th className="text-right px-4 py-2.5 text-[10px] font-semibold text-muted-foreground uppercase w-32">Avg Duration</th>
              <th className="text-right px-4 py-2.5 text-[10px] font-semibold text-muted-foreground uppercase w-28">Total Hours</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((r, i) => (
              <tr key={i}>
                <td className="px-4 py-2.5 text-xs font-medium">{r.station}</td>
                <td className="px-4 py-2.5 text-right text-xs">{r.count}</td>
                <td className="px-4 py-2.5 text-right text-xs">
                  {r.avgMinutes >= 60 ? `${Math.floor(r.avgMinutes / 60)}h ${r.avgMinutes % 60}m` : `${r.avgMinutes}m`}
                </td>
                <td className="px-4 py-2.5 text-right text-xs">{r.totalHours}h</td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && <p className="px-4 py-6 text-sm text-muted-foreground text-center">No completed tasks with timing data in this period</p>}
      </div>
    </div>
  );
}
