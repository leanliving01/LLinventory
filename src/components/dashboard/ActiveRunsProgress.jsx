import React from 'react';
import { Link } from 'react-router-dom';
import { Factory, ArrowRight } from 'lucide-react';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import { Progress } from '@/components/ui/progress';

export default function ActiveRunsProgress({ runs, tasks }) {
  const activeRuns = runs.filter(r => r.status === 'in_progress' || r.status === 'scheduled');

  // Calculate completion % per run from tasks
  const runsWithProgress = activeRuns.map(run => {
    const runTasks = tasks.filter(t => t.run_id === run.id && !t.archived);
    const total = runTasks.length;
    const done = runTasks.filter(t => t.status === 'done').length;
    const pct = total > 0 ? Math.round((done / total) * 100) : 0;
    return { ...run, taskTotal: total, taskDone: done, pct };
  });

  if (runsWithProgress.length === 0) {
    return (
      <div className="bg-card border border-border rounded-lg shadow-sm p-5">
        <h3 className="text-sm font-semibold text-foreground mb-4">Active Production Runs</h3>
        <div className="text-center py-8 text-muted-foreground text-sm">
          <div className="w-10 h-10 rounded-md bg-muted flex items-center justify-center mx-auto mb-2">
            <Factory className="w-5 h-5 text-muted-foreground" strokeWidth={1.5} />
          </div>
          No active runs
        </div>
      </div>
    );
  }

  return (
    <div className="bg-card border border-border rounded-lg shadow-sm p-5">
      <h3 className="text-sm font-semibold text-foreground mb-4">Active Production Runs</h3>
      <div className="space-y-3">
        {runsWithProgress.slice(0, 6).map(run => (
          <Link
            key={run.id}
            to={`/production/run/${run.id}`}
            className="block p-3 rounded-md border border-border hover:bg-muted/50 transition-colors"
          >
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <Factory className={cn(
                  "w-4 h-4",
                  run.status === 'in_progress' ? 'text-status-warn' : 'text-status-info'
                )} strokeWidth={1.5} />
                <span className="text-sm font-medium">{run.run_number || 'Run'}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className={cn(
                  "text-xs font-semibold tabular-nums",
                  run.pct >= 80 ? 'text-status-good' : run.pct >= 40 ? 'text-status-warn' : 'text-status-bad'
                )}>
                  {run.pct}%
                </span>
                <ArrowRight className="w-3.5 h-3.5 text-muted-foreground" />
              </div>
            </div>
            <Progress value={run.pct} className="h-2" />
            <div className="flex items-center justify-between mt-1.5 text-[11px] text-muted-foreground">
              <span>{run.run_date ? format(new Date(run.run_date), 'dd MMM') : '—'} · {run.total_units || 0} units</span>
              <span>{run.taskDone}/{run.taskTotal} tasks</span>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}