import React, { useState, useMemo, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { X, CheckCircle2, Loader2, AlertTriangle, ArrowDown } from 'lucide-react';
import { getPreviousStepInfo } from '@/lib/previousStepLookup';
import PreviousStepCard from '@/components/floor/task-detail/PreviousStepCard';

export default function TaskCompletionModal({ task, onConfirm, onCancel, cachedBoms, cachedComponents, cachedProducts, allTasks }) {
  const [actuals, setActuals] = useState({});
  const [wastage, setWastage] = useState({});
  const [actualYield, setActualYield] = useState('');
  const [platesProduced, setPlatesProduced] = useState('');
  const [portionLeftover, setPortionLeftover] = useState({}); // how much bulk WIP is left over after portioning
  const [varianceNote, setVarianceNote] = useState('');
  const [confirming, setConfirming] = useState(false);

  const isPortioning = task.station === 'portion';
  const isCookAfterPrep = task.station === 'cook' && (task.step_no || 0) > 1;

  // Shared previous-step lookup (works for cook-after-prep AND portioning)
  const prevStepInfo = useMemo(() => {
    if (!allTasks || !cachedBoms || !cachedComponents) return { hasPreviousStep: false, previousStation: null, items: [] };
    return getPreviousStepInfo(task, allTasks, cachedBoms, cachedComponents);
  }, [task, allTasks, cachedBoms, cachedComponents]);

  // Legacy fallback: fetch sibling prep task if allTasks not available
  const { data: siblingPrepTasks = [] } = useQuery({
    queryKey: ['sibling-prep-modal', task.run_id, task.product_id],
    queryFn: () => base44.entities.ProductionTask.filter({
      run_id: task.run_id,
      product_id: task.product_id,
      station: 'prep',
    }),
    enabled: isCookAfterPrep && !allTasks && !!task.run_id && !!task.product_id,
  });

  // Derive originalRequiredQty from shared lookup or legacy fallback
  const originalRequiredQty = useMemo(() => {
    if (prevStepInfo.hasPreviousStep && prevStepInfo.items.length > 0 && (isCookAfterPrep || isPortioning)) {
      return prevStepInfo.items[0].requiredQty;
    }
    if (isCookAfterPrep) {
      const prep = siblingPrepTasks.find(t => t.status === 'done');
      return prep ? prep.qty : null;
    }
    return null;
  }, [prevStepInfo, isCookAfterPrep, isPortioning, siblingPrepTasks]);

  const availableFromPrep = isCookAfterPrep ? task.qty : null;

  // Load existing TaskConsumption records (saved from ConsumeTab)
  const { data: existingConsumption = [] } = useQuery({
    queryKey: ['task-consumption-modal', task.id],
    queryFn: () => base44.entities.TaskConsumption.filter({ task_id: task.id }),
    enabled: !!task.id,
  });

  // Use pre-loaded data if available, otherwise fetch (fallback for other callers)
  const { data: fetchedBoms = [] } = useQuery({
    queryKey: ['boms-for-task', task.product_id],
    queryFn: () => base44.entities.Bom.filter({ product_id: task.product_id, is_active: true }, '-created_date', 10),
    enabled: !!task.product_id && !cachedBoms,
  });

  const { data: fetchedComponents = [] } = useQuery({
    queryKey: ['bom-components-all'],
    queryFn: () => base44.entities.BomComponent.list('-created_date', 2000),
    enabled: !cachedComponents,
  });

  const { data: fetchedProducts = [] } = useQuery({
    queryKey: ['products-for-cost'],
    queryFn: () => base44.entities.Product.filter({ status: 'active' }, 'name', 500),
    enabled: !cachedProducts,
  });

  // Filter cached BOMs to this product if provided as full list
  const boms = useMemo(() => {
    if (cachedBoms) return cachedBoms.filter(b => b.product_id === task.product_id && b.is_active !== false);
    return fetchedBoms;
  }, [cachedBoms, fetchedBoms, task.product_id]);
  const allComponents = cachedComponents || fetchedComponents;
  const products = cachedProducts || fetchedProducts;

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

  const componentRows = useMemo(() => {
    if (!relevantBom) return [];
    let comps = allComponents.filter(c => c.bom_id === relevantBom.id);
    // Filter by step: if task has a step_no, only show components assigned to that step (or "all steps" = 0/null)
    const taskStep = task.step_no || 0;
    if (taskStep > 0) {
      comps = comps.filter(c => !c.step_no || c.step_no === taskStep);
    }
    const yieldQty = relevantBom.yield_qty || 1;
    // For cook-after-prep, scale to the ORIGINAL planned qty (before yield cascade)
    const scaleQty = (isCookAfterPrep && originalRequiredQty != null) ? originalRequiredQty : (task.qty || 1);
    return comps.map(c => {
      const perUnit = c.qty / yieldQty;
      const totalRequired = Math.round(perUnit * scaleQty * 100) / 100;
      const product = productMap[c.input_product_id];
      const isBulkWip = product?.type === 'wip_bulk';
      // For portioning: check if we have actual availability from the cook step
      let available = totalRequired;
      if (isPortioning && prevStepInfo.hasPreviousStep) {
        const prevItem = prevStepInfo.items.find(it => it.productId === c.input_product_id);
        if (prevItem) available = prevItem.availableQty;
      }
      return {
        id: c.id,
        input_product_id: c.input_product_id,
        name: c.input_product_name || product?.name || 'Unknown',
        sku: c.input_product_sku || product?.sku || '',
        uom: c.uom || product?.stock_uom || '',
        required: totalRequired,
        picked: available, // For portioning with cook step: actual cook yield; otherwise = required
        perUnit,
        cost_per_unit: product?.cost_avg || 0,
        isBulkWip,
        is_consumable: c.is_consumable || false,
      };
    });
  }, [relevantBom, allComponents, task.qty, productMap, isCookAfterPrep, originalRequiredQty]);

  // Separate bulk WIP rows from packaging/consumable rows for portioning
  const bulkRows = useMemo(() => componentRows.filter(r => r.isBulkWip && !r.is_consumable), [componentRows]);
  const otherRows = useMemo(() => componentRows.filter(r => !r.isBulkWip || r.is_consumable), [componentRows]);

  // Track whether we've done the initial seed
  const [seeded, setSeeded] = useState(false);

  // Pre-fill actuals from saved TaskConsumption records, falling back to BOM-required.
  useEffect(() => {
    if (isPortioning || componentRows.length === 0 || seeded) return;

    const prefilled = {};
    const prefilledWaste = {};
    componentRows.forEach(r => {
      const saved = existingConsumption.find(e => e.bom_component_id === r.id);
      if (saved && saved.consumed_qty > 0) {
        prefilled[r.id] = saved.consumed_qty;
        prefilledWaste[r.id] = saved.wastage_qty || 0;
      } else {
        prefilled[r.id] = r.required;
      }
    });
    setActuals(prefilled);
    if (Object.values(prefilledWaste).some(v => v > 0)) {
      setWastage(prefilledWaste);
    }
    setSeeded(true);
  }, [componentRows, isPortioning, existingConsumption, seeded]);

  // Pre-fill portioning leftover with 0 (assume they used everything unless they say otherwise)
  useEffect(() => {
    if (isPortioning && bulkRows.length > 0 && Object.keys(portionLeftover).length === 0) {
      const prefilled = {};
      bulkRows.forEach(r => { prefilled[r.id] = '0'; });
      setPortionLeftover(prefilled);
    }
  }, [bulkRows, isPortioning]);

  const handleConfirm = async () => {
    setConfirming(true);

    if (isPortioning) {
      const plates = Number(platesProduced) || task.qty || 0;
      // Build consumption: bulk WIP = available minus leftover, packaging = auto-calc from plates
      const consumption = componentRows.map(r => {
        if (r.isBulkWip && !r.is_consumable) {
          // actual consumed = available - leftover
          const leftover = Number(portionLeftover[r.id]) || 0;
          const actualUsed = Math.round((r.picked - leftover) * 100) / 100;
          return {
            component_id: r.id,
            input_product_id: r.input_product_id,
            name: r.name,
            sku: r.sku,
            uom: r.uom,
            picked: r.picked,
            actual: Math.max(0, actualUsed),
            unusable_wastage: 0,
            cost_per_unit: r.cost_per_unit,
            is_portioning: true,
            is_bulk_wip: true,
          };
        }
        // Packaging / other: auto-calc from plates
        const calculated = Math.round(r.perUnit * plates * 100) / 100;
        return {
          component_id: r.id,
          input_product_id: r.input_product_id,
          name: r.name,
          sku: r.sku,
          uom: r.uom,
          picked: r.picked,
          actual: calculated,
          unusable_wastage: 0,
          cost_per_unit: r.cost_per_unit,
          is_portioning: true,
          is_bulk_wip: false,
        };
      });
      await onConfirm(task.id, consumption, {
        plates_produced: plates,
        variance_note: varianceNote.trim(),
      });
    } else {
      // Prep/Cook flow: manual actual + unusable wastage + actual yield
      const consumption = componentRows.map(r => ({
        component_id: r.id,
        input_product_id: r.input_product_id,
        name: r.name,
        sku: r.sku,
        uom: r.uom,
        picked: r.picked,
        actual: Number(actuals[r.id]) || 0,
        unusable_wastage: Number(wastage[r.id]) || 0,
        cost_per_unit: r.cost_per_unit,
        is_portioning: false,
      }));
      const yieldVal = actualYield !== '' ? Number(actualYield) : null;
      await onConfirm(task.id, consumption, {
        actual_yield: yieldVal,
      });
    }
    setConfirming(false);
  };

  const hasComponents = componentRows.length > 0;
  const plates = Number(platesProduced) || 0;
  const portionVariance = plates - (task.qty || 0);

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-card rounded-2xl border border-border w-full max-w-lg shadow-xl flex flex-col max-h-[85vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border shrink-0">
          <div>
            <h3 className="text-lg font-bold">Complete Task</h3>
            <p className="text-sm text-muted-foreground">{task.meal_name || task.name}</p>
          </div>
          <Button variant="ghost" size="icon" onClick={onCancel}>
            <X className="w-5 h-5" />
          </Button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {!hasComponents ? (
            <div className="text-center py-6">
              <p className="text-sm text-muted-foreground mb-2">No recipe ingredients found for this task.</p>
              <p className="text-xs text-muted-foreground">The task will be marked as done without consumption tracking.</p>
            </div>
          ) : isPortioning ? (
            /* ===== PORTIONING FLOW ===== */
            <>
              {/* From Cook Step — show what's available from cooking */}
              {prevStepInfo.hasPreviousStep && (
                <PreviousStepCard previousStation={prevStepInfo.previousStation} items={prevStepInfo.items} compact />
              )}

              {/* Step 1: Bulk leftover */}
              {bulkRows.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1.5">
                    <ArrowDown className="w-3 h-3" /> Bulk Ingredients — What's Left Over?
                  </p>
                  <p className="text-xs text-muted-foreground mb-3">
                    Enter how much of each bulk ingredient is left over after portioning. If nothing is left, leave it at 0. Leftover will be returned to stock.
                  </p>
                  <div className="space-y-3">
                    {bulkRows.map(row => {
                      const leftover = Number(portionLeftover[row.id]) || 0;
                      const used = Math.round((row.picked - leftover) * 100) / 100;
                      return (
                        <div key={row.id} className="bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-800 rounded-xl p-4 space-y-2">
                          <div className="flex items-center justify-between">
                            <div>
                              <p className="text-sm font-bold">{row.name}</p>
                              {row.sku && <p className="text-[10px] font-mono text-muted-foreground">{row.sku}</p>}
                            </div>
                            <Badge variant="outline" className="text-[10px]">{row.uom}</Badge>
                          </div>
                          <div className="grid grid-cols-2 gap-3">
                           <div>
                             <label className="text-[10px] text-muted-foreground uppercase tracking-wider">Required (from recipe)</label>
                             <p className="text-sm font-bold">{row.required} {row.uom}</p>
                             {row.picked !== row.required && (
                               <p className="text-[10px] text-blue-600 font-medium">Picked: {row.picked} {row.uom}</p>
                             )}
                           </div>
                            <div>
                              <label className="text-[10px] text-muted-foreground uppercase tracking-wider">Left Over</label>
                              <Input
                                type="text"
                                inputMode="decimal"
                                value={portionLeftover[row.id] ?? '0'}
                                onChange={e => setPortionLeftover(prev => ({ ...prev, [row.id]: e.target.value }))}
                                className="h-10 text-right text-base font-bold"
                              />
                            </div>
                          </div>
                          {leftover > 0 && (
                            <p className="text-[11px] font-medium text-green-600">
                              {leftover.toFixed(2)} {row.uom} returning to bulk stock · Used: {Math.max(0, used).toFixed(2)} {row.uom}
                            </p>
                          )}
                          {leftover === 0 && (
                            <p className="text-[11px] font-medium text-muted-foreground">
                              All {row.picked} {row.uom} used
                            </p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Step 2: Plates produced */}
              <div className="bg-green-50 dark:bg-green-950 border border-green-200 dark:border-green-800 rounded-xl p-4">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="text-sm font-bold">Total Plates Produced</p>
                    <p className="text-xs text-muted-foreground">Target: {task.qty || 0} plates</p>
                  </div>
                  <Input
                    type="number"
                    step="1"
                    placeholder={String(task.qty || 0)}
                    value={platesProduced}
                    onChange={e => setPlatesProduced(e.target.value)}
                    className="w-28 h-12 text-right text-lg font-bold"
                    autoFocus
                  />
                </div>
                {plates > 0 && portionVariance !== 0 && (
                  <div className="flex items-center gap-2 mt-2">
                    <AlertTriangle className="w-4 h-4 text-amber-500" />
                    <p className="text-xs font-medium text-amber-600">
                      {portionVariance < 0
                        ? `${Math.abs(portionVariance)} plates short of target`
                        : `${portionVariance} plates over target`}
                    </p>
                  </div>
                )}
              </div>

              {/* Auto-calculated packaging breakdown */}
              {otherRows.length > 0 && plates > 0 && (
                <div>
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                    Packaging (auto-calculated from plates)
                  </p>
                  <div className="space-y-2">
                    {otherRows.map(row => {
                      const calc = Math.round(row.perUnit * plates * 100) / 100;
                      const diff = Math.round((calc - row.picked) * 100) / 100;
                      return (
                        <div key={row.id} className="bg-muted/50 rounded-xl p-3 flex items-center justify-between gap-3">
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-semibold truncate">{row.name}</p>
                            {row.sku && <p className="text-[10px] font-mono text-muted-foreground">{row.sku}</p>}
                          </div>
                          <div className="text-right shrink-0">
                            <p className="text-sm font-bold">
                              <span className="text-green-600">{calc}</span>
                              <span className="text-muted-foreground font-normal"> / {row.picked} {row.uom}</span>
                            </p>
                            {diff < 0 && (
                              <p className="text-[10px] text-green-600 font-medium">
                                {Math.abs(diff)} {row.uom} returning to stock
                              </p>
                            )}
                            {diff > 0 && (
                              <p className="text-[10px] text-amber-600 font-medium">
                                {diff} {row.uom} extra deducted from stock
                              </p>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Variance Note */}
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                  Leftover / Variance Notes
                </p>
                <Textarea
                  placeholder="e.g. Moved to WIP bin 3, set aside for tomorrow's run, used for staff meals..."
                  value={varianceNote}
                  onChange={e => setVarianceNote(e.target.value)}
                  className="h-20"
                />
              </div>
            </>
          ) : (
            /* ===== PREP / COOK FLOW ===== */
            <>
              {/* From Previous Step context (cook-after-prep) */}
              {prevStepInfo.hasPreviousStep && (
                <PreviousStepCard previousStation={prevStepInfo.previousStation} items={prevStepInfo.items} compact />
              )}

              {/* Actual Yield */}
              <div className="bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-800 rounded-xl p-4">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="text-sm font-bold">Actual Yield</p>
                    <p className="text-xs text-muted-foreground">
                      {prevStepInfo.hasPreviousStep ? 'Recipe target' : 'Planned'}: {prevStepInfo.hasPreviousStep && originalRequiredQty != null
                        ? (Number.isInteger(originalRequiredQty) ? originalRequiredQty : Number(originalRequiredQty).toFixed(2))
                        : (task.qty != null ? (Number.isInteger(task.qty) ? task.qty : Number(task.qty).toFixed(2)) : '—')} {task.qty_uom || ''}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Input
                      type="text"
                      inputMode="decimal"
                      placeholder={String(task.qty || 0)}
                      value={actualYield}
                      onChange={e => setActualYield(e.target.value)}
                      className="w-28 h-12 text-right text-lg font-bold"
                    />
                    <span className="text-sm text-muted-foreground">{task.qty_uom || ''}</span>
                  </div>
                </div>
                {actualYield !== '' && Number(actualYield) !== (task.qty || 0) && (
                  <div className="flex items-center gap-2 mt-2">
                    <AlertTriangle className="w-4 h-4 text-amber-500" />
                    <p className="text-xs font-medium text-amber-600">
                      {Number(actualYield) < (task.qty || 0)
                        ? `${((task.qty || 0) - Number(actualYield)).toFixed(2)} ${task.qty_uom || ''} under planned`
                        : `${(Number(actualYield) - (task.qty || 0)).toFixed(2)} ${task.qty_uom || ''} over planned`}
                    </p>
                  </div>
                )}
                <p className="text-[10px] text-muted-foreground mt-2">
                  This yield will cascade to the next station — {task.station === 'prep' ? 'cook' : 'portioning'} will see the actual amount available.
                </p>
              </div>

              <p className="text-sm text-muted-foreground">
                Confirm actual quantities consumed for <strong>{task.meal_name || task.name}</strong>.
                Record any unusable waste (peels, skins, off-cuts).
              </p>

              <div className="space-y-3">
                {componentRows.map(row => {
                  const actual = actuals[row.id] ?? row.picked;
                  const waste = wastage[row.id] ?? '';
                  const diff = Number(actual) - row.picked;
                  return (
                    <div key={row.id} className="bg-muted/50 rounded-xl p-4 space-y-2">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-sm font-semibold">{row.name}</p>
                          {row.sku && <p className="text-[10px] font-mono text-muted-foreground">{row.sku}</p>}
                        </div>
                        <Badge variant="outline" className="text-[10px]">{row.uom}</Badge>
                      </div>
                      <div className="grid grid-cols-3 gap-3">
                        <div>
                          <label className="text-[10px] text-muted-foreground uppercase tracking-wider">Required</label>
                          <p className="text-sm font-bold">{row.required}</p>
                        </div>
                        <div>
                          <label className="text-[10px] text-muted-foreground uppercase tracking-wider">Consumed</label>
                          <Input
                            type="text"
                            inputMode="decimal"
                            value={actual}
                            onChange={e => setActuals(prev => ({ ...prev, [row.id]: e.target.value }))}
                            className="h-9 mt-0.5"
                          />
                        </div>
                        <div>
                          <label className="text-[10px] text-muted-foreground uppercase tracking-wider">Unusable Waste</label>
                          <Input
                            type="text"
                            inputMode="decimal"
                            placeholder="0"
                            value={waste}
                            onChange={e => setWastage(prev => ({ ...prev, [row.id]: e.target.value }))}
                            className="h-9 mt-0.5"
                          />
                        </div>
                      </div>
                      {diff !== 0 && (
                        <p className={`text-[11px] font-medium ${diff > 0 ? 'text-amber-600' : 'text-blue-600'}`}>
                          {diff > 0 ? `+${diff.toFixed(2)} over required` : `${Math.abs(diff).toFixed(2)} ${row.uom} less than required`}
                        </p>
                      )}
                      {Number(waste) > 0 && (
                        <p className="text-[11px] font-medium text-red-600">
                          {Number(waste).toFixed(2)} {row.uom} recorded as unusable waste (peels/off-cuts)
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-border shrink-0 flex gap-3">
          <Button variant="outline" className="flex-1 h-12" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            className="flex-1 h-12 gap-2 bg-green-600 hover:bg-green-700 text-white"
            onClick={handleConfirm}
            disabled={confirming || (isPortioning && platesProduced === '')}
          >
            {confirming ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
            Confirm Done
          </Button>
        </div>
      </div>
    </div>
  );
}