import React, { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { RefreshCw, X, ArrowUp, ArrowDown, Minus, Loader2, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Recalculate modal — compares existing run lines against ALL finished meals
 * using latest stock/committed/par. Shows diff including NEW meals that should
 * be added. User confirms to apply changes.
 */
export default function RecalculateRunModal({ runId, existingLines, onConfirm, onCancel }) {
  const [applying, setApplying] = useState(false);

  const { data: finishedMeals = [], isLoading: loadingMeals } = useQuery({
    queryKey: ['recalc-meals'],
    queryFn: () => base44.entities.Product.filter({ type: 'finished_meal', status: 'active' }, '-sku', 500),
  });

  const { data: stockRecords = [], isLoading: loadingStock } = useQuery({
    queryKey: ['recalc-stock'],
    queryFn: () => base44.entities.StockOnHand.list('-updated_date', 1000),
  });

  const stockMap = useMemo(() => {
    const map = {};
    stockRecords.forEach(s => {
      const pid = s.product_id;
      if (!map[pid]) map[pid] = { qty_on_hand: 0, qty_committed: 0 };
      map[pid].qty_on_hand += s.qty_on_hand || 0;
      map[pid].qty_committed += s.qty_committed || 0;
    });
    return map;
  }, [stockRecords]);

  // Build a set of product IDs already in the run
  const existingProductIds = useMemo(() => {
    return new Set(existingLines.map(l => l.product_id));
  }, [existingLines]);

  // Recalculate ALL finished meals — existing lines get updated, new ones get added
  const diff = useMemo(() => {
    const results = [];

    // 1. Update existing lines
    for (const line of existingLines) {
      const product = finishedMeals.find(p => p.id === line.product_id);
      const soh = stockMap[line.product_id]?.qty_on_hand || 0;
      const committed = stockMap[line.product_id]?.qty_committed || 0;
      const available = soh - committed;
      const par = product?.par_level || 0;
      const newRecommended = Math.max(0, par - available);
      const change = newRecommended - line.planned_qty;

      results.push({
        ...line,
        soh,
        committed,
        available,
        par,
        newRecommended,
        change,
        isNew: false,
        product_name: line.product_name || product?.name || '',
        product_sku: line.product_sku || product?.sku || '',
      });
    }

    // 2. Check ALL finished meals for new additions
    for (const product of finishedMeals) {
      if (existingProductIds.has(product.id)) continue;
      const soh = stockMap[product.id]?.qty_on_hand || 0;
      const committed = stockMap[product.id]?.qty_committed || 0;
      const available = soh - committed;
      const par = product.par_level || 0;
      const newRecommended = Math.max(0, par - available);

      if (newRecommended > 0) {
        results.push({
          id: null, // new line — no existing ID
          product_id: product.id,
          product_name: product.name,
          product_sku: product.sku,
          planned_qty: 0,
          soh,
          committed,
          available,
          par,
          newRecommended,
          change: newRecommended,
          isNew: true,
          soh_at_plan: soh,
          committed_at_plan: committed,
          par_at_plan: par,
        });
      }
    }

    // Sort: new lines first, then by SKU
    results.sort((a, b) => {
      if (a.isNew !== b.isNew) return a.isNew ? -1 : 1;
      return (a.product_sku || '').localeCompare(b.product_sku || '');
    });

    return results;
  }, [existingLines, finishedMeals, stockMap, existingProductIds]);

  const totalOld = existingLines.reduce((s, l) => s + l.planned_qty, 0);
  const totalNew = diff.reduce((s, l) => s + l.newRecommended, 0);
  const changedCount = diff.filter(d => d.change !== 0).length;
  const newCount = diff.filter(d => d.isNew).length;

  const isLoading = loadingMeals || loadingStock;

  const handleApply = async () => {
    setApplying(true);
    await onConfirm(diff);
    setApplying(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onCancel} />
      <div className="relative bg-card rounded-2xl shadow-2xl border border-border w-full max-w-4xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border shrink-0">
          <div>
            <h2 className="text-lg font-bold flex items-center gap-2">
              <RefreshCw className="w-5 h-5 text-primary" /> Recalculate Run
            </h2>
            <p className="text-sm text-muted-foreground">
              Full recalculation against latest stock, demand & par levels — including new meals
            </p>
          </div>
          <Button variant="ghost" size="icon" onClick={onCancel}>
            <X className="w-5 h-5" />
          </Button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {isLoading ? (
            <div className="flex items-center justify-center py-12 gap-2 text-muted-foreground">
              <Loader2 className="w-5 h-5 animate-spin" /> Recalculating...
            </div>
          ) : (
            <>
              {/* Summary */}
              <div className="flex items-center gap-6 mb-4 pb-4 border-b border-border flex-wrap">
                <div>
                  <p className="text-[10px] text-muted-foreground uppercase font-semibold">Changed</p>
                  <p className="text-lg font-bold">{changedCount} <span className="text-sm font-normal text-muted-foreground">of {diff.length}</span></p>
                </div>
                {newCount > 0 && (
                  <div>
                    <p className="text-[10px] text-muted-foreground uppercase font-semibold">New Meals</p>
                    <p className="text-lg font-bold text-primary">{newCount}</p>
                  </div>
                )}
                <div>
                  <p className="text-[10px] text-muted-foreground uppercase font-semibold">Old Total</p>
                  <p className="text-lg font-bold">{totalOld.toLocaleString()}</p>
                </div>
                <div>
                  <p className="text-[10px] text-muted-foreground uppercase font-semibold">New Total</p>
                  <p className="text-lg font-bold">{totalNew.toLocaleString()}</p>
                </div>
                <div>
                  <p className="text-[10px] text-muted-foreground uppercase font-semibold">Difference</p>
                  <p className={cn("text-lg font-bold", totalNew > totalOld && "text-amber-600", totalNew < totalOld && "text-green-600")}>
                    {totalNew > totalOld ? '+' : ''}{(totalNew - totalOld).toLocaleString()}
                  </p>
                </div>
              </div>

              {/* Diff table */}
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-[10px] text-muted-foreground uppercase">
                    <th className="text-left px-3 py-2 font-semibold">Meal</th>
                    <th className="text-left px-2 py-2 font-semibold">SKU</th>
                    <th className="text-right px-2 py-2 font-semibold">SOH</th>
                    <th className="text-right px-2 py-2 font-semibold">COM</th>
                    <th className="text-right px-2 py-2 font-semibold">PAR</th>
                    <th className="text-right px-2 py-2 font-semibold">Old Qty</th>
                    <th className="text-right px-2 py-2 font-semibold">New Qty</th>
                    <th className="text-center px-2 py-2 font-semibold">Change</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {diff.map((d, i) => (
                    <tr key={d.id || `new-${d.product_id}`} className={cn(
                      "hover:bg-muted/30",
                      d.isNew && "bg-primary/5",
                      !d.isNew && d.change !== 0 && "bg-amber-50/40"
                    )}>
                      <td className="px-3 py-2 text-xs">
                        <div className="flex items-center gap-1.5">
                          {d.isNew && <Badge className="bg-primary/20 text-primary text-[9px] px-1">NEW</Badge>}
                          {d.product_name}
                        </div>
                      </td>
                      <td className="px-2 py-2 text-xs font-mono text-muted-foreground">{d.product_sku}</td>
                      <td className="px-2 py-2 text-xs text-right tabular-nums">{d.soh}</td>
                      <td className="px-2 py-2 text-xs text-right tabular-nums text-amber-600">{d.committed || '—'}</td>
                      <td className="px-2 py-2 text-xs text-right tabular-nums">{d.par || '—'}</td>
                      <td className="px-2 py-2 text-xs text-right tabular-nums">{d.isNew ? '—' : d.planned_qty}</td>
                      <td className="px-2 py-2 text-xs text-right tabular-nums font-semibold">{d.newRecommended}</td>
                      <td className="px-2 py-2 text-center">
                        {d.change === 0 ? (
                          <Minus className="w-3.5 h-3.5 text-muted-foreground mx-auto" />
                        ) : d.isNew ? (
                          <Badge className="bg-primary/20 text-primary text-[10px] gap-0.5">
                            <Plus className="w-3 h-3" /> {d.newRecommended}
                          </Badge>
                        ) : d.change > 0 ? (
                          <Badge className="bg-amber-100 text-amber-700 text-[10px] gap-0.5">
                            <ArrowUp className="w-3 h-3" /> +{d.change}
                          </Badge>
                        ) : (
                          <Badge className="bg-green-100 text-green-700 text-[10px] gap-0.5">
                            <ArrowDown className="w-3 h-3" /> {d.change}
                          </Badge>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="shrink-0 border-t border-border px-6 py-4 flex items-center justify-between">
          <Button variant="outline" onClick={onCancel} disabled={applying}>Cancel</Button>
          <Button onClick={handleApply} disabled={applying || isLoading || changedCount === 0} className="gap-2">
            <RefreshCw className="w-4 h-4" />
            {applying ? 'Updating...' : `Apply ${changedCount} Change${changedCount !== 1 ? 's' : ''} (${newCount} new)`}
          </Button>
        </div>
      </div>
    </div>
  );
}