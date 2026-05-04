import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Zap, Check, Loader2, ArrowDown } from 'lucide-react';
import { toast } from 'sonner';

/**
 * "To Consume" tab — shows BOM components with Required / Consumed / Wastage fields.
 * Auto-saves each row individually on field change (debounced 300ms).
 * Data persists across navigation — no manual Save button needed.
 *
 * For cook tasks that follow a prep step (step > 1, same product):
 *   - Shows the WIP output from prep as "Available from Prep"
 *   - Shows the original BOM-required qty (before yield cascade) as "Required"
 *   - Only shows step-specific consumables (oil, spice), NOT raw ingredients already used in prep
 *
 * Exposes `flushPendingSaves()` via ref so parent can force-save before task completion.
 */
export default function ConsumeTab({ task, bom, components, onRef }) {
  const queryClient = useQueryClient();

  // Detect if this is a cook/prep task with step > 1 that has a completed predecessor
  const isCookAfterPrep = task.station === 'cook' && (task.step_no || 0) > 1;

  // Fetch sibling prep task for this product in the same run (to get original planned qty)
  const { data: siblingTasks = [] } = useQuery({
    queryKey: ['sibling-prep-task', task.run_id, task.product_id],
    queryFn: () => base44.entities.ProductionTask.filter({
      run_id: task.run_id,
      product_id: task.product_id,
      station: 'prep',
    }),
    enabled: isCookAfterPrep && !!task.run_id && !!task.product_id,
  });

  // The prep task's qty = original BOM-derived requirement (before yield cascade)
  const prepTask = siblingTasks.find(t => t.status === 'done');
  const originalRequiredQty = prepTask ? prepTask.qty : null;
  const availableFromPrep = isCookAfterPrep ? task.qty : null;

  // Use the original required qty (before cascade) for scaling BOM ingredients
  // If this is a cook-after-prep, scale to the ORIGINAL planned qty, not the cascaded qty
  const scaleQty = (isCookAfterPrep && originalRequiredQty != null) ? originalRequiredQty : (task.qty || 1);
  const scale = bom?.yield_qty ? scaleQty / bom.yield_qty : 1;

  // Scale components from BOM — this is the authoritative "required" qty for THIS task.
  // We do NOT use pick list totals here because the pick list aggregates across ALL tasks
  // in the run, which would show inflated numbers for individual cook tasks.
  const scaledComponents = useMemo(() => {
    if (!components || components.length === 0) return [];
    return components.map(c => ({
      ...c,
      required: Math.round(c.qty * scale * 100) / 100,
    }));
  }, [components, scale]);

  // Fetch existing TaskConsumption records for this task
  const { data: existing = [] } = useQuery({
    queryKey: ['task-consumption', task.id],
    queryFn: () => base44.entities.TaskConsumption.filter({ task_id: task.id }),
    enabled: !!task.id,
  });

  // Local state: { [bom_component_id]: { consumed, wastage, recordId } }
  const [values, setValues] = useState({});
  // Track per-row save status: 'idle' | 'saving' | 'saved'
  const [rowStatus, setRowStatus] = useState({});
  const debounceTimers = useRef({});
  // Track whether initial seed has happened (don't auto-save on seed)
  const seeded = useRef(false);
  // Track which task we last seeded for — prevents re-seeding on re-renders
  const lastSeededTaskId = useRef(null);

  // Seed local state from existing records — ONLY on first load or task change.
  // We intentionally do NOT re-seed when `existing` or `scaledComponents` get new
  // references from React Query refetches, because that would overwrite user edits.
  useEffect(() => {
    // Skip if we already seeded for this task
    if (lastSeededTaskId.current === task.id) return;
    if (scaledComponents.length === 0) return;

    const map = {};
    scaledComponents.forEach(c => {
      const rec = existing.find(e => e.bom_component_id === c.id);
      map[c.id] = {
        consumed: rec ? String(rec.consumed_qty) : '',
        wastage: rec ? String(rec.wastage_qty) : '',
        recordId: rec?.id || null,
      };
    });
    seeded.current = false;
    lastSeededTaskId.current = task.id;
    setValues(map);
    // Mark seeded after state settles
    setTimeout(() => { seeded.current = true; }, 100);
  }, [task.id, existing, scaledComponents]);

  // Save a single row to the database
  const saveRow = useCallback(async (comp, rowValues) => {
    const v = rowValues || { consumed: '', wastage: '', recordId: null };
    setRowStatus(prev => ({ ...prev, [comp.id]: 'saving' }));
    const data = {
      task_id: task.id,
      run_id: task.run_id,
      bom_component_id: comp.id,
      input_product_id: comp.input_product_id,
      input_product_sku: comp.input_product_sku || '',
      input_product_name: comp.input_product_name || '',
      required_qty: comp.required,
      consumed_qty: parseFloat(v.consumed) || 0,
      wastage_qty: parseFloat(v.wastage) || 0,
      uom: comp.uom,
    };
    if (v.recordId) {
      await base44.entities.TaskConsumption.update(v.recordId, data);
    } else {
      const created = await base44.entities.TaskConsumption.create(data);
      // Store the new record ID so subsequent saves are updates
      setValues(prev => ({
        ...prev,
        [comp.id]: { ...prev[comp.id], recordId: created.id },
      }));
    }
    // Invalidate the completion modal's query so it picks up saved data
    queryClient.invalidateQueries({ queryKey: ['task-consumption-modal', task.id] });
    setRowStatus(prev => ({ ...prev, [comp.id]: 'saved' }));
    // Reset status after 2s
    setTimeout(() => {
      setRowStatus(prev => ({ ...prev, [comp.id]: 'idle' }));
    }, 2000);
  }, [task.id, task.run_id, queryClient]);

  // Flush all pending debounced saves immediately — call before unmount or task completion
  const flushPendingSaves = useCallback(async () => {
    const pending = Object.keys(debounceTimers.current);
    const promises = [];
    for (const compId of pending) {
      clearTimeout(debounceTimers.current[compId]);
      delete debounceTimers.current[compId];
      const comp = scaledComponents.find(c => c.id === compId);
      if (comp && valuesRef.current[compId]) {
        promises.push(saveRow(comp, valuesRef.current[compId]));
      }
    }
    if (promises.length > 0) await Promise.all(promises);
  }, [scaledComponents, saveRow]);

  // Keep a ref to current values so flush can read latest without stale closure
  const valuesRef = useRef(values);
  useEffect(() => { valuesRef.current = values; }, [values]);

  // Expose flushPendingSaves to parent via onRef callback
  useEffect(() => {
    if (onRef) onRef({ flushPendingSaves });
  }, [onRef, flushPendingSaves]);

  // Field change — schedule 300ms backup save (cancelled if blur fires first)
  const updateField = (compId, field, val) => {
    setValues(prev => {
      const next = {
        ...prev,
        [compId]: { ...prev[compId], [field]: val },
      };
      // Schedule debounced backup save
      if (seeded.current) {
        clearTimeout(debounceTimers.current[compId]);
        debounceTimers.current[compId] = setTimeout(() => {
          const comp = scaledComponents.find(c => c.id === compId);
          if (comp) saveRow(comp, next[compId]);
        }, 300);
      }
      return next;
    });
  };

  // Primary save trigger: blur (user taps out of the field)
  const handleBlur = (compId) => {
    if (!seeded.current) return;
    // Cancel any pending debounce — blur takes priority
    clearTimeout(debounceTimers.current[compId]);
    const comp = scaledComponents.find(c => c.id === compId);
    if (comp) saveRow(comp, values[compId]);
  };

  // Auto-consume: set all consumed = required qty from BOM
  const autoConsume = async () => {
    const next = {};
    scaledComponents.forEach(c => {
      next[c.id] = { ...values[c.id], consumed: String(c.required) };
    });
    setValues(next);
    // Save all rows
    for (const comp of scaledComponents) {
      await saveRow(comp, next[comp.id]);
    }
    queryClient.invalidateQueries({ queryKey: ['task-consumption', task.id] });
    toast.success('All set to required quantities and saved');
  };

  // Flush pending saves on unmount (so nothing is lost when navigating away)
  useEffect(() => {
    return () => {
      // Fire all pending saves before cleanup
      const pending = Object.keys(debounceTimers.current);
      for (const compId of pending) {
        clearTimeout(debounceTimers.current[compId]);
        const comp = scaledComponents.find(c => c.id === compId);
        if (comp && valuesRef.current[compId]) {
          // Fire-and-forget on unmount
          saveRow(comp, valuesRef.current[compId]);
        }
      }
      debounceTimers.current = {};
    };
  }, [scaledComponents, saveRow]);

  if (scaledComponents.length === 0 && !isCookAfterPrep) {
    return (
      <div className="text-center py-10">
        <p className="text-muted-foreground text-sm">No recipe components found for this task.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Cook-after-Prep: show WIP availability from the prep step */}
      {isCookAfterPrep && availableFromPrep != null && (
        <div className="bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-800 rounded-2xl p-4 space-y-2">
          <div className="flex items-center gap-2 mb-1">
            <ArrowDown className="w-4 h-4 text-blue-600" />
            <p className="text-xs font-semibold text-blue-700 dark:text-blue-400 uppercase tracking-wider">
              From Prep Step
            </p>
          </div>
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="font-bold text-sm">{task.meal_name || 'WIP Output'}</p>
              <p className="text-xs font-mono text-muted-foreground">{task.product_sku}</p>
            </div>
            <Badge variant="outline" className="text-[10px]">{task.qty_uom || 'kg'}</Badge>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <span className="text-[10px] text-muted-foreground uppercase tracking-wider block">Required (recipe)</span>
              <span className="text-lg font-bold tabular-nums">
                {originalRequiredQty != null
                  ? (Number.isInteger(originalRequiredQty) ? originalRequiredQty : Number(originalRequiredQty).toFixed(2))
                  : '—'}
              </span>
              <span className="text-xs text-muted-foreground ml-1">{task.qty_uom || 'kg'}</span>
            </div>
            <div>
              <span className="text-[10px] text-muted-foreground uppercase tracking-wider block">Available from Prep</span>
              <span className="text-lg font-bold tabular-nums text-blue-600 dark:text-blue-400">
                {Number.isInteger(availableFromPrep) ? availableFromPrep : Number(availableFromPrep).toFixed(2)}
              </span>
              <span className="text-xs text-muted-foreground ml-1">{task.qty_uom || 'kg'}</span>
            </div>
          </div>
          {availableFromPrep > (originalRequiredQty || 0) && (
            <p className="text-[11px] font-medium text-blue-600 dark:text-blue-400">
              +{(availableFromPrep - (originalRequiredQty || 0)).toFixed(2)} {task.qty_uom || 'kg'} extra from prep — you can cook more or set aside the surplus
            </p>
          )}
          {availableFromPrep < (originalRequiredQty || 0) && (
            <p className="text-[11px] font-medium text-amber-600">
              {((originalRequiredQty || 0) - availableFromPrep).toFixed(2)} {task.qty_uom || 'kg'} short from prep — yield was lower than planned
            </p>
          )}
        </div>
      )}

      {/* Consumables for this step (oil, spice, etc.) */}
      {scaledComponents.length > 0 && (
        <>
          {isCookAfterPrep && (
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Additional Ingredients for This Step
            </p>
          )}

          {/* Auto-consume button */}
          <Button variant="outline" size="sm" onClick={autoConsume} className="w-full gap-2">
            <Zap className="w-4 h-4" /> Auto-consume (set all to required)
          </Button>

          <p className="text-[11px] text-muted-foreground text-center">
            Changes auto-save — no need to press a save button
          </p>
        </>
      )}

      {/* Component rows */}
      {scaledComponents.map(c => {
        const v = values[c.id] || { consumed: '', wastage: '' };
        const status = rowStatus[c.id] || 'idle';
        return (
          <div key={c.id} className="bg-card border rounded-2xl p-4 space-y-2">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="font-semibold text-sm">{c.input_product_name}</p>
                <p className="text-xs font-mono text-muted-foreground">{c.input_product_sku}</p>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                {c.is_consumable && (
                  <Badge className="bg-purple-100 text-purple-700 text-[10px]">Consumable</Badge>
                )}
                {status === 'saving' && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
                {status === 'saved' && <Check className="w-4 h-4 text-green-600" />}
              </div>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Required:</span>
              <span className="font-bold tabular-nums">{c.required} {c.uom}</span>
            </div>

            <div className="flex items-center justify-between gap-3">
              <span className="text-sm text-muted-foreground shrink-0">Consumed:</span>
              <Input
                type="text"
                inputMode="decimal"
                value={v.consumed}
                onChange={(e) => updateField(c.id, 'consumed', e.target.value)}
                onBlur={() => handleBlur(c.id)}
                className="h-10 w-28 text-right tabular-nums font-semibold"
                placeholder="0"
              />
              <span className="text-xs text-muted-foreground shrink-0">{c.uom}</span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm text-muted-foreground shrink-0">Wastage:</span>
              <Input
                type="text"
                inputMode="decimal"
                value={v.wastage}
                onChange={(e) => updateField(c.id, 'wastage', e.target.value)}
                onBlur={() => handleBlur(c.id)}
                className="h-10 w-28 text-right tabular-nums font-semibold"
                placeholder="0"
              />
              <span className="text-xs text-muted-foreground shrink-0">{c.uom}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}