import React, { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { X, RotateCcw, Trash2, TrendingDown, TrendingUp, ChefHat, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';

/* ─── Helpers ─── */

/** Aggregate movements by product, netting returns vs extra consumption */
function netByProduct(movements) {
  const map = {};
  for (const m of movements) {
    const key = m.product_id || m.product_sku;
    if (!map[key]) {
      map[key] = { product_id: m.product_id, product_name: m.product_name, product_sku: m.product_sku, uom: m.uom, qty: 0, cost: 0 };
    }
    map[key].qty += m.qty;
    map[key].cost += (m.unit_cost_at_movement || 0) * m.qty;
  }
  return Object.values(map).filter(r => Math.abs(r.qty) > 0.001).sort((a, b) => b.qty - a.qty);
}

/* ─── Sub-sections ─── */

function SectionCard({ icon: Icon, iconColor, title, items, emptyText }) {
  if (!items || items.length === 0) {
    return emptyText ? (
      <div className="border border-dashed border-border rounded-lg px-4 py-3 text-center text-xs text-muted-foreground">
        {emptyText}
      </div>
    ) : null;
  }
  return (
    <div className="border border-border rounded-lg overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-2.5 bg-muted/50 border-b border-border">
        <Icon className={cn("w-4 h-4", iconColor)} />
        <span className="text-sm font-semibold">{title}</span>
        <Badge variant="outline" className="ml-auto text-xs">{items.length} items</Badge>
      </div>
      <div className="divide-y divide-border max-h-48 overflow-y-auto">
        {items.map((item, i) => (
          <div key={item.product_id || i} className="flex items-center justify-between px-4 py-2 text-sm">
            <div className="flex-1 min-w-0">
              <span className="font-medium truncate block">{item.product_name || item.product_sku}</span>
              {item.product_sku && item.product_name && (
                <span className="text-xs text-muted-foreground font-mono">{item.product_sku}</span>
              )}
            </div>
            <div className="text-right shrink-0 ml-3">
              <span className="font-semibold tabular-nums">{Number(item.qty).toFixed(2)}</span>
              <span className="text-xs text-muted-foreground ml-1">{item.uom}</span>
            </div>
            {item.cost > 0.01 && (
              <span className="text-xs text-muted-foreground ml-2 shrink-0">R{item.cost.toFixed(2)}</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function MealVarianceSection({ lines }) {
  const withVariance = lines.filter(l => (l.actual_qty || 0) !== l.planned_qty);
  if (withVariance.length === 0) return null;

  return (
    <div className="border border-border rounded-lg overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-2.5 bg-muted/50 border-b border-border">
        <TrendingDown className="w-4 h-4 text-purple-600" />
        <span className="text-sm font-semibold">Meal Variances</span>
        <Badge variant="outline" className="ml-auto text-xs">{withVariance.length} meals</Badge>
      </div>
      <div className="divide-y divide-border max-h-48 overflow-y-auto">
        {withVariance.map(l => {
          const diff = (l.actual_qty || 0) - l.planned_qty;
          const isOver = diff > 0;
          return (
            <div key={l.id} className="flex items-center justify-between px-4 py-2 text-sm">
              <div className="flex-1 min-w-0">
                <span className="font-medium truncate block">{l.product_name}</span>
                <span className="text-xs text-muted-foreground font-mono">{l.product_sku}</span>
              </div>
              <div className="flex items-center gap-3 shrink-0 ml-3">
                <span className="text-xs text-muted-foreground">Plan: {l.planned_qty}</span>
                <span className="text-xs text-muted-foreground">Actual: {l.actual_qty || 0}</span>
                <Badge className={cn(
                  "text-xs",
                  isOver ? "bg-amber-100 text-amber-700" : "bg-red-100 text-red-700"
                )}>
                  {isOver ? '+' : ''}{diff}
                </Badge>
                {l.variance_reason && l.variance_reason !== 'as_planned' && (
                  <span className="text-xs text-muted-foreground italic">{l.variance_reason.replace(/_/g, ' ')}</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ─── Main Modal ─── */

export default function ProductionSummaryModal({ runId, runNumber, lines, onClose }) {
  const { data: movements = [], isLoading } = useQuery({
    queryKey: ['run-stock-movements', runId],
    queryFn: async () => {
      const [runMvs, pickListRecs] = await Promise.all([
        base44.entities.StockMovement.filter({ ref_id: runId, ref_type: 'production_run' }, '-created_date', 500),
        base44.entities.PickList.filter({ production_run_id: runId }, '-created_date', 1),
      ]);
      if (pickListRecs.length > 0) {
        const pickMvs = await base44.entities.StockMovement.filter({ ref_id: pickListRecs[0].id, ref_type: 'pick_list' }, '-created_date', 500);
        return [...runMvs, ...pickMvs];
      }
      return runMvs;
    },
    enabled: !!runId,
  });

  // Categorise and net-aggregate
  const { netReturned, netExtraConsumed, netWastage, totalReturnedQty, totalExtraQty, totalWasteQty, totalWasteCost } = useMemo(() => {
    // All returns (both reasons) = what went back to warehouse
    const allReturns = movements.filter(m => m.reason === 'production_return' || m.reason === 'return');
    // Extra consumption beyond pick = anything consumed that wasn't in the original pick
    const extraConsumed = movements.filter(m => m.reason === 'production_consume');
    // Wastage
    const wastage = movements.filter(m => m.reason === 'wastage_unusable' || m.reason === 'wastage_usable');

    const netReturned = netByProduct(allReturns);
    const netExtraConsumed = netByProduct(extraConsumed);
    const netWastage = netByProduct(wastage);

    const totalReturnedQty = netReturned.reduce((s, r) => s + r.qty, 0);
    const totalExtraQty = netExtraConsumed.reduce((s, r) => s + r.qty, 0);
    const totalWasteQty = netWastage.reduce((s, r) => s + r.qty, 0);
    const totalWasteCost = netWastage.reduce((s, r) => s + r.cost, 0);

    return { netReturned, netExtraConsumed, netWastage, totalReturnedQty, totalExtraQty, totalWasteQty, totalWasteCost };
  }, [movements]);

  const totalPlanned = lines.reduce((s, l) => s + l.planned_qty, 0);
  const totalActual = lines.reduce((s, l) => s + (l.actual_qty || 0), 0);
  const mealsWithVariance = lines.filter(l => (l.actual_qty || 0) !== l.planned_qty).length;

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-card rounded-2xl border border-border w-full max-w-2xl shadow-xl flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border shrink-0">
          <div>
            <h2 className="text-lg font-bold">Production Summary</h2>
            <p className="text-sm text-muted-foreground">Run {runNumber} — end-of-run report</p>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="w-5 h-5" />
          </Button>
        </div>

        {/* KPI strip */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 px-6 pt-4 shrink-0">
          <div className="bg-green-50 dark:bg-green-900/20 rounded-lg p-3 text-center">
            <p className="text-2xl font-bold text-green-700 dark:text-green-400">{totalActual}</p>
            <p className="text-xs text-green-600">Meals Produced</p>
          </div>
          <div className="bg-blue-50 dark:bg-blue-900/20 rounded-lg p-3 text-center">
            <p className="text-2xl font-bold text-blue-700 dark:text-blue-400">{totalReturnedQty.toFixed(1)}</p>
            <p className="text-xs text-blue-600">Leftovers Returned</p>
          </div>
          <div className="bg-red-50 dark:bg-red-900/20 rounded-lg p-3 text-center">
            <p className="text-2xl font-bold text-red-700 dark:text-red-400">{totalWasteQty.toFixed(1)}</p>
            <p className="text-xs text-red-600">Total Wastage</p>
          </div>
          <div className="bg-purple-50 dark:bg-purple-900/20 rounded-lg p-3 text-center">
            <p className="text-2xl font-bold text-purple-700 dark:text-purple-400">{mealsWithVariance}</p>
            <p className="text-xs text-purple-600">Meal Variances</p>
          </div>
        </div>

        {totalWasteCost > 0.01 && (
          <div className="px-6 pt-2 shrink-0">
            <p className="text-xs text-red-600 text-center">
              Estimated wastage cost: <strong>R{totalWasteCost.toFixed(2)}</strong>
            </p>
          </div>
        )}

        {/* Detail sections */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          {isLoading ? (
            <p className="text-sm text-muted-foreground text-center py-8">Loading...</p>
          ) : (
            <>
              {/* 1. Meal production vs planned */}
              <div className="border border-border rounded-lg overflow-hidden">
                <div className="flex items-center gap-2 px-4 py-2.5 bg-muted/50 border-b border-border">
                  <ChefHat className="w-4 h-4 text-green-600" />
                  <span className="text-sm font-semibold">Meals Produced</span>
                </div>
                <div className="divide-y divide-border max-h-48 overflow-y-auto">
                  {lines.map(l => {
                    const diff = (l.actual_qty || 0) - l.planned_qty;
                    return (
                      <div key={l.id} className="flex items-center justify-between px-4 py-2 text-sm">
                        <div className="flex-1 min-w-0">
                          <span className="font-medium truncate block">{l.product_name}</span>
                          <span className="text-xs text-muted-foreground font-mono">{l.product_sku}</span>
                        </div>
                        <div className="flex items-center gap-2 shrink-0 ml-3">
                          <span className="tabular-nums font-semibold">{l.actual_qty || 0}</span>
                          <span className="text-xs text-muted-foreground">/ {l.planned_qty} planned</span>
                          {diff !== 0 && (
                            <Badge className={cn("text-[10px]", diff > 0 ? "bg-amber-100 text-amber-700" : "bg-red-100 text-red-700")}>
                              {diff > 0 ? '+' : ''}{diff}
                            </Badge>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* 2. Leftovers returned to stock (net per product) */}
              <SectionCard
                icon={RotateCcw}
                iconColor="text-blue-600"
                title="Leftovers Returned to Stock"
                items={netReturned}
                emptyText="No leftovers — everything was consumed"
              />

              {/* 3. Extra consumed beyond pick (if any) */}
              <SectionCard
                icon={Plus}
                iconColor="text-amber-600"
                title="Extra Consumed (beyond pick)"
                items={netExtraConsumed}
              />

              {/* 4. Wastage */}
              <SectionCard
                icon={Trash2}
                iconColor="text-red-600"
                title="Unusable Wastage"
                items={netWastage}
              />

              {/* 5. Meal variances — only if any */}
              <MealVarianceSection lines={lines} />

              {/* Overall variance banner */}
              {totalPlanned !== totalActual && (
                <div className="bg-muted/50 rounded-lg px-4 py-3 flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">
                    Overall: Planned <strong>{totalPlanned}</strong> meals, Produced <strong>{totalActual}</strong>
                  </span>
                  <Badge className={cn(
                    "text-xs",
                    totalActual >= totalPlanned ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"
                  )}>
                    {totalActual >= totalPlanned ? '+' : ''}{totalActual - totalPlanned}
                  </Badge>
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-border shrink-0">
          <Button onClick={onClose} className="w-full h-11">Close Summary</Button>
        </div>
      </div>
    </div>
  );
}