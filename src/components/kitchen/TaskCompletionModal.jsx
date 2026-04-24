import React, { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { X, CheckCircle2, Loader2 } from 'lucide-react';

export default function TaskCompletionModal({ task, onConfirm, onCancel }) {
  const [actuals, setActuals] = useState({});
  const [confirming, setConfirming] = useState(false);

  // Load the relevant BOM and its components for this task's product
  const { data: boms = [] } = useQuery({
    queryKey: ['boms-for-task', task.product_id],
    queryFn: () => base44.entities.Bom.filter({ product_id: task.product_id, is_active: true }, '-created_date', 10),
    enabled: !!task.product_id,
  });

  const { data: allComponents = [] } = useQuery({
    queryKey: ['bom-components-all'],
    queryFn: () => base44.entities.BomComponent.list('-created_date', 2000),
  });

  // Get relevant BOM for this task's station
  const relevantBom = useMemo(() => {
    if (task.station === 'cook') return boms.find(b => b.bom_type === 'cook');
    if (task.station === 'portion') return boms.find(b => b.bom_type === 'portion');
    if (task.station === 'prep') return boms.find(b => b.bom_type === 'cook') || boms.find(b => b.bom_type === 'portion');
    return boms[0];
  }, [boms, task.station]);

  const components = useMemo(() => {
    if (!relevantBom) return [];
    return allComponents.filter(c => c.bom_id === relevantBom.id);
  }, [relevantBom, allComponents]);

  // Calculate required qty per component based on task qty and BOM yield
  const componentRows = useMemo(() => {
    const yieldQty = relevantBom?.yield_qty || 1;
    return components.map(c => {
      const requiredPerUnit = c.qty / yieldQty;
      const totalRequired = Math.round(requiredPerUnit * (task.qty || 1) * 100) / 100;
      return {
        id: c.id,
        name: c.input_product_name || c.input_product_sku || 'Unknown',
        sku: c.input_product_sku || '',
        uom: c.uom || '',
        required: totalRequired,
      };
    });
  }, [components, task.qty, relevantBom]);

  // Pre-fill actuals with required values on first load
  useMemo(() => {
    if (componentRows.length > 0 && Object.keys(actuals).length === 0) {
      const prefilled = {};
      componentRows.forEach(r => { prefilled[r.id] = r.required; });
      setActuals(prefilled);
    }
  }, [componentRows]);

  const handleActualChange = (compId, value) => {
    setActuals(prev => ({ ...prev, [compId]: value }));
  };

  const handleConfirm = async () => {
    setConfirming(true);
    // Build consumption data
    const consumption = componentRows.map(r => ({
      component_id: r.id,
      name: r.name,
      sku: r.sku,
      uom: r.uom,
      required: r.required,
      actual: Number(actuals[r.id]) || 0,
    }));
    await onConfirm(task.id, consumption);
    setConfirming(false);
  };

  const hasComponents = componentRows.length > 0;

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
          ) : (
            <>
              <p className="text-sm text-muted-foreground">
                Confirm actual quantities consumed for <strong>{task.meal_name || task.name}</strong> (Qty: {task.qty || 1}).
              </p>

              {/* Ingredient rows */}
              <div className="space-y-3">
                {componentRows.map(row => {
                  const actual = actuals[row.id] ?? row.required;
                  const diff = Number(actual) - row.required;
                  return (
                    <div key={row.id} className="bg-muted/50 rounded-xl p-4 space-y-2">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-sm font-semibold">{row.name}</p>
                          {row.sku && <p className="text-[10px] font-mono text-muted-foreground">{row.sku}</p>}
                        </div>
                        <Badge variant="outline" className="text-[10px]">{row.uom}</Badge>
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="text-[10px] text-muted-foreground uppercase tracking-wider">Required</label>
                          <p className="text-sm font-bold">{row.required}</p>
                        </div>
                        <div>
                          <label className="text-[10px] text-muted-foreground uppercase tracking-wider">Actual Consumed</label>
                          <Input
                            type="number"
                            step="0.01"
                            value={actual}
                            onChange={e => handleActualChange(row.id, e.target.value)}
                            className="h-9 mt-0.5"
                          />
                        </div>
                      </div>
                      {diff !== 0 && (
                        <p className={`text-[11px] font-medium ${diff > 0 ? 'text-amber-600' : 'text-green-600'}`}>
                          {diff > 0 ? `+${diff.toFixed(2)} over` : `${Math.abs(diff).toFixed(2)} under`} required
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
            disabled={confirming}
          >
            {confirming ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
            Confirm Done
          </Button>
        </div>
      </div>
    </div>
  );
}