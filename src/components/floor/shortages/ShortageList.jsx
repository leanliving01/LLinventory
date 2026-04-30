import React, { useMemo } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { AlertTriangle, TrendingUp, CheckCircle2, Flame, Utensils, PackagePlus } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Shows yield variances for completed prep/cook tasks.
 * Shortages (actual < planned) are highlighted so staff can react early.
 * Surplus (actual > planned) shown in green for end-of-day plating.
 */
export default function ShortageList({ tasks, runLines, boms, components, products, onPickShortage }) {
  const productMap = useMemo(() => {
    const m = {};
    products.forEach(p => { m[p.id] = p; });
    return m;
  }, [products]);

  // Build yield variance rows from cook/prep tasks
  const varianceRows = useMemo(() => {
    // Only look at cook and prep tasks (not portion — portion is downstream)
    const relevantTasks = tasks.filter(t =>
      (t.station === 'cook' || t.station === 'prep') && t.product_id
    );

    // Group by product_id — a product may have multiple batches
    const grouped = {};
    for (const t of relevantTasks) {
      if (!grouped[t.product_id]) {
        grouped[t.product_id] = { tasks: [], product_id: t.product_id };
      }
      grouped[t.product_id].tasks.push(t);
    }

    return Object.values(grouped).map(group => {
      const { product_id, tasks: groupTasks } = group;
      const product = productMap[product_id];
      const name = groupTasks[0].meal_name || product?.name || 'Unknown';
      const sku = groupTasks[0].product_sku || product?.sku || '';
      const uom = groupTasks[0].qty_uom || product?.stock_uom || '';
      const station = groupTasks[0].station;

      const totalPlanned = groupTasks.reduce((sum, t) => sum + (t.qty || 0), 0);

      // Check which tasks are done and have actual yield recorded
      const doneTasks = groupTasks.filter(t => t.status === 'done');
      const pendingTasks = groupTasks.filter(t => t.status !== 'done');

      // Parse actual yield from task notes (format: "Yield: X uom (planned Y)")
      let totalActual = 0;
      let hasActual = false;
      for (const t of doneTasks) {
        const yieldMatch = t.notes?.match(/Yield:\s*([\d.]+)/);
        if (yieldMatch) {
          totalActual += parseFloat(yieldMatch[1]);
          hasActual = true;
        } else {
          // If no yield note, assume planned was achieved
          totalActual += t.qty || 0;
        }
      }

      const allDone = pendingTasks.length === 0;
      const variance = hasActual ? Math.round((totalActual - totalPlanned) * 100) / 100 : null;
      const variancePct = totalPlanned > 0 && variance !== null
        ? Math.round((variance / totalPlanned) * 100)
        : null;

      return {
        product_id,
        name,
        sku,
        uom,
        station,
        totalPlanned: Math.round(totalPlanned * 100) / 100,
        totalActual: hasActual ? Math.round(totalActual * 100) / 100 : null,
        variance,
        variancePct,
        allDone,
        doneCount: doneTasks.length,
        totalCount: groupTasks.length,
        hasActual,
      };
    }).sort((a, b) => {
      // Shortages first (most negative), then pending, then surplus
      if (a.variance !== null && b.variance !== null) return a.variance - b.variance;
      if (a.variance !== null) return -1;
      if (b.variance !== null) return 1;
      return 0;
    });
  }, [tasks, productMap]);

  const shortages = varianceRows.filter(r => r.variance !== null && r.variance < -0.01);
  const surpluses = varianceRows.filter(r => r.variance !== null && r.variance > 0.01);
  const onTrack = varianceRows.filter(r => r.variance !== null && Math.abs(r.variance) <= 0.01);
  const pending = varianceRows.filter(r => r.variance === null);

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-bold flex items-center gap-2">
          <AlertTriangle className="w-5 h-5 text-amber-500" />
          Yield Tracker
        </h2>
        <p className="text-xs text-muted-foreground mt-0.5">
          Real-time cook/prep yield variances. Spot shortages early so you can cook extra.
        </p>
      </div>

      {/* Summary pills */}
      <div className="flex gap-2 flex-wrap">
        <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200 dark:bg-red-950 dark:text-red-400 dark:border-red-800">
          {shortages.length} Shortage{shortages.length !== 1 ? 's' : ''}
        </Badge>
        <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200 dark:bg-green-950 dark:text-green-400 dark:border-green-800">
          {surpluses.length} Surplus
        </Badge>
        <Badge variant="outline" className="bg-slate-50 text-slate-600 border-slate-200 dark:bg-slate-950 dark:text-slate-400 dark:border-slate-800">
          {onTrack.length} On Track
        </Badge>
        {pending.length > 0 && (
          <Badge variant="outline" className="bg-amber-50 text-amber-600 border-amber-200 dark:bg-amber-950 dark:text-amber-400 dark:border-amber-800">
            {pending.length} Pending
          </Badge>
        )}
      </div>

      {/* Shortage section — most urgent */}
      {shortages.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold text-red-600 uppercase tracking-wider">⚠ Shortages — Action Needed</p>
          {shortages.map(row => (
            <VarianceCard key={row.product_id} row={row} type="shortage" onPickShortage={onPickShortage} />
          ))}
        </div>
      )}

      {/* Surplus */}
      {surpluses.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold text-green-600 uppercase tracking-wider">Surplus — Extra Available</p>
          {surpluses.map(row => (
            <VarianceCard key={row.product_id} row={row} type="surplus" />
          ))}
        </div>
      )}

      {/* On track */}
      {onTrack.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">On Track</p>
          {onTrack.map(row => (
            <VarianceCard key={row.product_id} row={row} type="ok" />
          ))}
        </div>
      )}

      {/* Pending — not yet done */}
      {pending.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Awaiting Yield</p>
          {pending.map(row => (
            <VarianceCard key={row.product_id} row={row} type="pending" />
          ))}
        </div>
      )}

      {varianceRows.length === 0 && (
        <div className="bg-card border border-border rounded-xl p-6 text-center">
          <p className="text-sm text-muted-foreground">No cook/prep tasks found for this run.</p>
        </div>
      )}
    </div>
  );
}

function VarianceCard({ row, type, onPickShortage }) {
  const StationIcon = row.station === 'cook' ? Flame : Utensils;
  const borderClass = {
    shortage: 'border-red-300 dark:border-red-800 bg-red-50/50 dark:bg-red-950/30',
    surplus: 'border-green-300 dark:border-green-800 bg-green-50/50 dark:bg-green-950/30',
    ok: 'border-border bg-card',
    pending: 'border-border bg-muted/30',
  }[type];

  return (
    <div className={cn('rounded-xl border p-4 space-y-2', borderClass)}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <StationIcon className="w-4 h-4 text-muted-foreground shrink-0" />
          <div className="min-w-0">
            <p className="text-sm font-bold truncate">{row.name}</p>
            {row.sku && <p className="text-[10px] font-mono text-muted-foreground">{row.sku}</p>}
          </div>
        </div>
        <div className="text-right shrink-0">
          {type === 'pending' ? (
            <Badge variant="outline" className="text-[10px]">
              {row.doneCount}/{row.totalCount} done
            </Badge>
          ) : type === 'shortage' ? (
            <Badge className="bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300 border-0 text-xs">
              {row.variancePct}%
            </Badge>
          ) : type === 'surplus' ? (
            <Badge className="bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300 border-0 text-xs">
              +{row.variancePct}%
            </Badge>
          ) : (
            <CheckCircle2 className="w-4 h-4 text-green-500" />
          )}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2 text-center">
        <div>
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Planned</p>
          <p className="text-sm font-bold">{row.totalPlanned} {row.uom}</p>
        </div>
        <div>
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Actual</p>
          <p className="text-sm font-bold">
            {row.totalActual !== null ? `${row.totalActual} ${row.uom}` : '—'}
          </p>
        </div>
        <div>
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider">
            {type === 'shortage' ? 'Short' : type === 'surplus' ? 'Extra' : 'Diff'}
          </p>
          {row.variance !== null ? (
            <p className={cn('text-sm font-bold', {
              'text-red-600': row.variance < -0.01,
              'text-green-600': row.variance > 0.01,
              'text-foreground': Math.abs(row.variance) <= 0.01,
            })}>
              {row.variance > 0 ? '+' : ''}{row.variance} {row.uom}
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">—</p>
          )}
        </div>
      </div>

      {/* Action for shortages */}
      {type === 'shortage' && (
        <div className="flex items-center gap-2">
          <div className="flex-1 bg-red-100 dark:bg-red-900/40 rounded-lg px-3 py-2">
            <p className="text-xs font-medium text-red-700 dark:text-red-300">
              Need {Math.abs(row.variance)} {row.uom} more
            </p>
          </div>
          {onPickShortage && (
            <Button
              size="sm"
              className="h-10 gap-1.5 bg-red-600 hover:bg-red-700 text-white shrink-0 rounded-lg"
              onClick={() => onPickShortage(row)}
            >
              <PackagePlus className="w-4 h-4" /> Pick
            </Button>
          )}
        </div>
      )}
    </div>
  );
}