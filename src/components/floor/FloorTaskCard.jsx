import React, { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Play, Pause, CheckCircle2, Clock, Undo2, Wrench, ChevronDown, ChevronUp } from 'lucide-react';
import { cn } from '@/lib/utils';
import LiveTimer, { formatDuration } from '@/components/kitchen/LiveTimer';

const BTN_COLORS = {
  prep: 'bg-blue-500 hover:bg-blue-600',
  cook: 'bg-amber-500 hover:bg-amber-600',
  portion: 'bg-green-500 hover:bg-green-600',
};

export default function FloorTaskCard({ task, taskLogs, onStatusChange, loading }) {
  const [showNotes, setShowNotes] = useState(false);
  const isDone = task.status === 'done';
  const isActive = task.status === 'in_progress';
  const isPaused = task.status === 'paused';
  const isPending = task.status === 'pending';
  const btnColor = BTN_COLORS[task.station] || BTN_COLORS.cook;

  const completedDuration = isDone && task.started_at && task.finished_at
    ? new Date(task.finished_at).getTime() - new Date(task.started_at).getTime()
    : null;

  return (
    <div className={cn(
      "bg-card border-2 rounded-2xl p-4 transition-all",
      isActive && "border-amber-400 ring-2 ring-amber-200 dark:ring-amber-800",
      isDone && "border-green-300 opacity-60",
      isPaused && "border-blue-300",
      isPending && "border-border",
    )}>
      {/* Top row: name + qty */}
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="flex-1 min-w-0">
          <h3 className="text-lg font-bold leading-tight truncate">
            {task.meal_name || task.name}
          </h3>
          <div className="flex items-center gap-2 mt-0.5 flex-wrap">
            {task.product_sku && (
              <span className="text-xs font-mono text-muted-foreground">{task.product_sku}</span>
            )}
            {task.name && task.meal_name && task.name !== task.meal_name && (
              <Badge variant="outline" className="text-[10px]">{task.name}</Badge>
            )}
          </div>
        </div>
        <div className="text-right shrink-0">
          <div className="text-2xl font-bold tabular-nums">{task.qty || '—'}</div>
          <span className="text-[10px] text-muted-foreground">{task.qty_uom || 'units'}</span>
        </div>
      </div>

      {/* Metadata badges */}
      <div className="flex items-center gap-1.5 flex-wrap mb-2">
        {task.total_batches > 1 && (
          <Badge className="bg-purple-100 text-purple-700 text-[10px]">
            Batch {task.batch_number}/{task.total_batches}
          </Badge>
        )}
        {task.equipment_name && (
          <Badge variant="outline" className="text-[10px] gap-0.5">
            <Wrench className="w-2.5 h-2.5" /> {task.equipment_name}
          </Badge>
        )}
        {task.assigned_name && (
          <Badge variant="outline" className="text-[10px]">{task.assigned_name}</Badge>
        )}
      </div>

      {/* Timer */}
      <div className="flex items-center justify-center py-2 mb-3 rounded-xl bg-muted/50">
        {isPending && (
          <span className="text-sm text-muted-foreground flex items-center gap-1.5">
            <Clock className="w-4 h-4" /> Waiting to start
          </span>
        )}
        {isActive && task.started_at && (
          <LiveTimer startedAt={task.started_at} isActive={true} logs={taskLogs} className="font-mono text-xl font-bold text-amber-600 dark:text-amber-400 tabular-nums" />
        )}
        {isPaused && task.started_at && (
          <div className="flex items-center gap-2">
            <Pause className="w-4 h-4 text-blue-600" />
            <LiveTimer startedAt={task.started_at} isActive={false} logs={taskLogs} className="font-mono text-xl font-bold text-blue-600 tabular-nums" />
          </div>
        )}
        {isDone && completedDuration && (
          <span className="font-mono text-xl font-bold text-green-600 tabular-nums flex items-center gap-1.5">
            <CheckCircle2 className="w-5 h-5" /> {formatDuration(completedDuration)}
          </span>
        )}
      </div>

      {/* Notes toggle */}
      {task.notes && task.notes !== 'Kitchen Cooking' && task.notes !== 'Kitchen Prep' && task.notes !== 'Portioning' && (
        <button
          onClick={() => setShowNotes(!showNotes)}
          className="flex items-center gap-1 text-xs text-primary font-medium mb-2"
        >
          {showNotes ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          Recipe Notes
        </button>
      )}
      {showNotes && task.notes && (
        <div className="mb-3 p-3 bg-muted rounded-xl text-xs leading-relaxed whitespace-pre-wrap">
          {task.notes}
        </div>
      )}

      {/* Action buttons — big tap targets */}
      <div className="flex items-center gap-2">
        {isPending && (
          <Button disabled={loading} onClick={() => onStatusChange(task.id, 'in_progress')}
            className={`h-16 flex-1 gap-2 text-lg font-bold rounded-xl text-white ${btnColor}`}>
            <Play className="w-6 h-6" /> Start
          </Button>
        )}
        {isActive && (
          <>
            <Button disabled={loading} variant="outline" onClick={() => onStatusChange(task.id, 'paused')}
              className="h-16 flex-1 gap-2 text-lg font-bold rounded-xl">
              <Pause className="w-6 h-6" /> Pause
            </Button>
            <Button disabled={loading} onClick={() => onStatusChange(task.id, 'done')}
              className="h-16 flex-1 gap-2 text-lg font-bold bg-green-600 hover:bg-green-700 rounded-xl text-white">
              <CheckCircle2 className="w-6 h-6" /> Done
            </Button>
          </>
        )}
        {isPaused && (
          <Button disabled={loading} onClick={() => onStatusChange(task.id, 'in_progress')}
            className={`h-16 flex-1 gap-2 text-lg font-bold rounded-xl text-white ${btnColor}`}>
            <Play className="w-6 h-6" /> Resume
          </Button>
        )}
        {isDone && (
          <Button disabled={loading} variant="outline" onClick={() => onStatusChange(task.id, 'undo')}
            className="h-16 flex-1 gap-2 text-base font-bold text-amber-600 border-amber-300 hover:bg-amber-50 dark:hover:bg-amber-950 rounded-xl">
            <Undo2 className="w-5 h-5" /> Undo
          </Button>
        )}
      </div>
    </div>
  );
}