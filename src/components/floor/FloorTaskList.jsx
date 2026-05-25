import React, { useState, useMemo } from 'react';
import FloorTaskCard from './FloorTaskCard';
import { getBlockedTaskIds } from '@/lib/taskDependencyCheck';

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
    ...(blocked !== undefined ? { isBlocked: blocked } : {}),
  });

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

        {/* Done row — collapsed */}
        {done.length > 0 && (
          <div>
            <button
              onClick={() => setShowDone(!showDone)}
              className="w-full py-3 text-sm font-medium text-muted-foreground bg-muted/50 rounded-xl active:bg-muted transition-colors"
            >
              {showDone ? 'Hide' : 'Show'} {done.length} completed task{done.length > 1 ? 's' : ''}
            </button>
            {showDone && (
              <div className="flex gap-3 overflow-x-auto pb-2 -mx-1 px-1 mt-2">
                {done.map(task => <FloorTaskCard {...cardProps(task)} />)}
              </div>
            )}
          </div>
        )}
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
      {done.length > 0 && (
        <button onClick={() => setShowDone(!showDone)}
          className="w-full py-3 text-sm font-medium text-muted-foreground bg-muted/50 rounded-xl active:bg-muted transition-colors">
          {showDone ? 'Hide' : 'Show'} {done.length} completed task{done.length > 1 ? 's' : ''}
        </button>
      )}
      {showDone && done.map(task => <FloorTaskCard {...cardProps(task)} />)}
    </div>
  );
}