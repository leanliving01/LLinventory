import React, { useState, useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { ArrowLeft, Pause, CheckCircle2, Play, Clock, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';

function formatDuration(ms) {
  if (!ms || ms <= 0) return '00:00:00';
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function LiveTimer({ startedAt }) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!startedAt) return;
    const start = new Date(startedAt).getTime();
    const tick = () => setElapsed(Date.now() - start);
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [startedAt]);
  return <span className="font-mono text-2xl font-bold tabular-nums">{formatDuration(elapsed)}</span>;
}

const STATION_COLORS = {
  prep: { bg: 'bg-blue-600', text: 'text-blue-600', light: 'bg-blue-50 dark:bg-blue-950' },
  cook: { bg: 'bg-amber-600', text: 'text-amber-600', light: 'bg-amber-50 dark:bg-amber-950' },
  portion: { bg: 'bg-green-600', text: 'text-green-600', light: 'bg-green-50 dark:bg-green-950' },
};

export default function TaskDetailView({ task, onStatusChange, onBack, loading }) {
  const [consumed, setConsumed] = useState({});
  const [wastage, setWastage] = useState({});
  const colors = STATION_COLORS[task.station] || STATION_COLORS.cook;

  // Load BOM and components for this task's product
  const { data: boms = [] } = useQuery({
    queryKey: ['boms-for-detail', task.product_id],
    queryFn: () => base44.entities.Bom.filter({ product_id: task.product_id, is_active: true }, '-created_date', 10),
    enabled: !!task.product_id,
  });

  const { data: allComponents = [] } = useQuery({
    queryKey: ['bom-components-all-detail'],
    queryFn: () => base44.entities.BomComponent.list('-created_date', 2000),
  });

  const { data: products = [] } = useQuery({
    queryKey: ['products-for-detail'],
    queryFn: () => base44.entities.Product.filter({ status: 'active' }, 'name', 500),
  });

  const productMap = useMemo(() => {
    const map = {};
    products.forEach(p => { map[p.id] = p; });
    return map;
  }, [products]);

  const relevantBom = useMemo(() => {
    if (task.station === 'cook') return boms.find(b => b.bom_type === 'cook');
    if (task.station === 'portion') return boms.find(b => b.bom_type === 'portion');
    if (task.station === 'prep') return boms.find(b => b.bom_type === 'cook') || boms.find(b => b.bom_type === 'portion');
    return boms[0];
  }, [boms, task.station]);

  const ingredients = useMemo(() => {
    if (!relevantBom) return [];
    const comps = allComponents.filter(c => c.bom_id === relevantBom.id);
    const yieldQty = relevantBom.yield_qty || 1;
    return comps.map(c => {
      const perUnit = c.qty / yieldQty;
      const totalRequired = Math.round(perUnit * (task.qty || 1) * 100) / 100;
      const product = productMap[c.input_product_id];
      return {
        id: c.id,
        name: c.input_product_name || product?.name || 'Unknown',
        sku: c.input_product_sku || product?.sku || '',
        uom: c.uom || product?.stock_uom || '',
        required: totalRequired,
      };
    });
  }, [relevantBom, allComponents, task.qty, productMap]);

  const isActive = task.status === 'in_progress';
  const isPaused = task.status === 'paused';
  const isPending = task.status === 'pending';
  const isDone = task.status === 'done';

  const completedDuration = isDone && task.started_at && task.finished_at
    ? new Date(task.finished_at).getTime() - new Date(task.started_at).getTime()
    : null;

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header bar */}
      <div className={cn("px-4 py-3 text-white flex items-center gap-3", colors.bg)}>
        <Button variant="ghost" size="icon" onClick={onBack} className="text-white hover:bg-white/20 shrink-0">
          <ArrowLeft className="w-6 h-6" />
        </Button>
        <div className="flex-1 min-w-0">
          <h1 className="text-lg font-bold truncate">{task.name} — {task.station?.toUpperCase()}</h1>
          <p className="text-sm text-white/80 truncate">{task.meal_name}</p>
        </div>
      </div>

      {/* Quantity + Timer strip */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-border bg-card">
        <div>
          <p className="text-xs text-muted-foreground uppercase tracking-wider">Quantity</p>
          <p className="text-3xl font-bold">{task.qty || 1}</p>
        </div>
        <div className="text-right">
          <p className="text-xs text-muted-foreground uppercase tracking-wider">Time</p>
          {isActive && task.started_at && <LiveTimer startedAt={task.started_at} />}
          {isPaused && <span className="font-mono text-2xl font-bold text-blue-600 tabular-nums">Paused</span>}
          {isPending && <span className="font-mono text-2xl font-bold text-muted-foreground tabular-nums">00:00:00</span>}
          {isDone && <span className="font-mono text-2xl font-bold text-green-600 tabular-nums">{formatDuration(completedDuration)}</span>}
        </div>
        {task.assigned_name && (
          <div className="text-right">
            <p className="text-xs text-muted-foreground uppercase tracking-wider">Assigned</p>
            <p className="text-sm font-semibold">{task.assigned_name}</p>
          </div>
        )}
      </div>

      {/* Action buttons */}
      <div className="px-4 py-3 flex gap-3 border-b border-border bg-card">
        {isPending && (
          <Button
            disabled={loading}
            onClick={() => onStatusChange(task.id, 'in_progress')}
            className={cn("h-14 flex-1 gap-2 text-lg font-bold rounded-xl text-white", colors.bg)}
          >
            <Play className="w-6 h-6" /> START
          </Button>
        )}
        {isActive && (
          <>
            <Button
              disabled={loading}
              variant="outline"
              onClick={() => onStatusChange(task.id, 'paused')}
              className="h-14 flex-1 gap-2 text-lg font-bold rounded-xl"
            >
              <Pause className="w-6 h-6" /> PAUSE
            </Button>
            <Button
              disabled={loading}
              onClick={() => onStatusChange(task.id, 'done')}
              className="h-14 flex-1 gap-2 text-lg font-bold bg-green-600 hover:bg-green-700 rounded-xl text-white"
            >
              <CheckCircle2 className="w-6 h-6" /> DONE
            </Button>
          </>
        )}
        {isPaused && (
          <Button
            disabled={loading}
            onClick={() => onStatusChange(task.id, 'in_progress')}
            className={cn("h-14 flex-1 gap-2 text-lg font-bold rounded-xl text-white", colors.bg)}
          >
            <Play className="w-6 h-6" /> RESUME
          </Button>
        )}
        {isDone && (
          <Button
            disabled={loading}
            variant="outline"
            onClick={() => onStatusChange(task.id, 'undo')}
            className="h-14 flex-1 gap-2 text-lg font-bold text-amber-600 border-amber-300 rounded-xl"
          >
            Undo Done
          </Button>
        )}
      </div>

      {/* Ingredients / To Consume */}
      <div className="flex-1 overflow-y-auto">
        <div className="px-4 py-3">
          <h2 className="text-sm font-bold uppercase tracking-wider text-muted-foreground mb-3">
            Ingredients to Consume
          </h2>
        </div>

        {ingredients.length === 0 ? (
          <div className="px-4 py-8 text-center">
            <p className="text-muted-foreground text-sm">No recipe ingredients found for this task.</p>
            <p className="text-xs text-muted-foreground mt-1">Check that the recipe has components linked.</p>
          </div>
        ) : (
          <div className="px-4 space-y-3 pb-6">
            {ingredients.map(ing => {
              const consumedVal = consumed[ing.id] ?? '';
              const wastageVal = wastage[ing.id] ?? '';
              return (
                <div key={ing.id} className="bg-card border border-border rounded-xl p-4">
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <Badge className="mb-1.5 text-[10px]" variant="secondary">Ingredient</Badge>
                      <p className="text-base font-bold">{ing.name}</p>
                      <p className="text-xs text-muted-foreground font-mono">{ing.sku}</p>
                    </div>
                    <Badge variant="outline" className="text-xs shrink-0">{ing.uom}</Badge>
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">Required:</span>
                      <span className="text-sm font-bold">{ing.required}</span>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-sm text-muted-foreground">Consumed:</span>
                      <Input
                        type="number"
                        step="0.01"
                        placeholder="0"
                        value={consumedVal}
                        onChange={e => setConsumed(prev => ({ ...prev, [ing.id]: e.target.value }))}
                        className="w-28 h-9 text-right"
                      />
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-sm text-muted-foreground flex items-center gap-1">
                        <Trash2 className="w-3.5 h-3.5 text-red-400" /> Wastage:
                      </span>
                      <Input
                        type="number"
                        step="0.01"
                        placeholder="0"
                        value={wastageVal}
                        onChange={e => setWastage(prev => ({ ...prev, [ing.id]: e.target.value }))}
                        className="w-28 h-9 text-right border-red-200 focus-visible:ring-red-300"
                      />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Recipe notes at bottom */}
      {task.notes && task.notes !== 'Kitchen Cooking' && task.notes !== 'Kitchen Prep' && task.notes !== 'Portioning' && (
        <div className="px-4 py-3 border-t border-border bg-muted/30">
          <p className="text-xs font-semibold text-muted-foreground uppercase mb-1">Notes</p>
          <p className="text-sm whitespace-pre-wrap">{task.notes}</p>
        </div>
      )}
    </div>
  );
}