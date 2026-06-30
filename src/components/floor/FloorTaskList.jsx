import React, { useState, useMemo } from 'react';
import { CheckCircle2, ChevronDown, ChevronUp, Undo2 } from 'lucide-react';
import FloorTaskCard from './FloorTaskCard';
import { getBlockedTaskIds } from '@/lib/taskDependencyCheck';

const STATION_LABEL = { prep: 'Prepping', cook: 'Cooking', portion: 'Portioning' };
const fmtTime = (iso) => iso ? new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';

/**
 * Renders station tasks grouped: active first, then pending (ready above blocked), then done (collapsed).
 * Max 15 visible by default per non-negotiable rule.
 * allTasks = all tasks in the run (across stations) — used for dependency checking.
 */
export default function FloorTaskList({ tasks, allTasks, taskLogs, onStatusChange, onOpenDetail, loading, pickListConfirmed, bomComponentsMap, allBoms, horizontal }) {
  // Build a set of blocked task IDs using component-level dependency checking
  const blockedIds = useMemo(() => {
    return getBlockedTaskIds(tasks, allTasks || tasks, bomComponentsMap || {}, allBoms || [], pickListConfirmed);
  }, [tasks, allTasks, pickListConfirmed, bomComponentsMap, allBoms]);

  const { active, pendingReady, pendingBlocked, done } = useMemo(() => {
    const active = tasks.filter(t => t.status === 'in_progress' || t.status === 'paused');
    const pending = tasks.filter(t => t.status === 'pending');
    const pendingReady = pending.filter(t => !blockedIds.has(t.id));
    const pendingBlocked = pending.filter(t => blockedIds.has(t.id));
    const done = tasks.filter(t => t.status === 'done');
    return { active, pendingReady, pendingBlocked, done };
  }, [tasks, blockedIds]);

  const [showDone, setShowDone] = React.useState(false);

  // The hero "NEXT UP" card: the running task if any, else the first ready task.
  const heroId = active[0]?.id ?? pendingReady[0]?.id ?? null;

  if (tasks.length === 0) {
    return (
      <div className="text-center py-12">
        <p className="text-muted-foreground text-sm">No tasks at this station.</p>
      </div>
    );
  }

  const cardProps = (task, blocked) => ({
    key: task.id,
    task,
    taskLogs: taskLogs.filter(l => l.task_id === task.id),
    onStatusChange,
    onOpenDetail,
    loading,
    horizontal,
    isNext: task.id === heroId,
    ...(blocked !== undefined ? { isBlocked: blocked } : {}),
  });

  // Compact green-checked strip for completed tasks at this station.
  const CompletedStrip = () => (
    done.length > 0 ? (
      <div className="pt-1">
        <button
          onClick={() => setShowDone(!showDone)}
          className="flex items-center gap-1.5 text-sm font-semibold text-muted-foreground uppercase tracking-wider"
        >
          Completed ({done.length})
          {showDone ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </button>
        {showDone && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 mt-2">
            {done.map(t => (
              <div key={t.id} className="flex items-start gap-2 p-3 rounded-xl border bg-card">
                <CheckCircle2 className="w-5 h-5 text-green-600 shrink-0 mt-0.5" />
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-sm truncate">{t.meal_name || t.name}</p>
                  <p className="text-xs text-green-600">{STATION_LABEL[t.station] || 'Task'} completed</p>
                  {t.finished_at && <p className="text-[11px] text-muted-foreground">{fmtTime(t.finished_at)}</p>}
                </div>
                <button
                  onClick={() => onStatusChange(t.id, 'undo')}
                  disabled={loading}
                  className="shrink-0 flex items-center gap-1 text-xs font-medium text-amber-600 hover:text-amber-700"
                >
                  <Undo2 className="w-3.5 h-3.5" /> Undo
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    ) : null
  );

  if (horizontal) {
    return (
      <div className="space-y-4">
        {/* Active tasks row */}
        {active.length > 0 && (
          <div>
            <p className="text-xs font-semibold text-amber-600 uppercase tracking-wider mb-2">Active ({active.length})</p>
            <div className="flex gap-3 overflow-x-auto pb-2 -mx-1 px-1">
              {active.map(task => <FloorTaskCard {...cardProps(task)} />)}
            </div>
          </div>
        )}

        {/* Ready pending tasks row */}
        {pendingReady.length > 0 && (
          <div>
            <p className="text-xs font-semibold text-primary uppercase tracking-wider mb-2">Ready ({pendingReady.length})</p>
            <div className="flex gap-3 overflow-x-auto pb-2 -mx-1 px-1">
              {pendingReady.slice(0, 15).map(task => <FloorTaskCard {...cardProps(task, false)} />)}
              {pendingReady.length > 15 && (
                <div className="w-32 flex-shrink-0 flex items-center justify-center text-xs text-muted-foreground">
                  +{pendingReady.length - 15} more
                </div>
              )}
            </div>
          </div>
        )}

        {/* Blocked tasks row */}
        {pendingBlocked.length > 0 && (
          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Waiting for prior stage ({pendingBlocked.length})</p>
            <div className="flex gap-3 overflow-x-auto pb-2 -mx-1 px-1">
              {pendingBlocked.slice(0, 10).map(task => <FloorTaskCard {...cardProps(task, true)} />)}
              {pendingBlocked.length > 10 && (
                <div className="w-32 flex-shrink-0 flex items-center justify-center text-xs text-muted-foreground">
                  +{pendingBlocked.length - 10} more
                </div>
              )}
            </div>
          </div>
        )}

        {/* Done — compact completed strip */}
        <CompletedStrip />
      </div>
    );
  }

  // Vertical layout (default)
  return (
    <div className="space-y-3">
      {active.map(task => <FloorTaskCard {...cardProps(task)} />)}
      {pendingReady.slice(0, 15).map(task => <FloorTaskCard {...cardProps(task, false)} />)}
      {pendingReady.length > 15 && (
        <p className="text-xs text-muted-foreground text-center py-2">+{pendingReady.length - 15} more ready tasks</p>
      )}
      {pendingBlocked.length > 0 && (
        <p className="text-xs text-muted-foreground text-center py-2 font-medium uppercase tracking-wider">
          Waiting for prior stage ({pendingBlocked.length})
        </p>
      )}
      {pendingBlocked.slice(0, 10).map(task => <FloorTaskCard {...cardProps(task, true)} />)}
      {pendingBlocked.length > 10 && (
        <p className="text-xs text-muted-foreground text-center py-2">+{pendingBlocked.length - 10} more blocked tasks</p>
      )}
      <CompletedStrip />
    </div>
  );
}