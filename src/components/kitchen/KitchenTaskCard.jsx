import React, { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Play, Pause, CheckCircle2, Clock, Undo2, ChevronDown, ChevronUp, Wrench } from 'lucide-react';
import { cn } from '@/lib/utils';
import LiveTimer, { formatDuration } from '@/components/kitchen/LiveTimer';

const STATION_BUTTON_COLORS = {
  prep: 'bg-blue-500 hover:bg-blue-600',
  cook: 'bg-amber-500 hover:bg-amber-600',
  portion: 'bg-green-500 hover:bg-green-600',
};

export default function KitchenTaskCard({ task, onStatusChange, onTap, loading, taskLogs = [] }) {
  const [showNotes, setShowNotes] = useState(false);

  const isDone = task.status === 'done';
  const isActive = task.status === 'in_progress';
  const isPaused = task.status === 'paused';
  const isPending = task.status === 'pending';

  const completedDuration = isDone && task.started_at && task.finished_at
    ? new Date(task.finished_at).getTime() - new Date(task.started_at).getTime()
    : null;

  return (
    <div className={cn(
      "bg-card border-2 rounded-2xl p-5 transition-all",
      isActive && "border-amber-400 ring-2 ring-amber-200 dark:ring-amber-800",
      isDone && "border-green-300 opacity-60",
      isPaused && "border-blue-300",
      isPending && "border-border",
    )}>
      {/* Header row — tap to open detail */}
      <div
        className="flex items-start justify-between gap-3 mb-3 cursor-pointer active:opacity-70"
        onClick={() => onTap && onTap(task.id)}
      >
        <div className="flex-1 min-w-0">
          <h2 className="text-2xl font-bold leading-tight truncate">
            {task.meal_name || task.name}
          </h2>
          <div className="flex items-center gap-2 mt-1">
            {task.product_sku && (
              <span className="text-sm font-mono text-muted-foreground">{task.product_sku}</span>
            )}
            {task.name && task.meal_name && task.name !== task.meal_name && (
              <Badge variant="outline" className="text-xs">{task.name}</Badge>
            )}
          </div>
        </div>
        <div className="text-right shrink-0">
          {task.qty && (
            <div className="text-3xl font-bold tabular-nums">{task.qty}</div>
          )}
          <span className="text-xs text-muted-foreground">{task.qty_uom || 'units'}</span>
        </div>
      </div>

      {/* Batch & Equipment info */}
      <div className="flex items-center gap-2 flex-wrap mb-2">
        {task.total_batches > 1 && (
          <Badge className="bg-purple-100 text-purple-700 text-xs gap-1">
            Batch {task.batch_number} of {task.total_batches}
          </Badge>
        )}
        {task.equipment_name && (
          <Badge variant="outline" className="text-xs gap-1">
            <Wrench className="w-3 h-3" /> {task.equipment_name}
          </Badge>
        )}
        {task.assigned_name && (
          <>
            <span className="text-xs text-muted-foreground">Assigned to:</span>
            <Badge variant="outline" className="text-xs font-medium">{task.assigned_name}</Badge>
          </>
        )}
      </div>

      {/* Timer */}
      <div className="flex items-center justify-center py-3 mb-3 rounded-xl bg-muted/50">
        {isPending && (
          <span className="text-lg text-muted-foreground flex items-center gap-2">
            <Clock className="w-5 h-5" /> Waiting to start
          </span>
        )}
        {isActive && task.started_at && (
          <LiveTimer
            startedAt={task.started_at}
            isActive={true}
            logs={taskLogs}
            className="font-mono text-2xl font-bold text-amber-600 dark:text-amber-400 tabular-nums"
          />
        )}
        {isPaused && task.started_at && (
          <div className="flex items-center gap-2">
            <Pause className="w-5 h-5 text-blue-600" />
            <LiveTimer
              startedAt={task.started_at}
              isActive={false}
              logs={taskLogs}
              className="font-mono text-2xl font-bold text-blue-600 tabular-nums"
            />
          </div>
        )}
        {isDone && completedDuration && (
          <span className="font-mono text-2xl font-bold text-green-600 tabular-nums flex items-center gap-2">
            <CheckCircle2 className="w-6 h-6" /> {formatDuration(completedDuration)}
          </span>
        )}
      </div>

      {/* Recipe notes — expandable */}
      {task.notes && (
        <div className="mb-3">
          <button
            onClick={() => setShowNotes(!showNotes)}
            className="flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
          >
            {showNotes ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            Recipe Notes
          </button>
          {showNotes && (
            <div className="mt-2 p-3 bg-muted rounded-xl text-sm leading-relaxed whitespace-pre-wrap">
              {task.notes}
            </div>
          )}
        </div>
      )}

      {/* Action buttons — 80px tall, huge tap targets */}
      {(() => {
        const btnColor = STATION_BUTTON_COLORS[task.station] || STATION_BUTTON_COLORS.cook;
        return (
          <div className="flex items-center gap-3">
            {isPending && (
              <Button
                disabled={loading}
                onClick={() => onStatusChange(task.id, 'in_progress')}
                className={`h-20 flex-1 gap-3 text-xl font-bold rounded-xl text-white ${btnColor}`}
              >
                <Play className="w-7 h-7" /> Start
              </Button>
            )}
            {isActive && (
              <>
                <Button
                  disabled={loading}
                  variant="outline"
                  onClick={() => onStatusChange(task.id, 'paused')}
                  className="h-20 flex-1 gap-3 text-xl font-bold rounded-xl"
                >
                  <Pause className="w-7 h-7" /> Pause
                </Button>
                <Button
                  disabled={loading}
                  onClick={() => onStatusChange(task.id, 'done')}
                  className="h-20 flex-1 gap-3 text-xl font-bold bg-green-600 hover:bg-green-700 rounded-xl text-white"
                >
                  <CheckCircle2 className="w-7 h-7" /> Done
                </Button>
              </>
            )}
            {isPaused && (
              <Button
                disabled={loading}
                onClick={() => onStatusChange(task.id, 'in_progress')}
                className={`h-20 flex-1 gap-3 text-xl font-bold rounded-xl text-white ${btnColor}`}
              >
                <Play className="w-7 h-7" /> Resume
              </Button>
            )}
            {isDone && (
              <Button
                disabled={loading}
                variant="outline"
                onClick={() => onStatusChange(task.id, 'undo')}
                className="h-20 flex-1 gap-3 text-lg font-bold text-amber-600 border-amber-300 hover:bg-amber-50 dark:hover:bg-amber-950 rounded-xl"
              >
                <Undo2 className="w-6 h-6" /> Undo
              </Button>
            )}
          </div>
        );
      })()}
    </div>
  );
}