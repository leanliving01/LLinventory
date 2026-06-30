import React, { useMemo } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Play, Pause, CheckCircle2, Clock, Undo2, Wrench } from 'lucide-react';
import { cn } from '@/lib/utils';
import LiveTimer, { formatDuration } from '@/components/kitchen/LiveTimer';

const STATUS_CONFIG = {
  pending: { label: 'Pending', icon: Clock, color: 'bg-muted text-muted-foreground' },
  in_progress: { label: 'In Progress', icon: Play, color: 'bg-amber-100 text-amber-700' },
  paused: { label: 'Paused', icon: Pause, color: 'bg-blue-100 text-blue-700' },
  done: { label: 'Done', icon: CheckCircle2, color: 'bg-green-100 text-green-700' },
};

function TaskTimer({ task, logs = [] }) {
  if (task.status === 'in_progress' && task.started_at) {
    return (
      <LiveTimer startedAt={task.started_at} isActive={true} logs={logs} className="font-mono text-xs text-amber-700 dark:text-amber-400 tabular-nums" />
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
      <LiveTimer startedAt={task.started_at} isActive={false} logs={logs} className="font-mono text-xs text-blue-600 tabular-nums" />
    );
  }

  return null;
}

const STATION_BTN_COLORS = {
  prep: 'bg-blue-500 hover:bg-blue-600',
  cook: 'bg-amber-500 hover:bg-amber-600',
  portion: 'bg-green-500 hover:bg-green-600',
};

/* Group tasks by meal_name and assign alternating group indices */
function groupTasks(tasks) {
  const groups = {};
  tasks.forEach(task => {
    const key = (task.meal_name || task.name || '').trim();
    if (!groups[key]) groups[key] = [];
    groups[key].push(task);
  });
  // Order meal groups by the production sequence (min sequence_order in the group),
  // alphabetical as a tiebreak — so the board follows the cook/portion order.
  const groupSeq = (k) => Math.min(...groups[k].map(t => t.sequence_order || 0));
  const sortedKeys = Object.keys(groups).sort((a, b) => groupSeq(a) - groupSeq(b) || a.localeCompare(b));
  const result = [];
  let groupIndex = 0;
  for (const key of sortedKeys) {
    groups[key].forEach(t => result.push({ task: t, groupIndex, groupKey: key }));
    groupIndex++;
  }
  return result;
}

const ZEBRA = ['bg-background', 'bg-muted/30'];

export default function KanbanColumn({ station, tasks, onStatusChange, taskLogs = [] }) {
  const doneCount = tasks.filter(t => t.status === 'done').length;
  const activeCount = tasks.filter(t => t.status === 'in_progress').length;
  const grouped = useMemo(() => groupTasks(tasks), [tasks]);

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
      <div className="p-3 space-y-1.5 flex-1 min-h-[200px]">
        {grouped.length === 0 ? (
          <p className="text-xs text-muted-foreground text-center py-8">No tasks</p>
        ) : (
          grouped.map(({ task, groupIndex, groupKey }, idx) => {
            const config = STATUS_CONFIG[task.status] || STATUS_CONFIG.pending;
            const Icon = config.icon;
            const zebraClass = ZEBRA[groupIndex % 2];
            const isFirstInGroup = idx === 0 || grouped[idx - 1].groupKey !== groupKey;
            return (
              <React.Fragment key={task.id}>
                {isFirstInGroup && (
                  <div className={cn("px-3 py-1.5 rounded-t-lg text-xs font-semibold text-muted-foreground uppercase tracking-wider mt-2", zebraClass)}>
                    {groupKey}
                  </div>
                )}
              <div className={cn(
                "border border-border rounded-lg p-3 space-y-2",
                zebraClass,
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
                <div className="flex items-center gap-2 flex-wrap">
                  {task.qty != null && (
                    <p className="text-xs text-muted-foreground">Qty: <strong>{Number.isInteger(task.qty) ? task.qty : Number(task.qty).toFixed(2)}{task.qty_uom ? ` ${task.qty_uom}` : (task.station === 'portion' ? ' pcs' : '')}</strong></p>
                  )}
                  {task.total_batches > 1 && (
                    <Badge className="bg-purple-100 text-purple-700 text-[9px] gap-0.5">
                      Batch {task.batch_number}/{task.total_batches}
                    </Badge>
                  )}
                  {task.equipment_name && (
                    <Badge variant="outline" className="text-[9px] gap-0.5">
                      <Wrench className="w-2.5 h-2.5" /> {task.equipment_name}
                    </Badge>
                  )}
                  {task.assigned_name && (
                    <Badge variant="outline" className="text-[10px]">{task.assigned_name}</Badge>
                  )}
                  <div className="ml-auto"><TaskTimer task={task} logs={taskLogs.filter(l => l.task_id === task.id)} /></div>
                </div>
                {task.notes && (
                  <p className="text-xs text-muted-foreground line-clamp-2">{task.notes}</p>
                )}
                {(() => {
                  const btnColor = STATION_BTN_COLORS[station.id] || STATION_BTN_COLORS.cook;
                  return (
                    <div className="flex items-center gap-1.5">
                      {task.status === 'pending' && (
                        <Button size="sm" className={`h-12 flex-1 gap-1.5 text-sm text-white ${btnColor}`} onClick={() => onStatusChange(task.id, 'in_progress')}>
                          <Play className="w-4 h-4" /> Start
                        </Button>
                      )}
                      {task.status === 'in_progress' && (
                        <>
                          <Button size="sm" variant="outline" className="h-12 flex-1 gap-1.5 text-sm" onClick={() => onStatusChange(task.id, 'paused')}>
                            <Pause className="w-4 h-4" /> Pause
                          </Button>
                          <Button size="sm" className="h-12 flex-1 gap-1.5 text-sm bg-green-600 hover:bg-green-700 text-white" onClick={() => onStatusChange(task.id, 'done')}>
                            <CheckCircle2 className="w-4 h-4" /> Done
                          </Button>
                        </>
                      )}
                      {task.status === 'paused' && (
                        <Button size="sm" className={`h-12 flex-1 gap-1.5 text-sm text-white ${btnColor}`} onClick={() => onStatusChange(task.id, 'in_progress')}>
                          <Play className="w-4 h-4" /> Resume
                        </Button>
                      )}
                      {task.status === 'done' && (
                        <Button size="sm" variant="outline" className="h-12 flex-1 gap-1.5 text-sm text-amber-600 border-amber-300 hover:bg-amber-50" onClick={() => onStatusChange(task.id, 'undo')}>
                          <Undo2 className="w-4 h-4" /> Undo Done
                        </Button>
                      )}
                    </div>
                  );
                })()}
              </div>
              </React.Fragment>
            );
          })
        )}
      </div>
    </div>
  );
}