import React, { useState, useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { ArrowLeft, Pause, CheckCircle2, Play, ChevronDown, ChevronRight, UtensilsCrossed, FileText, Trash2 } from 'lucide-react';
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

const GENERIC_NOTES = ['Kitchen Cooking', 'Kitchen Prep', 'Portioning'];

export default function TaskDetailView({ task, onStatusChange, onBack, loading }) {
  const [consumed, setConsumed] = useState({});
  const [actualYield, setActualYield] = useState('');
  const [openSection, setOpenSection] = useState(null); // null | 'ingredients' | 'notes'
  const colors = STATION_COLORS[task.station] || STATION_COLORS.cook;
  const isPortioning = task.station === 'portion';

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
        perUnit,
      };
    });
  }, [relevantBom, allComponents, task.qty, productMap]);

  // For portioning: auto-calculate consumed from actual yield
  const portionCalculated = useMemo(() => {
    if (!isPortioning || !actualYield) return [];
    const yieldNum = Number(actualYield) || 0;
    return ingredients.map(ing => ({
      ...ing,
      calculated: Math.round(ing.perUnit * yieldNum * 100) / 100,
    }));
  }, [isPortioning, actualYield, ingredients]);

  const isActive = task.status === 'in_progress';
  const isPaused = task.status === 'paused';
  const isPending = task.status === 'pending';
  const isDone = task.status === 'done';

  const completedDuration = isDone && task.started_at && task.finished_at
    ? new Date(task.finished_at).getTime() - new Date(task.started_at).getTime()
    : null;

  // Collect all notes: task notes + BOM notes
  const taskNotes = task.notes && !GENERIC_NOTES.includes(task.notes) ? task.notes : null;
  const bomNotes = relevantBom?.notes || null;
  const hasNotes = !!(taskNotes || bomNotes);

  const toggleSection = (section) => {
    setOpenSection(prev => prev === section ? null : section);
  };

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header bar */}
      <div className={cn("px-4 py-3 text-white flex items-center gap-3", colors.bg)}>
        <Button variant="ghost" size="icon" onClick={onBack} className="text-white hover:bg-white/20 shrink-0">
          <ArrowLeft className="w-6 h-6" />
        </Button>
        <div className="flex-1 min-w-0">
          <h1 className="text-lg font-bold truncate">{task.meal_name || task.name}</h1>
          <p className="text-sm text-white/80 truncate">{task.name} — {task.station?.toUpperCase()}</p>
        </div>
      </div>

      {/* Quantity + Timer strip */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-border bg-card">
        <div>
          <p className="text-xs text-muted-foreground uppercase tracking-wider">
            {isPortioning ? 'Plates Required' : 'Quantity'}
          </p>
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

      {/* Portioning: Actual Yield input (always visible for portion station) */}
      {isPortioning && (
        <div className="px-4 py-4 border-b border-border bg-card">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-bold">Actual Plates Produced</p>
              <p className="text-xs text-muted-foreground">Enter how many finished plates you portioned</p>
            </div>
            <Input
              type="number"
              step="1"
              placeholder={String(task.qty || 0)}
              value={actualYield}
              onChange={e => setActualYield(e.target.value)}
              className="w-28 h-12 text-right text-lg font-bold"
            />
          </div>
          {actualYield && Number(actualYield) !== (task.qty || 0) && (
            <p className={cn(
              "text-xs font-medium mt-2",
              Number(actualYield) < (task.qty || 0) ? "text-amber-600" : "text-blue-600"
            )}>
              {Number(actualYield) < (task.qty || 0)
                ? `${(task.qty || 0) - Number(actualYield)} plates short of target`
                : `${Number(actualYield) - (task.qty || 0)} plates over target`}
            </p>
          )}
        </div>
      )}

      {/* Collapsible sections */}
      <div className="flex-1 overflow-y-auto">
        {/* Section: Ingredients */}
        <button
          onClick={() => toggleSection('ingredients')}
          className="w-full flex items-center gap-3 px-4 py-4 border-b border-border bg-card hover:bg-muted/50 active:bg-muted transition-colors text-left"
        >
          <UtensilsCrossed className="w-5 h-5 text-muted-foreground shrink-0" />
          <span className="text-sm font-bold uppercase tracking-wider flex-1">
            {isPortioning ? 'Recipe Breakdown' : 'Ingredients to Consume'}
          </span>
          <Badge variant="outline" className="text-[10px] mr-1">{ingredients.length}</Badge>
          {openSection === 'ingredients'
            ? <ChevronDown className="w-5 h-5 text-muted-foreground" />
            : <ChevronRight className="w-5 h-5 text-muted-foreground" />}
        </button>

        {openSection === 'ingredients' && (
          <div className="px-4 py-3 space-y-3 border-b border-border">
            {ingredients.length === 0 ? (
              <div className="py-6 text-center">
                <p className="text-muted-foreground text-sm">No recipe ingredients found for this task.</p>
                <p className="text-xs text-muted-foreground mt-1">Check that the recipe has components linked.</p>
              </div>
            ) : isPortioning ? (
              /* PORTIONING VIEW: Show ingredients with auto-calculated amounts */
              <div className="space-y-2">
                {(actualYield ? portionCalculated : ingredients).map(ing => (
                  <div key={ing.id} className="bg-muted/50 rounded-xl p-3 flex items-center justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold truncate">{ing.name}</p>
                      {ing.sku && <p className="text-[10px] font-mono text-muted-foreground">{ing.sku}</p>}
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-sm font-bold">
                        {actualYield && ing.calculated !== undefined
                          ? <><span className="text-green-600">{ing.calculated}</span> <span className="text-muted-foreground font-normal">/ {ing.required}</span></>
                          : ing.required
                        }
                      </p>
                      <p className="text-[10px] text-muted-foreground">{ing.uom}</p>
                    </div>
                  </div>
                ))}
                {!actualYield && (
                  <p className="text-xs text-muted-foreground text-center py-2">
                    Enter actual plates above to see calculated consumption
                  </p>
                )}
              </div>
            ) : (
              /* PREP / COOK VIEW: Show ingredients with consumed + wastage input */
              <div className="space-y-3">
                {ingredients.map(ing => {
                  const consumedVal = consumed[ing.id] ?? '';
                  return (
                    <div key={ing.id} className="bg-card border border-border rounded-xl p-4">
                      <div className="flex items-start justify-between mb-3">
                        <div>
                          <p className="text-base font-bold">{ing.name}</p>
                          {ing.sku && <p className="text-xs text-muted-foreground font-mono">{ing.sku}</p>}
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
                            <Trash2 className="w-3 h-3 text-red-500" /> Unusable Waste:
                          </span>
                          <Input
                            type="number"
                            step="0.01"
                            placeholder="0"
                            className="w-28 h-9 text-right"
                          />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Section: Notes & Resources */}
        <button
          onClick={() => toggleSection('notes')}
          className="w-full flex items-center gap-3 px-4 py-4 border-b border-border bg-card hover:bg-muted/50 active:bg-muted transition-colors text-left"
        >
          <FileText className="w-5 h-5 text-muted-foreground shrink-0" />
          <span className="text-sm font-bold uppercase tracking-wider flex-1">Notes & Resources</span>
          {hasNotes && <Badge variant="secondary" className="text-[10px] mr-1">Has notes</Badge>}
          {openSection === 'notes'
            ? <ChevronDown className="w-5 h-5 text-muted-foreground" />
            : <ChevronRight className="w-5 h-5 text-muted-foreground" />}
        </button>

        {openSection === 'notes' && (
          <div className="px-4 py-4 space-y-4 border-b border-border">
            {bomNotes && (
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Recipe Notes</p>
                <div className="bg-muted/50 rounded-xl p-4">
                  <p className="text-sm whitespace-pre-wrap leading-relaxed">{bomNotes}</p>
                </div>
              </div>
            )}
            {taskNotes && (
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Task Notes</p>
                <div className="bg-muted/50 rounded-xl p-4">
                  <p className="text-sm whitespace-pre-wrap leading-relaxed">{taskNotes}</p>
                </div>
              </div>
            )}
            {!hasNotes && (
              <p className="text-sm text-muted-foreground text-center py-4">No notes or resources for this task.</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}