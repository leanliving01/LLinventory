import React, { useState, useEffect } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Play, Pause, CheckCircle2, Clock, Undo2 } from 'lucide-react';
import { cn } from '@/lib/utils';

const STATUS_CONFIG = {
  pending: { label: 'Pending', icon: Clock, color: 'bg-muted text-muted-foreground' },
  in_progress: { label: 'In Progress', icon: Play, color: 'bg-amber-100 text-amber-700' },
  paused: { label: 'Paused', icon: Pause, color: 'bg-blue-100 text-blue-700' },
  done: { label: 'Done', icon: CheckCircle2, color: 'bg-green-100 text-green-700' },
};

function formatDuration(ms) {
  if (!ms || ms <= 0) return '0:00';
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function TaskTimer({ task }) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (task.status !== 'in_progress' || !task.started_at) return;
    const start = new Date(task.started_at).getTime();
    const tick = () => setElapsed(Date.now() - start);
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [task.status, task.started_at]);

  if (task.status === 'in_progress' && task.started_at) {
    return (
      <span className="font-mono text-xs text-amber-700 dark:text-amber-400 tabular-nums">
        ⏱ {formatDuration(elapsed)}
      </span>
    );
  }

  if (task.status === 'done' && task.started_at && task.finished_at) {
    const duration = new Date(task.finished_at).getTime() - new Date(task.started_at).getTime();
    return (
      <span className="font-mono text-xs text-green-600 tabular-nums">
        ✓ {formatDuration(duration)}
      </span>
    );
  }

  if (task.status === 'paused' && task.started_at) {
    return (
      <span className="font-mono text-xs text-blue-600 tabular-nums">
        ⏸ paused
      </span>
    );
  }

  return null;
}

export default function KanbanColumn({ station, tasks, onStatusChange }) {
  const doneCount = tasks.filter(t => t.status === 'done').length;
  const activeCount = tasks.filter(t => t.status === 'in_progress').length;

  return (
    <div className="bg-card border border-border rounded-xl flex flex-col">
      <div className={cn("flex items-center gap-2 px-4 py-3 rounded-t-xl text-white", station.color)}>
        <station.icon className="w-5 h-5" />
        <span className="font-bold text-sm">{station.label}</span>
        <div className="ml-auto flex items-center gap-2">
          {activeCount > 0 && <Badge className="bg-white/20 text-white text-[10px]">{activeCount} active</Badge>}
          <Badge className="bg-white/20 text-white text-[10px]">{doneCount}/{tasks.length}</Badge>
        </div>
      </div>
      <div className="p-3 space-y-2 flex-1 min-h-[200px]">
        {tasks.length === 0 ? (
          <p className="text-xs text-muted-foreground text-center py-8">No tasks</p>
        ) : (
          tasks.map(task => {
            const config = STATUS_CONFIG[task.status] || STATUS_CONFIG.pending;
            const Icon = config.icon;
            return (
              <div key={task.id} className={cn(
                "bg-background border border-border rounded-lg p-3 space-y-2",
                task.status === 'in_progress' && "ring-2 ring-amber-300",
                task.status === 'done' && "opacity-60"
              )}>
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold truncate">{task.meal_name || task.name}</p>
                    {task.product_sku && (
                      <p className="text-[10px] font-mono text-muted-foreground">{task.product_sku}</p>
                    )}
                  </div>
                  <Badge className={cn("text-[10px] shrink-0", config.color)}>
                    <Icon className="w-3 h-3 mr-1" />{config.label}
                  </Badge>
                </div>
                <div className="flex items-center gap-2">
                  {task.qty && (
                    <p className="text-xs text-muted-foreground">Qty: <strong>{task.qty}</strong></p>
                  )}
                  <div className="ml-auto"><TaskTimer task={task} /></div>
                </div>
                {task.notes && (
                  <p className="text-xs text-muted-foreground line-clamp-2">{task.notes}</p>
                )}
                <div className="flex items-center gap-1.5">
                  {task.status === 'pending' && (
                    <Button size="sm" className="h-12 flex-1 gap-1.5 text-sm bg-amber-500 hover:bg-amber-600" onClick={() => onStatusChange(task.id, 'in_progress')}>
                      <Play className="w-4 h-4" /> Start
                    </Button>
                  )}
                  {task.status === 'in_progress' && (
                    <>
                      <Button size="sm" variant="outline" className="h-12 flex-1 gap-1.5 text-sm" onClick={() => onStatusChange(task.id, 'paused')}>
                        <Pause className="w-4 h-4" /> Pause
                      </Button>
                      <Button size="sm" className="h-12 flex-1 gap-1.5 text-sm bg-green-600 hover:bg-green-700" onClick={() => onStatusChange(task.id, 'done')}>
                        <CheckCircle2 className="w-4 h-4" /> Done
                      </Button>
                    </>
                  )}
                  {task.status === 'paused' && (
                    <Button size="sm" className="h-12 flex-1 gap-1.5 text-sm bg-amber-500 hover:bg-amber-600" onClick={() => onStatusChange(task.id, 'in_progress')}>
                      <Play className="w-4 h-4" /> Resume
                    </Button>
                  )}
                  {task.status === 'done' && (
                    <Button size="sm" variant="outline" className="h-12 flex-1 gap-1.5 text-sm text-amber-600 border-amber-300 hover:bg-amber-50" onClick={() => onStatusChange(task.id, 'undo')}>
                      <Undo2 className="w-4 h-4" /> Undo Done
                    </Button>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}