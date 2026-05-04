import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { X, FileText, ArrowDownToLine, RotateCcw, Trash2, TrendingDown, TrendingUp, Equal } from 'lucide-react';
import { cn } from '@/lib/utils';

function groupByReason(movements) {
  const groups = {};
  for (const m of movements) {
    const key = m.reason || 'unknown';
    if (!groups[key]) groups[key] = [];
    groups[key].push(m);
  }
  return groups;
}

const REASON_LABELS = {
  production_pick: { label: 'Picked → Production', icon: ArrowDownToLine, color: 'text-teal-600' },
  production_consume: { label: 'Consumed (Legacy)', icon: ArrowDownToLine, color: 'text-blue-600' },
  production_yield: { label: 'Produced (Yield)', icon: TrendingUp, color: 'text-green-600' },
  production_return: { label: 'Returned to Stock', icon: RotateCcw, color: 'text-green-600' },
  return: { label: 'Returned to Stock', icon: RotateCcw, color: 'text-amber-600' },
  wastage_unusable: { label: 'Unusable Wastage', icon: Trash2, color: 'text-red-600' },
  wastage_usable: { label: 'Usable Wastage (Surplus)', icon: Trash2, color: 'text-orange-500' },
};

function SummarySection({ reason, movements }) {
  const config = REASON_LABELS[reason] || { label: reason, icon: FileText, color: 'text-muted-foreground' };
  const Icon = config.icon;
  const totalCost = movements.reduce((s, m) => s + (m.unit_cost_at_movement || 0) * m.qty, 0);

  return (
    <div className="border border-border rounded-lg overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-2.5 bg-muted/50 border-b border-border">
        <Icon className={cn("w-4 h-4", config.color)} />
        <span className="text-sm font-semibold">{config.label}</span>
        <Badge variant="outline" className="ml-auto text-xs">{movements.length} items</Badge>
        {totalCost > 0 && (
          <span className="text-xs text-muted-foreground">R{totalCost.toFixed(2)}</span>
        )}
      </div>
      <div className="divide-y divide-border max-h-48 overflow-y-auto">
        {movements.map((m, i) => (
          <div key={m.id || i} className="flex items-center justify-between px-4 py-2 text-sm">
            <div className="flex-1 min-w-0">
              <span className="font-medium truncate block">{m.product_name || m.product_sku}</span>
              {m.product_sku && m.product_name && (
                <span className="text-xs text-muted-foreground font-mono">{m.product_sku}</span>
              )}
            </div>
            <div className="text-right shrink-0 ml-3">
              <span className="font-semibold tabular-nums">{Number(m.qty).toFixed(2)}</span>
              <span className="text-xs text-muted-foreground ml-1">{m.uom}</span>
            </div>
            {m.unit_cost_at_movement > 0 && (
              <span className="text-xs text-muted-foreground ml-2 shrink-0">
                R{(m.unit_cost_at_movement * m.qty).toFixed(2)}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function VarianceSection({ lines }) {
  const withVariance = lines.filter(l => (l.actual_qty || 0) !== l.planned_qty);
  if (withVariance.length === 0) return null;

  return (
    <div className="border border-border rounded-lg overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-2.5 bg-muted/50 border-b border-border">
        <TrendingDown className="w-4 h-4 text-purple-600" />
        <span className="text-sm font-semibold">Meal Variances (Planned vs Actual)</span>
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

export default function ProductionSummaryModal({ runId, runNumber, lines, onClose }) {
  // Fetch movements from both production_run ref and pick_list ref
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

  const grouped = groupByReason(movements);
  const displayOrder = ['production_pick', 'production_consume', 'production_yield', 'production_return', 'return', 'wastage_unusable', 'wastage_usable'];

  // Totals
  const totalConsumed = [...(grouped.production_pick || []), ...(grouped.production_consume || [])].reduce((s, m) => s + m.qty, 0);
  const totalYielded = (grouped.production_yield || []).reduce((s, m) => s + m.qty, 0);
  const totalReturned = (grouped.return || []).reduce((s, m) => s + m.qty, 0);
  const totalWaste = [...(grouped.wastage_unusable || []), ...(grouped.wastage_usable || [])].reduce((s, m) => s + m.qty, 0);
  const totalWasteCost = (grouped.wastage_unusable || []).reduce((s, m) => s + (m.unit_cost_at_movement || 0) * m.qty, 0);

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
            <p className="text-sm text-muted-foreground">Run {runNumber} — complete stock report</p>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="w-5 h-5" />
          </Button>
        </div>

        {/* Stat cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 px-6 pt-4 shrink-0">
          <div className="bg-green-50 dark:bg-green-900/20 rounded-lg p-3 text-center">
            <p className="text-2xl font-bold text-green-700 dark:text-green-400">{totalActual}</p>
            <p className="text-xs text-green-600">Meals Produced</p>
          </div>
          <div className="bg-amber-50 dark:bg-amber-900/20 rounded-lg p-3 text-center">
            <p className="text-2xl font-bold text-amber-700 dark:text-amber-400">{totalReturned.toFixed(1)}</p>
            <p className="text-xs text-amber-600">Stock Returned</p>
          </div>
          <div className="bg-red-50 dark:bg-red-900/20 rounded-lg p-3 text-center">
            <p className="text-2xl font-bold text-red-700 dark:text-red-400">{totalWaste.toFixed(1)}</p>
            <p className="text-xs text-red-600">Total Wastage</p>
          </div>
          <div className="bg-purple-50 dark:bg-purple-900/20 rounded-lg p-3 text-center">
            <p className="text-2xl font-bold text-purple-700 dark:text-purple-400">{mealsWithVariance}</p>
            <p className="text-xs text-purple-600">Meal Variances</p>
          </div>
        </div>

        {totalWasteCost > 0 && (
          <div className="px-6 pt-2 shrink-0">
            <p className="text-xs text-red-600 text-center">
              Estimated wastage cost: <strong>R{totalWasteCost.toFixed(2)}</strong>
            </p>
          </div>
        )}

        {/* Scrollable detail sections */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          {isLoading ? (
            <p className="text-sm text-muted-foreground text-center py-8">Loading stock movements...</p>
          ) : movements.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">No stock movements recorded for this run.</p>
          ) : (
            displayOrder.map(reason => {
              const items = grouped[reason];
              if (!items || items.length === 0) return null;
              return <SummarySection key={reason} reason={reason} movements={items} />;
            })
          )}

          {/* Variance section from lines */}
          <VarianceSection lines={lines} />

          {/* Planned vs actual totals */}
          {totalPlanned !== totalActual && (
            <div className="bg-muted/50 rounded-lg px-4 py-3 flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Overall: Planned <strong>{totalPlanned}</strong> meals, Produced <strong>{totalActual}</strong></span>
              <Badge className={cn(
                "text-xs",
                totalActual >= totalPlanned ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"
              )}>
                {totalActual >= totalPlanned ? '+' : ''}{totalActual - totalPlanned} variance
              </Badge>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-border shrink-0">
          <Button onClick={onClose} className="w-full h-11">
            Close Summary
          </Button>
        </div>
      </div>
    </div>
  );
}