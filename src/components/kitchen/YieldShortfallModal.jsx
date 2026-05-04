import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { AlertTriangle, X, ArrowRight, RefreshCw, SkipForward } from 'lucide-react';

/**
 * Warning modal shown when a cook/prep task completes with yield BELOW planned.
 * Offers 3 options:
 *  1. Proceed anyway — downstream tasks will be updated to the reduced qty
 *  2. Update downstream — same as proceed, but explicitly communicates the impact
 *  3. Create a top-up cooking run to recover the shortfall (future)
 */
export default function YieldShortfallModal({
  task,
  actualYield,
  plannedYield,
  affectedTasks, // downstream tasks that will be impacted
  onProceed,     // () => proceed with reduced yield, update downstream
  onCancel,      // () => go back and re-enter yield
}) {
  const shortfall = Math.round((plannedYield - actualYield) * 100) / 100;
  const shortfallPct = Math.round((shortfall / plannedYield) * 100);

  return (
    <div className="fixed inset-0 bg-black/50 z-[60] flex items-center justify-center p-4">
      <div className="bg-card rounded-2xl border border-border w-full max-w-md shadow-xl">
        {/* Header */}
        <div className="flex items-center gap-3 px-6 py-4 border-b border-border">
          <div className="w-10 h-10 rounded-full bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center shrink-0">
            <AlertTriangle className="w-5 h-5 text-amber-600" />
          </div>
          <div className="flex-1">
            <h3 className="text-lg font-bold">Yield Shortfall</h3>
            <p className="text-sm text-muted-foreground">{task.meal_name || task.name}</p>
          </div>
          <Button variant="ghost" size="icon" onClick={onCancel}>
            <X className="w-5 h-5" />
          </Button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-4">
          {/* Shortfall summary */}
          <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-xl p-4">
            <div className="grid grid-cols-3 gap-3 text-center">
              <div>
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Planned</p>
                <p className="text-lg font-bold">{plannedYield}</p>
                <p className="text-[10px] text-muted-foreground">{task.qty_uom || 'kg'}</p>
              </div>
              <div>
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Actual</p>
                <p className="text-lg font-bold text-amber-600">{actualYield}</p>
                <p className="text-[10px] text-muted-foreground">{task.qty_uom || 'kg'}</p>
              </div>
              <div>
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Short</p>
                <p className="text-lg font-bold text-red-600">-{shortfall}</p>
                <p className="text-[10px] text-red-600 font-semibold">({shortfallPct}%)</p>
              </div>
            </div>
          </div>

          {/* Impact on downstream */}
          {affectedTasks.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                Impact on next station
              </p>
              <div className="space-y-1.5">
                {affectedTasks.map(dt => (
                  <div key={dt.id} className="flex items-center justify-between bg-muted/50 rounded-lg px-3 py-2">
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{dt.meal_name || dt.name}</p>
                      <Badge variant="outline" className="text-[10px] capitalize">{dt.station}</Badge>
                    </div>
                    <div className="flex items-center gap-1.5 text-sm shrink-0">
                      <span className="text-muted-foreground line-through">{dt.qty}</span>
                      <ArrowRight className="w-3 h-3 text-amber-500" />
                      <span className="font-bold text-amber-600">{actualYield}</span>
                      <span className="text-xs text-muted-foreground">{dt.qty_uom || task.qty_uom || 'kg'}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <p className="text-xs text-muted-foreground">
            Proceeding will update downstream tasks to use <strong>{actualYield} {task.qty_uom || 'kg'}</strong> instead of {plannedYield}. 
            The portioning team will see the reduced availability.
            {' '}You can run a top-up cooking run later from the Cooking Runs page if needed.
          </p>
        </div>

        {/* Actions */}
        <div className="px-6 py-4 border-t border-border flex gap-3">
          <Button variant="outline" className="flex-1 h-12" onClick={onCancel}>
            Go Back
          </Button>
          <Button
            className="flex-1 h-12 gap-2 bg-amber-600 hover:bg-amber-700 text-white"
            onClick={onProceed}
          >
            <SkipForward className="w-4 h-4" />
            Proceed & Update
          </Button>
        </div>
      </div>
    </div>
  );
}