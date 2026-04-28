import React, { useState, useMemo } from 'react';
import FloorTaskCard from './FloorTaskCard';

/**
 * Renders station tasks grouped: active first, then pending, then done (collapsed).
 * Max 15 visible by default per non-negotiable rule.
 */
export default function FloorTaskList({ tasks, taskLogs, onStatusChange, loading }) {
  const { active, pending, done } = useMemo(() => {
    const active = tasks.filter(t => t.status === 'in_progress' || t.status === 'paused');
    const pending = tasks.filter(t => t.status === 'pending');
    const done = tasks.filter(t => t.status === 'done');
    return { active, pending, done };
  }, [tasks]);

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

      {/* Pending tasks — show up to 15 */}
      {pending.slice(0, 15).map(task => (
        <FloorTaskCard
          key={task.id}
          task={task}
          taskLogs={taskLogs.filter(l => l.task_id === task.id)}
          onStatusChange={onStatusChange}
          loading={loading}
        />
      ))}
      {pending.length > 15 && (
        <p className="text-xs text-muted-foreground text-center py-2">
          +{pending.length - 15} more pending tasks
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