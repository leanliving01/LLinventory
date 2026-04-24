import React, { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Badge } from '@/components/ui/badge';
import { Clock, ChefHat, Flame, Utensils, ClipboardList } from 'lucide-react';
import { format } from 'date-fns';
import { formatDuration } from '@/components/kitchen/LiveTimer';

const STATION_CONFIG = {
  picking: { label: 'Picking', icon: ClipboardList, color: 'text-purple-600', bg: 'bg-purple-50' },
  prep: { label: 'Prep', icon: Utensils, color: 'text-blue-600', bg: 'bg-blue-50' },
  cook: { label: 'Cook', icon: Flame, color: 'text-amber-600', bg: 'bg-amber-50' },
  portion: { label: 'Portion', icon: ChefHat, color: 'text-green-600', bg: 'bg-green-50' },
};

export default function ProductionTimeBreakdown({ runId, run }) {
  const { data: tasks = [] } = useQuery({
    queryKey: ['run-tasks-report', runId],
    queryFn: () => base44.entities.ProductionTask.filter({ run_id: runId }, 'step_no', 500),
    enabled: !!runId,
  });

  const { data: taskLogs = [] } = useQuery({
    queryKey: ['task-logs-report', runId],
    queryFn: () => base44.entities.ProductionTaskLog.filter({ run_id: runId }, 'timestamp', 2000),
    enabled: !!runId,
  });

  const breakdown = useMemo(() => {
    const result = {};

    // Picking time from run timestamps
    if (run?.picking_started_at && run?.picking_finished_at) {
      const ms = new Date(run.picking_finished_at).getTime() - new Date(run.picking_started_at).getTime();
      result.picking = { totalMs: ms, taskCount: 1 };
    }

    // Station times from tasks — calculate active (non-paused) duration per task
    const logsByTask = {};
    taskLogs.forEach(l => {
      if (!logsByTask[l.task_id]) logsByTask[l.task_id] = [];
      logsByTask[l.task_id].push(l);
    });

    for (const task of tasks) {
      if (!task.started_at || !task.finished_at) continue;
      const station = task.station;
      if (!result[station]) result[station] = { totalMs: 0, taskCount: 0 };

      // Calculate paused time from logs
      let pausedMs = 0;
      const logs = (logsByTask[task.id] || []).sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
      let lastPause = null;
      for (const log of logs) {
        if (log.event_type === 'paused') lastPause = new Date(log.timestamp).getTime();
        else if (log.event_type === 'resumed' && lastPause) {
          pausedMs += new Date(log.timestamp).getTime() - lastPause;
          lastPause = null;
        }
      }

      const totalMs = new Date(task.finished_at).getTime() - new Date(task.started_at).getTime() - pausedMs;
      result[station].totalMs += Math.max(0, totalMs);
      result[station].taskCount += 1;
    }

    return result;
  }, [tasks, taskLogs, run]);

  // Total production time (started_at → completed_at)
  const totalProductionMs = run?.started_at && run?.completed_at
    ? new Date(run.completed_at).getTime() - new Date(run.started_at).getTime()
    : 0;

  const stations = ['picking', 'prep', 'cook', 'portion'];
  const hasData = stations.some(s => breakdown[s]);

  if (!hasData && !totalProductionMs) {
    return (
      <div className="text-center py-4 text-sm text-muted-foreground">
        No timing data available for this run.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Total production time */}
      {totalProductionMs > 0 && (
        <div className="flex items-center justify-between bg-muted/50 rounded-lg px-4 py-3">
          <div className="flex items-center gap-2">
            <Clock className="w-4 h-4 text-foreground" />
            <span className="text-sm font-bold">Total Production Time</span>
          </div>
          <span className="font-mono text-sm font-bold">{formatDuration(totalProductionMs)}</span>
        </div>
      )}

      {/* Per-station breakdown */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {stations.map(station => {
          const config = STATION_CONFIG[station];
          const data = breakdown[station];
          const Icon = config.icon;
          return (
            <div key={station} className={`rounded-lg px-4 py-3 ${config.bg}`}>
              <div className="flex items-center gap-2 mb-1">
                <Icon className={`w-4 h-4 ${config.color}`} />
                <span className={`text-xs font-bold uppercase tracking-wider ${config.color}`}>{config.label}</span>
              </div>
              {data ? (
                <>
                  <p className="font-mono text-lg font-bold">{formatDuration(data.totalMs)}</p>
                  <p className="text-xs text-muted-foreground">{data.taskCount} task{data.taskCount !== 1 ? 's' : ''}</p>
                </>
              ) : (
                <p className="text-xs text-muted-foreground mt-1">No data</p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}