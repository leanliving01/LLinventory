import React, { useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ArrowLeft, Pause, CheckCircle2, Play, Wrench, Package, BookOpen, ListChecks, Clock } from 'lucide-react';
import { cn } from '@/lib/utils';
import LiveTimer, { formatDuration } from '@/components/kitchen/LiveTimer';

/**
 * Full-page drill-down for an active production task.
 * Shows recipe components, operations/steps, notes, and action buttons.
 */
export default function FloorTaskDetail({ task, taskLogs, onStatusChange, onBack, onDone, loading }) {
  const isActive = task.status === 'in_progress';
  const isPaused = task.status === 'paused';

  // Fetch the BOM for this product + station
  const { data: boms = [] } = useQuery({
    queryKey: ['task-bom', task.product_id, task.station],
    queryFn: () => base44.entities.Bom.filter({ product_id: task.product_id, bom_type: task.station, is_active: true }),
    enabled: !!task.product_id,
  });

  const bom = boms[0] || null;

  // Fetch BOM components
  const { data: components = [] } = useQuery({
    queryKey: ['task-bom-components', bom?.id],
    queryFn: () => base44.entities.BomComponent.filter({ bom_id: bom.id }),
    enabled: !!bom?.id,
  });

  // Fetch BOM operations (steps)
  const { data: operations = [] } = useQuery({
    queryKey: ['task-bom-operations', bom?.id],
    queryFn: () => base44.entities.BomOperation.filter({ bom_id: bom.id }, 'step_no', 50),
    enabled: !!bom?.id,
  });

  // Scale components by task qty vs bom yield
  const scaledComponents = useMemo(() => {
    if (!bom || components.length === 0) return [];
    const scale = bom.yield_qty ? (task.qty || 1) / bom.yield_qty : 1;
    return components.map(c => ({
      ...c,
      scaled_qty: Math.round(c.qty * scale * 100) / 100,
    }));
  }, [components, bom, task.qty]);

  const ingredients = scaledComponents.filter(c => !c.is_consumable);
  const consumables = scaledComponents.filter(c => c.is_consumable);

  const stationLabel = { prep: 'Preparation', cook: 'Cooking', portion: 'Portioning' }[task.station] || task.station;
  const stationColor = { prep: 'bg-blue-500', cook: 'bg-amber-500', portion: 'bg-green-500' }[task.station] || 'bg-primary';
  const btnColor = { prep: 'bg-blue-500 hover:bg-blue-600', cook: 'bg-amber-500 hover:bg-amber-600', portion: 'bg-green-500 hover:bg-green-600' }[task.station] || 'bg-primary';

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={onBack} className="shrink-0 -ml-2">
          <ArrowLeft className="w-4 h-4 mr-1" /> Back
        </Button>
        <Badge className={cn("text-white text-xs", stationColor)}>{stationLabel}</Badge>
      </div>

      {/* Task title + qty */}
      <div className="bg-card border-2 border-border rounded-2xl p-5">
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="flex-1 min-w-0">
            <h1 className="text-2xl font-bold leading-tight">{task.meal_name || task.name}</h1>
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              {task.product_sku && (
                <span className="text-sm font-mono text-muted-foreground">{task.product_sku}</span>
              )}
              {task.name && task.meal_name && task.name !== task.meal_name && (
                <Badge variant="outline" className="text-xs">{task.name}</Badge>
              )}
            </div>
          </div>
          <div className="text-right shrink-0">
            <div className="text-3xl font-bold tabular-nums">{task.qty || '—'}</div>
            <span className="text-sm text-muted-foreground">{task.qty_uom || 'units'}</span>
          </div>
        </div>

        {/* Metadata */}
        <div className="flex items-center gap-2 flex-wrap">
          {task.total_batches > 1 && (
            <Badge className="bg-purple-100 text-purple-700">Batch {task.batch_number}/{task.total_batches}</Badge>
          )}
          {task.equipment_name && (
            <Badge variant="outline" className="gap-1"><Wrench className="w-3 h-3" /> {task.equipment_name}</Badge>
          )}
          {task.assigned_name && (
            <Badge variant="outline">{task.assigned_name}</Badge>
          )}
        </div>
      </div>

      {/* Live timer card */}
      <div className="bg-card border-2 border-border rounded-2xl p-4 flex items-center justify-center">
        {isActive && task.started_at && (
          <div className="flex items-center gap-3">
            <Clock className="w-6 h-6 text-amber-500" />
            <LiveTimer startedAt={task.started_at} isActive={true} logs={taskLogs} className="font-mono text-3xl font-bold text-amber-600 dark:text-amber-400 tabular-nums" />
          </div>
        )}
        {isPaused && task.started_at && (
          <div className="flex items-center gap-3">
            <Pause className="w-6 h-6 text-blue-600" />
            <LiveTimer startedAt={task.started_at} isActive={false} logs={taskLogs} className="font-mono text-3xl font-bold text-blue-600 tabular-nums" />
            <Badge className="bg-blue-100 text-blue-700">PAUSED</Badge>
          </div>
        )}
      </div>

      {/* Recipe Components */}
      {ingredients.length > 0 && (
        <div className="bg-card border rounded-2xl overflow-hidden">
          <div className="px-4 py-3 border-b bg-muted/30 flex items-center gap-2">
            <Package className="w-4 h-4 text-muted-foreground" />
            <h2 className="font-bold text-sm">Ingredients</h2>
          </div>
          <div className="divide-y">
            {ingredients.map(c => (
              <div key={c.id} className="px-4 py-3 flex items-center justify-between">
                <div className="min-w-0">
                  <p className="font-medium text-sm truncate">{c.input_product_name}</p>
                  <p className="text-xs font-mono text-muted-foreground">{c.input_product_sku}</p>
                </div>
                <span className="font-bold tabular-nums text-sm shrink-0 ml-3">
                  {c.scaled_qty} {c.uom}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Consumables */}
      {consumables.length > 0 && (
        <div className="bg-card border rounded-2xl overflow-hidden">
          <div className="px-4 py-3 border-b bg-muted/30 flex items-center gap-2">
            <Package className="w-4 h-4 text-muted-foreground" />
            <h2 className="font-bold text-sm">Consumables</h2>
          </div>
          <div className="divide-y">
            {consumables.map(c => (
              <div key={c.id} className="px-4 py-3 flex items-center justify-between">
                <div className="min-w-0">
                  <p className="font-medium text-sm truncate">{c.input_product_name}</p>
                  <p className="text-xs font-mono text-muted-foreground">{c.input_product_sku}</p>
                </div>
                <span className="font-bold tabular-nums text-sm shrink-0 ml-3">
                  {c.scaled_qty} {c.uom}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Steps / Operations */}
      {operations.length > 0 && (
        <div className="bg-card border rounded-2xl overflow-hidden">
          <div className="px-4 py-3 border-b bg-muted/30 flex items-center gap-2">
            <ListChecks className="w-4 h-4 text-muted-foreground" />
            <h2 className="font-bold text-sm">Steps</h2>
          </div>
          <div className="divide-y">
            {operations.map((op, idx) => (
              <div key={op.id} className="px-4 py-3">
                <div className="flex items-center gap-2 mb-1">
                  <span className="w-6 h-6 rounded-full bg-muted flex items-center justify-center text-xs font-bold shrink-0">{op.step_no || idx + 1}</span>
                  <p className="font-medium text-sm">{op.name}</p>
                  {op.cycle_time_min && (
                    <Badge variant="outline" className="text-[10px] ml-auto shrink-0">{op.cycle_time_min} min</Badge>
                  )}
                </div>
                {op.notes && (
                  <p className="text-xs text-muted-foreground ml-8 leading-relaxed whitespace-pre-wrap">{op.notes}</p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Recipe Notes */}
      {task.notes && task.notes !== 'Kitchen Cooking' && task.notes !== 'Kitchen Prep' && task.notes !== 'Portioning' && (
        <div className="bg-card border rounded-2xl overflow-hidden">
          <div className="px-4 py-3 border-b bg-muted/30 flex items-center gap-2">
            <BookOpen className="w-4 h-4 text-muted-foreground" />
            <h2 className="font-bold text-sm">Recipe Notes</h2>
          </div>
          <div className="px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap">
            {task.notes}
          </div>
        </div>
      )}

      {/* BOM notes */}
      {bom?.notes && (
        <div className="bg-card border rounded-2xl overflow-hidden">
          <div className="px-4 py-3 border-b bg-muted/30 flex items-center gap-2">
            <BookOpen className="w-4 h-4 text-muted-foreground" />
            <h2 className="font-bold text-sm">Recipe Info</h2>
          </div>
          <div className="px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap">
            {bom.notes}
          </div>
        </div>
      )}

      {/* No recipe data placeholder */}
      {!bom && components.length === 0 && operations.length === 0 && (
        <div className="text-center py-8">
          <p className="text-muted-foreground text-sm">No recipe details available for this task.</p>
        </div>
      )}

      {/* Action buttons — sticky at bottom */}
      <div className="sticky bottom-0 pb-4 pt-2 bg-background/95 backdrop-blur-sm flex items-center gap-3">
        {isActive && (
          <>
            <Button disabled={loading} variant="outline" onClick={() => onStatusChange(task.id, 'paused')}
              className="h-16 flex-1 gap-2 text-lg font-bold rounded-xl">
              <Pause className="w-6 h-6" /> Pause
            </Button>
            <Button disabled={loading} onClick={() => onDone(task)}
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
      </div>
    </div>
  );
}