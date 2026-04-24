import React, { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { X, CheckCircle2, Loader2, AlertTriangle } from 'lucide-react';

export default function TaskCompletionModal({ task, onConfirm, onCancel }) {
  const [actuals, setActuals] = useState({});
  const [wastage, setWastage] = useState({});
  const [platesProduced, setPlatesProduced] = useState('');
  const [varianceNote, setVarianceNote] = useState('');
  const [confirming, setConfirming] = useState(false);

  const isPortioning = task.station === 'portion';

  // Load BOM and components
  const { data: boms = [] } = useQuery({
    queryKey: ['boms-for-task', task.product_id],
    queryFn: () => base44.entities.Bom.filter({ product_id: task.product_id, is_active: true }, '-created_date', 10),
    enabled: !!task.product_id,
  });

  const { data: allComponents = [] } = useQuery({
    queryKey: ['bom-components-all'],
    queryFn: () => base44.entities.BomComponent.list('-created_date', 2000),
  });

  const { data: products = [] } = useQuery({
    queryKey: ['products-for-cost'],
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

  const componentRows = useMemo(() => {
    if (!relevantBom) return [];
    const comps = allComponents.filter(c => c.bom_id === relevantBom.id);
    const yieldQty = relevantBom.yield_qty || 1;
    return comps.map(c => {
      const perUnit = c.qty / yieldQty;
      const totalRequired = Math.round(perUnit * (task.qty || 1) * 100) / 100;
      const product = productMap[c.input_product_id];
      return {
        id: c.id,
        input_product_id: c.input_product_id,
        name: c.input_product_name || product?.name || 'Unknown',
        sku: c.input_product_sku || product?.sku || '',
        uom: c.uom || product?.stock_uom || '',
        picked: totalRequired,
        perUnit,
        cost_per_unit: product?.cost_avg || 0,
      };
    });
  }, [relevantBom, allComponents, task.qty, productMap]);

  // Pre-fill actuals with picked values on first load (only for prep/cook)
  useMemo(() => {
    if (!isPortioning && componentRows.length > 0 && Object.keys(actuals).length === 0) {
      const prefilled = {};
      componentRows.forEach(r => { prefilled[r.id] = r.picked; });
      setActuals(prefilled);
    }
  }, [componentRows, isPortioning]);

  // For portioning: auto-calculate consumption from plates produced
  const portionCalculated = useMemo(() => {
    if (!isPortioning || !platesProduced) return [];
    const yieldNum = Number(platesProduced) || 0;
    return componentRows.map(row => ({
      ...row,
      calculated: Math.round(row.perUnit * yieldNum * 100) / 100,
    }));
  }, [isPortioning, platesProduced, componentRows]);

  const handleConfirm = async () => {
    setConfirming(true);

    if (isPortioning) {
      // Portioning flow: auto-calculated consumption, variance logged, no stock return
      const plates = Number(platesProduced) || task.qty || 0;
      const consumption = componentRows.map(r => {
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
        };
      });
      await onConfirm(task.id, consumption, {
        plates_produced: plates,
        variance_note: varianceNote.trim(),
      });
    } else {
      // Prep/Cook flow: manual actual + unusable wastage
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
      await onConfirm(task.id, consumption, {});
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
              {/* Plates Produced input */}
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

              {/* Auto-calculated breakdown (read-only) */}
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                  Auto-Calculated Consumption
                </p>
                <div className="space-y-2">
                  {(plates > 0 ? portionCalculated : componentRows).map(row => {
                    const excess = plates > 0 && row.calculated !== undefined
                      ? Math.round((row.picked - row.calculated) * 100) / 100
                      : 0;
                    return (
                      <div key={row.id} className="bg-muted/50 rounded-xl p-3 flex items-center justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold truncate">{row.name}</p>
                          {row.sku && <p className="text-[10px] font-mono text-muted-foreground">{row.sku}</p>}
                        </div>
                        <div className="text-right shrink-0">
                          {plates > 0 && row.calculated !== undefined ? (
                            <>
                              <p className="text-sm font-bold">
                                <span className="text-green-600">{row.calculated}</span>
                                <span className="text-muted-foreground font-normal"> / {row.picked}</span>
                              </p>
                              {excess > 0 && (
                                <p className="text-[10px] text-amber-600 font-medium">{excess} {row.uom} excess</p>
                              )}
                            </>
                          ) : (
                            <p className="text-sm font-bold">{row.picked}</p>
                          )}
                          <p className="text-[10px] text-muted-foreground">{row.uom}</p>
                        </div>
                      </div>
                    );
                  })}
                </div>
                {!plates && (
                  <p className="text-xs text-muted-foreground text-center py-2">
                    Enter plates produced above to see calculated consumption
                  </p>
                )}
              </div>

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
              <p className="text-sm text-muted-foreground">
                Confirm actual quantities consumed for <strong>{task.meal_name || task.name}</strong> (Qty: {task.qty || 1}).
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
                          <label className="text-[10px] text-muted-foreground uppercase tracking-wider">Picked</label>
                          <p className="text-sm font-bold">{row.picked}</p>
                        </div>
                        <div>
                          <label className="text-[10px] text-muted-foreground uppercase tracking-wider">Consumed</label>
                          <Input
                            type="number"
                            step="0.01"
                            value={actual}
                            onChange={e => setActuals(prev => ({ ...prev, [row.id]: e.target.value }))}
                            className="h-9 mt-0.5"
                          />
                        </div>
                        <div>
                          <label className="text-[10px] text-muted-foreground uppercase tracking-wider">Unusable Waste</label>
                          <Input
                            type="number"
                            step="0.01"
                            placeholder="0"
                            value={waste}
                            onChange={e => setWastage(prev => ({ ...prev, [row.id]: e.target.value }))}
                            className="h-9 mt-0.5"
                          />
                        </div>
                      </div>
                      {diff !== 0 && (
                        <p className={`text-[11px] font-medium ${diff > 0 ? 'text-amber-600' : 'text-blue-600'}`}>
                          {diff > 0 ? `+${diff.toFixed(2)} over picked` : `${Math.abs(diff).toFixed(2)} ${row.uom} returning to stock`}
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
            disabled={confirming || (isPortioning && !platesProduced)}
          >
            {confirming ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
            Confirm Done
          </Button>
        </div>
      </div>
    </div>
  );
}