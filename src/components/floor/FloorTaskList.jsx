import React, { useState, useMemo } from 'react';
import FloorTaskCard from './FloorTaskCard';

/**
 * Renders station tasks grouped: active first, then pending (ready above blocked), then done (collapsed).
 * Max 15 visible by default per non-negotiable rule.
 * allTasks = all tasks in the run (across stations) — used for dependency checking.
 */
export default function FloorTaskList({ tasks, allTasks, taskLogs, onStatusChange, loading, pickListConfirmed }) {
  // Build a set of blocked task IDs (pending tasks whose prerequisite stage isn't done)
  const blockedIds = useMemo(() => {
    const blocked = new Set();
    if (!pickListConfirmed) {
      // If pick list not confirmed, ALL pending tasks are blocked
      tasks.filter(t => t.status === 'pending').forEach(t => blocked.add(t.id));
      return blocked;
    }
    const lookup = allTasks || tasks;
    tasks.filter(t => t.status === 'pending').forEach(task => {
      const prereqStation = task.station === 'cook' ? 'prep' : task.station === 'portion' ? 'cook' : null;
      if (!prereqStation) return;
      const prereqs = lookup.filter(t => t.station === prereqStation && t.line_id === task.line_id && !t.archived);
      if (prereqs.length > 0 && prereqs.some(t => t.status !== 'done')) {
        blocked.add(task.id);
      }
    });
    return blocked;
  }, [tasks, allTasks, pickListConfirmed]);

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

  return (
    <div className="space-y-3">
      {/* Active tasks — always on top */}
      {active.map(task => (
        <FloorTaskCard
          key={task.id}
          task={task}
          taskLogs={taskLogs.filter(l => l.task_id === task.id)}
          onStatusChange={onStatusChange}
          loading={loading}
        />
      ))}

      {/* Ready pending tasks — show up to 15 */}
      {pendingReady.slice(0, 15).map(task => (
        <FloorTaskCard
          key={task.id}
          task={task}
          taskLogs={taskLogs.filter(l => l.task_id === task.id)}
          onStatusChange={onStatusChange}
          loading={loading}
          isBlocked={false}
        />
      ))}
      {pendingReady.length > 15 && (
        <p className="text-xs text-muted-foreground text-center py-2">
          +{pendingReady.length - 15} more ready tasks
        </p>
      )}

      {/* Blocked pending tasks */}
      {pendingBlocked.length > 0 && (
        <p className="text-xs text-muted-foreground text-center py-2 font-medium uppercase tracking-wider">
          Waiting for prior stage ({pendingBlocked.length})
        </p>
      )}
      {pendingBlocked.slice(0, 10).map(task => (
        <FloorTaskCard
          key={task.id}
          task={task}
          taskLogs={taskLogs.filter(l => l.task_id === task.id)}
          onStatusChange={onStatusChange}
          loading={loading}
          isBlocked={true}
        />
      ))}
      {pendingBlocked.length > 10 && (
        <p className="text-xs text-muted-foreground text-center py-2">
          +{pendingBlocked.length - 10} more blocked tasks
        </p>
      )}

      {/* Done tasks — collapsed by default */}
      {done.length > 0 && (
        <button
          onClick={() => setShowDone(!showDone)}
          className="w-full py-3 text-sm font-medium text-muted-foreground bg-muted/50 rounded-xl active:bg-muted transition-colors"
        >
          {showDone ? 'Hide' : 'Show'} {done.length} completed task{done.length > 1 ? 's' : ''}
        </button>
      )}
      {showDone && done.map(task => (
        <FloorTaskCard
          key={task.id}
          task={task}
          taskLogs={taskLogs.filter(l => l.task_id === task.id)}
          onStatusChange={onStatusChange}
          loading={loading}
        />
      ))}
    </div>
  );
}