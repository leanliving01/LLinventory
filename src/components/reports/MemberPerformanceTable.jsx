import React, { useMemo } from 'react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { getTaskActiveDuration, formatDurationShort } from '@/lib/taskDuration';

const STATION_COLORS = {
  prep: 'bg-blue-100 text-blue-700',
  cook: 'bg-amber-100 text-amber-700',
  portion: 'bg-green-100 text-green-700',
};

export default function MemberPerformanceTable({ members, tasks, logsByTask = {}, onSelectMember }) {
  const memberStats = useMemo(() => {
    const completedTasks = tasks.filter(t => t.status === 'done' && t.started_at && t.finished_at);

    return members.filter(m => m.is_active).map(member => {
      const memberTasks = completedTasks.filter(t => t.assigned_to === member.id);
      const durations = memberTasks.map(t => getTaskActiveDuration(t, logsByTask[t.id] || []));

      const totalTime = durations.reduce((s, d) => s + d, 0);
      const avgTime = durations.length > 0 ? totalTime / durations.length : 0;
      const minTime = durations.length > 0 ? Math.min(...durations) : 0;
      const maxTime = durations.length > 0 ? Math.max(...durations) : 0;

      return {
        ...member,
        tasksCompleted: durations.length,
        avgTime,
        minTime,
        maxTime,
        totalTime,
      };
    }).sort((a, b) => b.tasksCompleted - a.tasksCompleted);
  }, [members, tasks, logsByTask]);

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      <div className="px-6 py-4 border-b border-border">
        <h3 className="text-sm font-semibold">Team Member Performance</h3>
        <p className="text-xs text-muted-foreground mt-0.5">Click a row for detailed history</p>
      </div>
      {memberStats.length === 0 ? (
        <div className="px-6 py-12 text-center text-sm text-muted-foreground">No active team members</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Name</th>
                <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Station</th>
                <th className="text-center px-4 py-2.5 font-medium text-muted-foreground">Tasks Done</th>
                <th className="text-center px-4 py-2.5 font-medium text-muted-foreground">Avg Time</th>
                <th className="text-center px-4 py-2.5 font-medium text-muted-foreground">Fastest</th>
                <th className="text-center px-4 py-2.5 font-medium text-muted-foreground">Slowest</th>
                <th className="text-center px-4 py-2.5 font-medium text-muted-foreground">Total Time</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {memberStats.map(m => (
                <tr
                  key={m.id}
                  className="hover:bg-muted/30 cursor-pointer"
                  onClick={() => onSelectMember(m)}
                >
                  <td className="px-4 py-3 font-medium">{m.name}</td>
                  <td className="px-4 py-3">
                    <div className="flex gap-1 flex-wrap">
                      {(Array.isArray(m.stations) && m.stations.length > 0 ? m.stations : m.station ? [m.station] : []).map(s => (
                        <Badge key={s} className={cn("text-[10px]", STATION_COLORS[s])}>
                          {s}
                        </Badge>
                      ))}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-center font-semibold">{m.tasksCompleted}</td>
                  <td className="px-4 py-3 text-center font-mono text-xs">{formatDurationShort(m.avgTime)}</td>
                  <td className="px-4 py-3 text-center font-mono text-xs text-green-600">{formatDurationShort(m.minTime)}</td>
                  <td className="px-4 py-3 text-center font-mono text-xs text-red-500">{formatDurationShort(m.maxTime)}</td>
                  <td className="px-4 py-3 text-center font-mono text-xs">{formatDurationShort(m.totalTime)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}