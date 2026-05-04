import React, { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { X, TrendingDown, TrendingUp, Trash2, RotateCcw, ChefHat } from 'lucide-react';
import { cn } from '@/lib/utils';

const REASON_LABELS = {
  production_pick: 'Picked → Production',
  production_consume: 'Consumed (Legacy)',
  production_return: 'Returned from Production',
  return: 'Returned',
  wastage_unusable: 'Unusable Waste',
  wastage_usable: 'Usable Waste',
  production_yield: 'Yield',
};

export default function VarianceReport({ runId, runNumber, lines, onClose }) {
  // Load stock movements for this run (production_run ref + pick_list ref)
  const { data: movements = [], isLoading } = useQuery({
    queryKey: ['variance-movements', runId],
    queryFn: async () => {
      const [runMvs, pickListRecs] = await Promise.all([
        base44.entities.StockMovement.filter({ ref_id: runId, ref_type: 'production_run' }, '-created_date', 1000),
        base44.entities.PickList.filter({ production_run_id: runId }, '-created_date', 1),
      ]);
      if (pickListRecs.length > 0) {
        const pickMvs = await base44.entities.StockMovement.filter({ ref_id: pickListRecs[0].id, ref_type: 'pick_list' }, '-created_date', 1000);
        return [...runMvs, ...pickMvs];
      }
      return runMvs;
    },
    enabled: !!runId,
  });

  // Load completed tasks for this run (to get portioning notes)
  const { data: tasks = [] } = useQuery({
    queryKey: ['variance-tasks', runId],
    queryFn: () => base44.entities.ProductionTask.filter({ run_id: runId }, 'step_no', 500),
    enabled: !!runId,
  });

  // Aggregate movements by reason
  const summary = useMemo(() => {
    const byReason = {};
    movements.forEach(m => {
      const reason = m.reason || 'other';
      if (!byReason[reason]) byReason[reason] = { items: [], totalQty: 0, totalCost: 0 };
      byReason[reason].items.push(m);
      byReason[reason].totalQty += m.qty || 0;
      byReason[reason].totalCost += (m.qty || 0) * (m.unit_cost_at_movement || 0);
    });
    return byReason;
  }, [movements]);

  // Returns summary (merge 'return' + 'production_return')
  const returnItems = [...(summary['return']?.items || []), ...(summary['production_return']?.items || [])];
  const returns = {
    items: returnItems,
    totalQty: returnItems.reduce((s, m) => s + (m.qty || 0), 0),
    totalCost: returnItems.reduce((s, m) => s + (m.qty || 0) * (m.unit_cost_at_movement || 0), 0),
  };
  const unusableWaste = summary['wastage_unusable'] || { items: [], totalQty: 0, totalCost: 0 };
  const usableWaste = summary['wastage_usable'] || { items: [], totalQty: 0, totalCost: 0 };

  // Production yield lines (finished meals)
  const yieldLines = useMemo(() => {
    return lines.map(l => ({
      name: l.product_name || l.product_sku,
      sku: l.product_sku,
      planned: l.planned_qty,
      actual: l.actual_qty || 0,
      variance: (l.actual_qty || 0) - l.planned_qty,
      reason: l.variance_reason || 'as_planned',
    }));
  }, [lines]);

  // Portioning tasks with variance notes
  const portionTasks = useMemo(() => {
    return tasks.filter(t => t.station === 'portion' && t.status === 'done' && t.notes);
  }, [tasks]);

  // Prep/Cook tasks with unusable wastage recorded
  const prepCookTasks = useMemo(() => {
    return tasks.filter(t =>
      (t.station === 'prep' || t.station === 'cook') &&
      t.status === 'done' &&
      t.notes &&
      t.notes.includes('waste')
    );
  }, [tasks]);

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-card rounded-2xl border border-border w-full max-w-2xl shadow-xl flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border shrink-0">
          <div>
            <h3 className="text-lg font-bold">Variance Report</h3>
            <p className="text-sm text-muted-foreground">{runNumber}</p>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="w-5 h-5" />
          </Button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {isLoading ? (
            <p className="text-center text-sm text-muted-foreground py-8">Loading variance data...</p>
          ) : (
            <>
              {/* Section 1: Yield Variance (Planned vs Actual Meals) */}
              <div>
                <h4 className="text-sm font-bold uppercase tracking-wider text-muted-foreground mb-3 flex items-center gap-2">
                  <ChefHat className="w-4 h-4" /> Yield Variance — Meals Produced
                </h4>
                {yieldLines.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No yield data.</p>
                ) : (
                  <div className="border border-border rounded-lg overflow-hidden">
                    <table className="w-full text-sm">
                      <thead className="bg-muted/50">
                        <tr>
                          <th className="text-left px-3 py-2 font-medium">Meal</th>
                          <th className="text-right px-3 py-2 font-medium">Planned</th>
                          <th className="text-right px-3 py-2 font-medium">Actual</th>
                          <th className="text-right px-3 py-2 font-medium">Variance</th>
                          <th className="text-left px-3 py-2 font-medium">Reason</th>
                        </tr>
                      </thead>
                      <tbody>
                        {yieldLines.map((l, i) => (
                          <tr key={i} className="border-t border-border">
                            <td className="px-3 py-2">
                              <p className="font-medium">{l.name}</p>
                              <p className="text-[10px] text-muted-foreground font-mono">{l.sku}</p>
                            </td>
                            <td className="text-right px-3 py-2">{l.planned}</td>
                            <td className="text-right px-3 py-2 font-semibold">{l.actual}</td>
                            <td className="text-right px-3 py-2">
                              {l.variance !== 0 ? (
                                <span className={cn(
                                  "inline-flex items-center gap-1 font-semibold",
                                  l.variance > 0 ? "text-blue-600" : "text-amber-600"
                                )}>
                                  {l.variance > 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                                  {l.variance > 0 ? '+' : ''}{l.variance}
                                </span>
                              ) : (
                                <span className="text-green-600">—</span>
                              )}
                            </td>
                            <td className="px-3 py-2">
                              <Badge variant="outline" className="text-[10px]">
                                {l.reason?.replace(/_/g, ' ')}
                              </Badge>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* Section 2: Stock Returns (Prep/Cook) */}
              <div>
                <h4 className="text-sm font-bold uppercase tracking-wider text-muted-foreground mb-3 flex items-center gap-2">
                  <RotateCcw className="w-4 h-4" /> Stock Returns — Unconsumed Ingredients
                </h4>
                {returns.items.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No stock returns recorded.</p>
                ) : (
                  <div className="space-y-2">
                    {returns.items.map((m, i) => (
                      <div key={i} className="bg-blue-50 dark:bg-blue-950/30 rounded-lg p-3 flex items-center justify-between">
                        <div>
                          <p className="text-sm font-semibold">{m.product_name}</p>
                          <p className="text-[10px] text-muted-foreground font-mono">{m.product_sku}</p>
                        </div>
                        <div className="text-right">
                          <p className="text-sm font-bold text-blue-600">+{m.qty} {m.uom}</p>
                          <p className="text-[10px] text-muted-foreground">returned to stock</p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Section 3: Unusable Wastage (Prep/Cook) */}
              <div>
                <h4 className="text-sm font-bold uppercase tracking-wider text-muted-foreground mb-3 flex items-center gap-2">
                  <Trash2 className="w-4 h-4" /> Unusable Wastage — Peels, Off-cuts, Skins
                </h4>
                {unusableWaste.items.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No unusable wastage recorded.</p>
                ) : (
                  <div className="space-y-2">
                    {unusableWaste.items.map((m, i) => (
                      <div key={i} className="bg-red-50 dark:bg-red-950/30 rounded-lg p-3 flex items-center justify-between">
                        <div>
                          <p className="text-sm font-semibold">{m.product_name}</p>
                          <p className="text-[10px] text-muted-foreground font-mono">{m.product_sku}</p>
                        </div>
                        <div className="text-right">
                          <p className="text-sm font-bold text-red-600">{m.qty} {m.uom}</p>
                          {m.unit_cost_at_movement > 0 && (
                            <p className="text-[10px] text-muted-foreground">
                              R{(m.qty * m.unit_cost_at_movement).toFixed(2)} cost
                            </p>
                          )}
                        </div>
                      </div>
                    ))}
                    <div className="bg-red-100 dark:bg-red-900/30 rounded-lg p-3 flex items-center justify-between font-bold">
                      <span className="text-sm">Total Unusable Waste Cost</span>
                      <span className="text-sm text-red-700">R{unusableWaste.totalCost.toFixed(2)}</span>
                    </div>
                  </div>
                )}
              </div>

              {/* Section 4: Portioning Variance Notes */}
              {portionTasks.length > 0 && (
                <div>
                  <h4 className="text-sm font-bold uppercase tracking-wider text-muted-foreground mb-3 flex items-center gap-2">
                    <ChefHat className="w-4 h-4" /> Portioning Variance & Notes
                  </h4>
                  <div className="space-y-2">
                    {portionTasks.map(t => (
                      <div key={t.id} className="bg-amber-50 dark:bg-amber-950/30 rounded-lg p-3">
                        <div className="flex items-center justify-between mb-1">
                          <p className="text-sm font-semibold">{t.meal_name || t.name}</p>
                          <Badge variant="outline" className="text-[10px]">{t.product_sku}</Badge>
                        </div>
                        <p className="text-xs text-muted-foreground whitespace-pre-wrap">{t.notes}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Section 5: Usable Surplus Waste */}
              {usableWaste.items.length > 0 && (
                <div>
                  <h4 className="text-sm font-bold uppercase tracking-wider text-muted-foreground mb-3">
                    Surplus Waste (disposed)
                  </h4>
                  <div className="space-y-2">
                    {usableWaste.items.map((m, i) => (
                      <div key={i} className="bg-orange-50 dark:bg-orange-950/30 rounded-lg p-3 flex items-center justify-between">
                        <div>
                          <p className="text-sm font-semibold">{m.product_name}</p>
                        </div>
                        <p className="text-sm font-bold text-orange-600">{m.qty} {m.uom}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-border shrink-0">
          <Button variant="outline" className="w-full h-12" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </div>
  );
}