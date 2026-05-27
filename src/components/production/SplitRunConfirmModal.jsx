import React from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Factory, X, AlertTriangle, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Modal that shows a preview of how the production plan will be split into runs.
 * Run 1 is prioritised — it gets committed demand first, then fills up to max capacity.
 * Remaining quantity is split evenly across further runs.
 *
 * Props:
 *   lines: [{ product_id, product_name, product_sku, planned_qty, committed_at_plan, ... }]
 *   maxPerRun: number
 *   totalUnits: number
 *   onConfirm: (splitPlan: { runIndex, lines }[]) => void
 *   onCancel: () => void
 *   generating: boolean
 */
export default function SplitRunConfirmModal({ lines, maxPerRun, totalUnits, onConfirm, onCancel, generating }) {
  // Calculate how many runs are needed
  const numRuns = Math.max(1, Math.ceil(totalUnits / maxPerRun));

  // Build the split plan
  // Run 1 gets priority: fill with committed demand first, then remaining up to maxPerRun
  // Subsequent runs split the leftover evenly
  const splitPlan = React.useMemo(() => {
    if (numRuns === 1) {
      return [{ runIndex: 0, label: 'Run 1', lines: lines.map(l => ({ ...l })), totalUnits }];
    }

    // Sort lines by committed_at_plan descending — highest demand first for Run 1
    const sorted = [...lines].sort((a, b) => (b.committed_at_plan || 0) - (a.committed_at_plan || 0));

    // Track remaining qty per line
    const remaining = {};
    sorted.forEach(l => { remaining[l.product_id] = l.planned_qty; });

    const runs = [];

    // Run 1 — priority: fill up to maxPerRun, preferring lines with committed demand
    let run1Lines = [];
    let run1Total = 0;

    for (const line of sorted) {
      if (run1Total >= maxPerRun) break;
      const canTake = Math.min(remaining[line.product_id], maxPerRun - run1Total);
      if (canTake > 0) {
        run1Lines.push({ ...line, planned_qty: canTake });
        run1Total += canTake;
        remaining[line.product_id] -= canTake;
      }
    }
    runs.push({ runIndex: 0, label: 'Run 1 (Priority)', lines: run1Lines, totalUnits: run1Total });

    // Remaining runs — split evenly
    const leftoverTotal = Object.values(remaining).reduce((s, v) => s + v, 0);
    const remainingRuns = numRuns - 1;

    if (remainingRuns > 0 && leftoverTotal > 0) {
      const perRun = Math.ceil(leftoverTotal / remainingRuns);

      for (let r = 0; r < remainingRuns; r++) {
        let runLines = [];
        let runTotal = 0;
        const runCap = Math.min(perRun, maxPerRun);

        for (const line of sorted) {
          if (runTotal >= runCap) break;
          if (remaining[line.product_id] <= 0) continue;
          const canTake = Math.min(remaining[line.product_id], runCap - runTotal);
          if (canTake > 0) {
            runLines.push({ ...line, planned_qty: canTake });
            runTotal += canTake;
            remaining[line.product_id] -= canTake;
          }
        }
        if (runLines.length > 0) {
          runs.push({ runIndex: r + 1, label: `Run ${r + 2}`, lines: runLines, totalUnits: runTotal });
        }
      }
    }

    return runs;
  }, [lines, maxPerRun, numRuns, totalUnits]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onCancel} />
      <div className="relative z-10 bg-card rounded-2xl shadow-2xl border border-border w-full max-w-2xl max-h-[85vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border shrink-0">
          <div>
            <h2 className="text-lg font-bold">Production Run Plan</h2>
            <p className="text-sm text-muted-foreground">
              {totalUnits.toLocaleString()} meals across {splitPlan.length} run{splitPlan.length > 1 ? 's' : ''}
              {numRuns > 1 && ` (max ${maxPerRun.toLocaleString()} per run)`}
            </p>
          </div>
          <Button variant="ghost" size="icon" onClick={onCancel}>
            <X className="w-5 h-5" />
          </Button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          {numRuns > 1 && (
            <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm">
              <AlertTriangle className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />
              <div>
                <span className="font-semibold text-amber-800">Split required</span>
                <p className="text-amber-700 mt-0.5">
                  Total exceeds your max of {maxPerRun.toLocaleString()} meals per run. 
                  Run 1 is prioritised with the highest committed demand to cover immediate orders.
                </p>
              </div>
            </div>
          )}

          {splitPlan.map((run) => (
            <div key={run.runIndex} className="border border-border rounded-xl overflow-hidden">
              <div className={cn(
                "px-4 py-3 flex items-center justify-between",
                run.runIndex === 0 ? "bg-primary/10" : "bg-muted/40"
              )}>
                <div className="flex items-center gap-2">
                  <Factory className="w-4 h-4 text-primary" />
                  <span className="font-semibold text-sm">{run.label}</span>
                  {run.runIndex === 0 && numRuns > 1 && (
                    <Badge className="bg-primary/20 text-primary text-[10px]">Priority</Badge>
                  )}
                </div>
                <div className="text-sm font-bold">
                  {run.totalUnits.toLocaleString()} meals
                  <span className="text-muted-foreground font-normal ml-1">({run.lines.length} items)</span>
                </div>
              </div>
              <div className="max-h-40 overflow-y-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-[10px] text-muted-foreground uppercase">
                      <th className="text-left px-4 py-1.5 font-semibold">Meal</th>
                      <th className="text-left px-2 py-1.5 font-semibold">SKU</th>
                      <th className="text-right px-4 py-1.5 font-semibold">Qty</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {run.lines.map((l, i) => (
                      <tr key={`${l.product_id}-${i}`} className="hover:bg-muted/20">
                        <td className="px-4 py-1.5 text-xs">{l.product_name}</td>
                        <td className="px-2 py-1.5 text-xs font-mono text-muted-foreground">{l.product_sku}</td>
                        <td className="px-4 py-1.5 text-xs font-bold text-right">{l.planned_qty}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="shrink-0 border-t border-border px-6 py-4 flex items-center justify-between">
          <Button variant="outline" onClick={onCancel} disabled={generating}>Cancel</Button>
          <Button onClick={() => onConfirm(splitPlan)} disabled={generating} className="gap-2 h-11 px-6">
            <Factory className="w-5 h-5" />
            {generating ? 'Creating...' : `Create ${splitPlan.length} Run${splitPlan.length > 1 ? 's' : ''}`}
          </Button>
        </div>
      </div>
    </div>
  );
}