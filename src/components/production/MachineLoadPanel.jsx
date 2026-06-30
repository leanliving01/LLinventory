import React from 'react';
import { Loader2, Flame, Soup, AlertTriangle, ChefHat } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useMachinePlan } from '@/lib/useMachinePlan';

const fmtMin = (m) => {
  const h = Math.floor(m / 60); const r = Math.round(m % 60);
  return h > 0 ? `${h}h ${r}m` : `${r}m`;
};

// Cook window starts 07:30 (see the equipment register). Finish ≈ start + the
// machine's wall-clock time.
const START_MIN = 7 * 60 + 30;
const fmtClock = (min) => {
  const h = Math.floor((min / 60)) % 24, m = Math.round(min % 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
};

const GROUP_ICON = {
  IVARIO: Soup, TILT: Soup, 'OVEN-ROAST': Flame, 'OVEN-STEAM': ChefHat,
};

/**
 * Machine-load breakdown for a production plan. Explodes the planned meals into
 * bulk kg via portion BOMs, schedules each bulk onto its machine (using the
 * equipment_capacities written per bulk), and shows per-machine batches, cook
 * time and utilisation. The wet line is a recommendation — chef can switch
 * Ivario ↔ Tilting Pan.
 *
 * @param {Array} lines - flattened plan lines [{ product_id, planned_qty }]
 */
export default function MachineLoadPanel({ lines = [] }) {
  const { plan, isLoading } = useMachinePlan(lines);

  if (isLoading) {
    return (
      <div className="bg-card border border-border rounded-xl p-6 flex items-center justify-center">
        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (!plan || (plan.groups.length === 0 && plan.unscheduled.length === 0)) return null;

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      <div className="px-6 py-4 border-b border-border flex items-center gap-2">
        <ChefHat className="w-5 h-5 text-primary" />
        <div>
          <h3 className="font-bold text-base">Machine Load (recommended)</h3>
          <p className="text-xs text-muted-foreground">
            How this plan splits across your kitchen. Wet line is a guide — chef can swap Ivario ↔ Tilting Pan.
          </p>
        </div>
      </div>

      {/* Day total + critical path (the bottleneck that sets the finish time) */}
      {plan.totals && plan.totals.batches > 0 && (
        <div className="flex flex-wrap items-center gap-x-6 gap-y-1 px-6 py-3 border-b border-border bg-muted/30 text-sm">
          <span className="text-muted-foreground">Today: <b className="text-foreground tabular-nums">{plan.totals.kg} kg</b> · <b className="text-foreground tabular-nums">{plan.totals.batches}</b> batches</span>
          {plan.totals.criticalLabel && (
            <span className="text-muted-foreground">
              Critical path: <b className="text-foreground">{plan.totals.criticalLabel}</b>
              {' '}<span className="tabular-nums">{fmtMin(plan.totals.wallClockMin)}</span>
              {' '}· done ~<b className="text-foreground tabular-nums">{fmtClock(START_MIN + plan.totals.wallClockMin)}</b>
            </span>
          )}
        </div>
      )}

      <div className="grid gap-4 p-5 sm:grid-cols-2">
        {plan.groups.map((g) => {
          const Icon = GROUP_ICON[g.key] || Soup;
          return (
            <div key={g.key} className={cn('rounded-xl border p-4',
              g.over ? 'border-red-300 bg-red-50/40' : g.idle ? 'border-border border-dashed opacity-70' : 'border-border')}>
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <Icon className="w-4 h-4 text-muted-foreground" />
                  <span className="font-semibold text-sm">{g.label}</span>
                </div>
                <span className={cn('text-xs font-bold tabular-nums', g.over ? 'text-red-600' : 'text-foreground')}>
                  {g.utilisationPct}%
                </span>
              </div>

              {/* Utilisation bar */}
              <div className="h-2 bg-muted rounded-full overflow-hidden mb-3">
                <div
                  className={cn('h-full rounded-full', g.over ? 'bg-red-500' : g.utilisationPct >= 80 ? 'bg-amber-400' : 'bg-emerald-500')}
                  style={{ width: `${Math.min(100, g.utilisationPct)}%` }}
                />
              </div>

              <div className="flex items-center gap-4 text-xs text-muted-foreground mb-2 tabular-nums">
                <span><b className="text-foreground">{Math.round(g.kg)}</b> kg</span>
                <span><b className="text-foreground">{g.batches}</b> batches</span>
                <span><b className="text-foreground">{fmtMin(g.wallClockMin)}</b>{g.units > 1 ? ` · ${g.units} units` : ''}</span>
                {!g.idle && <span>done ~<b className="text-foreground">{fmtClock(START_MIN + g.wallClockMin)}</b></span>}
              </div>

              {g.over && (
                <p className="flex items-center gap-1 text-[11px] text-red-600 font-medium mb-2">
                  <AlertTriangle className="w-3 h-3" /> Over a day's capacity — some defers to tomorrow.
                </p>
              )}

              {g.idle ? (
                <div className="border-t border-border/60 pt-2 text-[11px] text-muted-foreground italic">
                  Idle today — spare capacity.
                </div>
              ) : (
                <div className="border-t border-border/60 pt-2 space-y-0.5 max-h-44 overflow-y-auto">
                  {g.bulks.map((b) => (
                    <div key={b.sku || b.name} className="flex items-center justify-between text-[11px]">
                      <span className="truncate pr-2">{b.name}</span>
                      <span className="text-muted-foreground tabular-nums shrink-0">
                        {Math.round(b.kg)} kg · {b.batches}×
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {plan.unscheduled.length > 0 && (
        <div className="px-5 pb-5">
          <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs">
            <AlertTriangle className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />
            <div>
              <span className="font-semibold text-amber-800">No machine capacity set for:</span>
              <span className="text-amber-700"> {plan.unscheduled.map((u) => u.name).join(', ')}.</span>
              <span className="text-amber-700"> Set it on the product's Equipment tab.</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
