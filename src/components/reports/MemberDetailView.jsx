import React, { useMemo } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ArrowLeft, Clock, CheckCircle2, Zap, Timer, TrendingDown } from 'lucide-react';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import { getTaskActiveDuration, formatDurationShort, formatDurationLong } from '@/lib/taskDuration';
import DateRangeFilter from '@/components/reports/DateRangeFilter';

const STATION_COLORS = {
  prep: 'bg-blue-100 text-blue-700',
  cook: 'bg-amber-100 text-amber-700',
  portion: 'bg-green-100 text-green-700',
};

export default function MemberDetailView({ member, tasks, allTasks, logsByTask, dateRange, onDateRangeChange, onBack }) {
  const memberTasks = useMemo(() => {
    return tasks
      .filter(t => t.assigned_to === member.id && t.status === 'done' && t.started_at && t.finished_at)
      .map(t => ({
        ...t,
        activeDuration: getTaskActiveDuration(t, logsByTask[t.id] || []),
      }))
      .sort((a, b) => new Date(b.finished_at) - new Date(a.finished_at));
  }, [tasks, member.id, logsByTask]);

  // All-time stats for comparison
  const allTimeTasks = useMemo(() => {
    return allTasks
      .filter(t => t.assigned_to === member.id && t.status === 'done' && t.started_at && t.finished_at)
      .map(t => ({ ...t, activeDuration: getTaskActiveDuration(t, logsByTask[t.id] || []) }));
  }, [allTasks, member.id, logsByTask]);

  // Team average for the same period
  const teamAvg = useMemo(() => {
    const teamTasks = tasks.filter(t => t.status === 'done' && t.started_at && t.finished_at);
    if (teamTasks.length === 0) return 0;
    const total = teamTasks.reduce((s, t) => s + getTaskActiveDuration(t, logsByTask[t.id] || []), 0);
    return total / teamTasks.length;
  }, [tasks, logsByTask]);

  const durations = memberTasks.map(t => t.activeDuration);
  const totalTime = durations.reduce((s, d) => s + d, 0);
  const avgTime = durations.length > 0 ? totalTime / durations.length : 0;
  const minTime = durations.length > 0 ? Math.min(...durations) : 0;
  const maxTime = durations.length > 0 ? Math.max(...durations) : 0;

  // All-time average for comparison
  const allTimeAvg = allTimeTasks.length > 0
    ? allTimeTasks.reduce((s, t) => s + t.activeDuration, 0) / allTimeTasks.length
    : 0;

  // Station breakdown
  const stationBreakdown = useMemo(() => {
    const breakdown = {};
    memberTasks.forEach(t => {
      if (!breakdown[t.station]) breakdown[t.station] = { count: 0, totalMs: 0 };
      breakdown[t.station].count += 1;
      breakdown[t.station].totalMs += t.activeDuration;
    });
    return breakdown;
  }, [memberTasks]);

  const statCards = [
    { label: 'Tasks Completed', value: memberTasks.length, icon: CheckCircle2, color: 'text-green-600 bg-green-50' },
    { label: 'Total Working Time', value: formatDurationShort(totalTime), icon: Timer, color: 'text-blue-600 bg-blue-50' },
    { label: 'Average Task Time', value: formatDurationShort(avgTime), icon: Clock, color: 'text-amber-600 bg-amber-50', sub: teamAvg > 0 ? `Team avg: ${formatDurationShort(teamAvg)}` : null },
    { label: 'Fastest Task', value: formatDurationShort(minTime), icon: Zap, color: 'text-green-600 bg-green-50' },
    { label: 'Slowest Task', value: formatDurationShort(maxTime), icon: TrendingDown, color: 'text-red-600 bg-red-50' },
    { label: 'All-Time Avg', value: formatDurationShort(allTimeAvg), icon: Clock, color: 'text-purple-600 bg-purple-50', sub: `${allTimeTasks.length} total tasks` },
  ];

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={onBack}>
            <ArrowLeft className="w-4 h-4" />
          </Button>
          <div>
            <h2 className="text-xl font-bold">{member.name}</h2>
            <div className="flex items-center gap-2 mt-0.5">
              {(Array.isArray(member.stations) && member.stations.length > 0 ? member.stations : member.station ? [member.station] : []).map(s => (
                <Badge key={s} className={cn("text-[10px]", STATION_COLORS[s])}>{s}</Badge>
              ))}
              <span className="text-xs text-muted-foreground">
                {format(dateRange.from, 'dd MMM')} – {format(dateRange.to, 'dd MMM yyyy')}
              </span>
            </div>
          </div>
        </div>
        <DateRangeFilter dateRange={dateRange} onChange={onDateRangeChange} />
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
        {statCards.map(s => (
          <div key={s.label} className="bg-card border border-border rounded-xl p-4">
            <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${s.color} mb-2`}>
              <s.icon className="w-4 h-4" />
            </div>
            <p className="text-lg font-bold">{s.value}</p>
            <p className="text-[11px] text-muted-foreground">{s.label}</p>
            {s.sub && <p className="text-[10px] text-muted-foreground mt-0.5">{s.sub}</p>}
          </div>
        ))}
      </div>

      {/* Station Breakdown */}
      {Object.keys(stationBreakdown).length > 0 && (
        <div className="grid grid-cols-3 gap-3">
          {['prep', 'cook', 'portion'].filter(s => stationBreakdown[s]).map(s => {
            const data = stationBreakdown[s];
            const stationAvg = data.count > 0 ? data.totalMs / data.count : 0;
            return (
              <div key={s} className="bg-card border border-border rounded-xl p-4">
                <Badge className={cn("text-[10px] mb-2", STATION_COLORS[s])}>{s.toUpperCase()}</Badge>
                <p className="text-sm font-bold">{data.count} tasks</p>
                <p className="text-xs text-muted-foreground">
                  Total: {formatDurationShort(data.totalMs)} · Avg: {formatDurationShort(stationAvg)}
                </p>
              </div>
            );
          })}
        </div>
      )}

      {/* Task History Table */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="px-6 py-4 border-b border-border">
          <h3 className="text-sm font-semibold">Task History</h3>
          <p className="text-xs text-muted-foreground mt-0.5">{memberTasks.length} completed tasks in selected period</p>
        </div>
        {memberTasks.length === 0 ? (
          <div className="px-6 py-12 text-center text-sm text-muted-foreground">
            <Clock className="w-8 h-8 mx-auto mb-2 text-muted-foreground/40" />
            No completed tasks in this date range
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Task</th>
                  <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Meal</th>
                  <th className="text-center px-4 py-2.5 font-medium text-muted-foreground">Station</th>
                  <th className="text-center px-4 py-2.5 font-medium text-muted-foreground">Qty</th>
                  <th className="text-center px-4 py-2.5 font-medium text-muted-foreground">Duration</th>
                  <th className="text-center px-4 py-2.5 font-medium text-muted-foreground">vs Avg</th>
                  <th className="text-center px-4 py-2.5 font-medium text-muted-foreground">vs Team</th>
                  <th className="text-right px-4 py-2.5 font-medium text-muted-foreground">Completed</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {memberTasks.map(t => {
                  const dur = t.activeDuration;
                  const diffSelf = avgTime > 0 ? Math.round(((dur - avgTime) / avgTime) * 100) : 0;
                  const diffTeam = teamAvg > 0 ? Math.round(((dur - teamAvg) / teamAvg) * 100) : 0;
                  return (
                    <tr key={t.id} className="hover:bg-muted/30">
                      <td className="px-4 py-3 font-medium">{t.name}</td>
                      <td className="px-4 py-3 text-muted-foreground text-xs">{t.meal_name || '—'}</td>
                      <td className="px-4 py-3 text-center">
                        <Badge className={cn("text-[10px]", STATION_COLORS[t.station])}>{t.station}</Badge>
                      </td>
                      <td className="px-4 py-3 text-center font-semibold">{t.qty || '—'}</td>
                      <td className="px-4 py-3 text-center font-mono text-xs">{formatDurationLong(dur)}</td>
                      <td className="px-4 py-3 text-center">
                        <span className={cn("text-xs font-medium", diffSelf < 0 ? "text-green-600" : diffSelf > 0 ? "text-red-500" : "text-muted-foreground")}>
                          {diffSelf <= 0 ? '' : '+'}{diffSelf}%
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        {teamAvg > 0 && (
                          <span className={cn("text-xs font-medium", diffTeam < 0 ? "text-green-600" : diffTeam > 0 ? "text-red-500" : "text-muted-foreground")}>
                            {diffTeam <= 0 ? '' : '+'}{diffTeam}%
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right text-xs text-muted-foreground">
                        {format(new Date(t.finished_at), 'dd MMM HH:mm')}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}