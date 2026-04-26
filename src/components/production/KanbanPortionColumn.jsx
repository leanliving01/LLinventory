import React, { useMemo } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Play, Pause, CheckCircle2, Clock, Undo2, ChefHat } from 'lucide-react';
import { cn } from '@/lib/utils';
import LiveTimer, { formatDuration } from '@/components/kitchen/LiveTimer';

const STATUS_CONFIG = {
  pending: { label: 'Pending', icon: Clock, color: 'bg-muted text-muted-foreground' },
  in_progress: { label: 'In Progress', icon: Play, color: 'bg-amber-100 text-amber-700' },
  paused: { label: 'Paused', icon: Pause, color: 'bg-blue-100 text-blue-700' },
  done: { label: 'Done', icon: CheckCircle2, color: 'bg-green-100 text-green-700' },
};

/* ── Package → colour mapping (from Lean Living branding) ── */
const PACKAGE_COLORS = {
  mwl:  { bg: 'bg-blue-100',   border: 'border-blue-300',   badge: 'bg-blue-200 text-blue-800',   label: 'MWL / BYO', text: 'text-blue-900' },
  byo:  { bg: 'bg-blue-100',   border: 'border-blue-300',   badge: 'bg-blue-200 text-blue-800',   label: 'BYO',       text: 'text-blue-900' },
  wwl:  { bg: 'bg-pink-100',   border: 'border-pink-300',   badge: 'bg-pink-200 text-pink-800',   label: 'WWL',       text: 'text-pink-900' },
  mlm:  { bg: 'bg-green-100',  border: 'border-green-300',  badge: 'bg-green-200 text-green-800', label: 'MLM',       text: 'text-green-900' },
  wlm:  { bg: 'bg-orange-100', border: 'border-orange-300', badge: 'bg-orange-200 text-orange-800', label: 'WLM',     text: 'text-orange-900' },
  lc:   { bg: 'bg-yellow-100', border: 'border-yellow-300', badge: 'bg-yellow-200 text-yellow-800', label: 'Low Carb', text: 'text-yellow-900' },
};

const DEFAULT_PKG = { bg: 'bg-muted/30', border: 'border-border', badge: 'bg-muted text-muted-foreground', label: '', text: '' };

/* ── Detect package type from SKU prefix ── */
function detectPackage(sku) {
  if (!sku) return 'unknown';
  const s = sku.toUpperCase();
  // Portion SKUs: MLM3, MWL5, WWL2, WLM4, LC-XXX, SCP (Low Carb)
  if (s.startsWith('MLM'))  return 'mlm';
  if (s.startsWith('MWL'))  return 'mwl';
  if (s.startsWith('WWL'))  return 'wwl';
  if (s.startsWith('WLM'))  return 'wlm';
  if (s.startsWith('LC') || s.startsWith('SCP')) return 'lc';
  if (s.startsWith('BYO'))  return 'byo';
  // Fallback: check if name has clues
  return 'unknown';
}

function detectPackageFromName(name) {
  if (!name) return 'unknown';
  const n = name.toLowerCase();
  if (n.includes("men's lean muscle") || n.includes('mlm'))  return 'mlm';
  if (n.includes("men's weight loss") || n.includes('mwl'))  return 'mwl';
  if (n.includes("women's weight loss") || n.includes('wwl')) return 'wwl';
  if (n.includes("women's lean muscle") || n.includes('wlm')) return 'wlm';
  if (n.includes('low carb') || n.includes('lc'))             return 'lc';
  if (n.includes('build your own') || n.includes('byo'))      return 'byo';
  return 'unknown';
}

/* ── Extract base meal name for grouping (strip prefix like MLM3, MWL5 etc.) ── */
function baseMealName(task) {
  const name = task.meal_name || task.name || '';
  // Try to get a generic meal name by removing leading SKU-like prefix and trailing portion info
  return name.trim();
}

/* ── Group tasks by base meal, then sort so same-meal tasks are adjacent ── */
function groupAndSortTasks(tasks) {
  // Group by meal_name to cluster same-meal-different-packages together
  const groups = {};
  tasks.forEach(task => {
    const key = baseMealName(task);
    if (!groups[key]) groups[key] = [];
    groups[key].push(task);
  });

  // Sort groups alphabetically by meal name, then within each group sort by package type
  const PKG_ORDER = { mlm: 0, mwl: 1, byo: 2, wwl: 3, wlm: 4, lc: 5, unknown: 6 };
  const sortedGroupKeys = Object.keys(groups).sort();

  const result = [];
  let groupIndex = 0;
  for (const key of sortedGroupKeys) {
    const groupTasks = groups[key].sort((a, b) => {
      const pa = PKG_ORDER[detectPackage(a.product_sku)] ?? 6;
      const pb = PKG_ORDER[detectPackage(b.product_sku)] ?? 6;
      return pa - pb;
    });
    groupTasks.forEach(t => result.push({ task: t, groupIndex, groupKey: key }));
    groupIndex++;
  }
  return result;
}

/* ── Zebra stripes for meal groups ── */
const ZEBRA = ['bg-background', 'bg-muted/20'];

function TaskTimer({ task, logs = [] }) {
  if (task.status === 'in_progress' && task.started_at) {
    return <LiveTimer startedAt={task.started_at} isActive={true} logs={logs} className="font-mono text-xs text-amber-700 dark:text-amber-400 tabular-nums" />;
  }
  if (task.status === 'done' && task.started_at && task.finished_at) {
    const duration = new Date(task.finished_at).getTime() - new Date(task.started_at).getTime();
    return <span className="font-mono text-xs text-green-600 tabular-nums">✓ {formatDuration(duration)}</span>;
  }
  if (task.status === 'paused' && task.started_at) {
    return <LiveTimer startedAt={task.started_at} isActive={false} logs={logs} className="font-mono text-xs text-blue-600 tabular-nums" />;
  }
  return null;
}

export default function KanbanPortionColumn({ station, tasks, onStatusChange, taskLogs = [] }) {
  const doneCount = tasks.filter(t => t.status === 'done').length;
  const activeCount = tasks.filter(t => t.status === 'in_progress').length;

  const grouped = useMemo(() => groupAndSortTasks(tasks), [tasks]);

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
            const pkg = detectPackage(task.product_sku);
            const pkgColor = PACKAGE_COLORS[pkg] || (pkg === 'unknown' ? PACKAGE_COLORS[detectPackageFromName(task.meal_name)] || DEFAULT_PKG : DEFAULT_PKG);
            const zebraClass = ZEBRA[groupIndex % 2];

            // Show group header when first task in a new group
            const isFirstInGroup = idx === 0 || grouped[idx - 1].groupKey !== groupKey;

            return (
              <React.Fragment key={task.id}>
                {isFirstInGroup && (
                  <div className={cn("px-3 py-1.5 rounded-t-lg text-xs font-semibold text-muted-foreground uppercase tracking-wider mt-2", zebraClass)}>
                    {groupKey}
                  </div>
                )}
                <div className={cn(
                  "border rounded-lg p-3 space-y-2 transition-all",
                  pkgColor.bg, pkgColor.border,
                  task.status === 'in_progress' && "ring-2 ring-amber-300",
                  task.status === 'done' && "opacity-50"
                )}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <p className={cn("text-sm font-semibold truncate", pkgColor.text)}>{task.meal_name || task.name}</p>
                      {task.product_sku && (
                        <p className={cn("text-[10px] font-mono opacity-70", pkgColor.text || 'text-muted-foreground')}>{task.product_sku}</p>
                      )}
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {pkgColor.label && (
                        <Badge className={cn("text-[10px]", pkgColor.badge)}>
                          {pkgColor.label}
                        </Badge>
                      )}
                      <Badge className={cn("text-[10px]", config.color)}>
                        <Icon className="w-3 h-3 mr-1" />{config.label}
                      </Badge>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {task.qty && (
                      <p className={cn("text-xs opacity-80", pkgColor.text || 'text-muted-foreground')}>Qty: <strong>{task.qty}</strong></p>
                    )}
                    {task.assigned_name && (
                      <Badge variant="outline" className="text-[10px]">{task.assigned_name}</Badge>
                    )}
                    <div className="ml-auto">
                      <TaskTimer task={task} logs={taskLogs.filter(l => l.task_id === task.id)} />
                    </div>
                  </div>
                  {task.notes && (
                    <p className="text-xs text-muted-foreground line-clamp-2">{task.notes}</p>
                  )}
                  <div className="flex items-center gap-1.5">
                    {task.status === 'pending' && (
                      <Button size="sm" className="h-12 flex-1 gap-1.5 text-sm text-white bg-green-500 hover:bg-green-600" onClick={() => onStatusChange(task.id, 'in_progress')}>
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
                      <Button size="sm" className="h-12 flex-1 gap-1.5 text-sm text-white bg-green-500 hover:bg-green-600" onClick={() => onStatusChange(task.id, 'in_progress')}>
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
              </React.Fragment>
            );
          })
        )}
      </div>
    </div>
  );
}