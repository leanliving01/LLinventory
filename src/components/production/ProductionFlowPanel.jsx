import React from 'react';
import { Loader2, ListOrdered, Soup, Flame, ChefHat, Users, Clock } from 'lucide-react';
import { useMachinePlan } from '@/lib/useMachinePlan';

// Cook window starts 07:30 (see the equipment register).
const START_MIN = 7 * 60 + 30;
const fmtClock = (min) => {
  const h = Math.floor((START_MIN + min) / 60) % 24, m = Math.round((START_MIN + min) % 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
};
const GROUP_ICON = { IVARIO: Soup, TILT: Soup, 'OVEN-ROAST': Flame, 'OVEN-STEAM': ChefHat };

/**
 * Production flow — the recommended COOK ORDER + when portioning can start.
 * Broad + slow bulks first so meals unlock early and the portioning line stays
 * fed. Same numbers drive the floor tablets (sequence_order on each task).
 *
 * @param {Array} lines - flattened plan lines [{ product_id, planned_qty }]
 */
export default function ProductionFlowPanel({ lines = [] }) {
  const { flow, isLoading } = useMachinePlan(lines);

  if (isLoading) {
    return (
      <div className="bg-card border border-border rounded-xl p-6 flex items-center justify-center">
        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (!flow || flow.steps.length === 0) return null;

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      <div className="px-6 py-4 border-b border-border flex items-center gap-2.5">
        <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
          <ListOrdered className="w-4 h-4 text-primary" />
        </div>
        <div>
          <h3 className="font-bold text-base">Production flow (recommended)</h3>
          <p className="text-xs text-muted-foreground">Cook in this order — broad &amp; slow first so portioning can start early and stay fed.</p>
        </div>
      </div>

      {/* Headline: when portioning starts + when everything's cooked */}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-1 px-6 py-3 border-b border-border bg-muted/30 text-sm">
        <span className="inline-flex items-center gap-1.5 text-foreground">
          <Users className="w-4 h-4 text-emerald-600" /> Portioning can start ~<b className="tabular-nums">{fmtClock(flow.portioningStartMin)}</b>
        </span>
        <span className="inline-flex items-center gap-1.5 text-muted-foreground">
          <Clock className="w-4 h-4" /> all cooked + chilled ~<b className="text-foreground tabular-nums">{fmtClock(flow.doneMin)}</b>
        </span>
      </div>

      {/* Ordered cook steps */}
      <ol className="divide-y divide-border">
        {flow.steps.map((s, i) => {
          const Icon = GROUP_ICON[s.machineKey] || Soup;
          return (
            <li key={(s.sku || s.name) + i} className="flex items-center gap-3 px-6 py-2.5">
              <span className="w-6 h-6 rounded-full bg-muted text-foreground text-xs font-bold flex items-center justify-center shrink-0 tabular-nums">{i + 1}</span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-semibold text-foreground truncate">{s.name}</span>
                  <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
                    <Icon className="w-3 h-3" /> {s.machine}
                  </span>
                  {s.fanOut > 0 && (
                    <span className="text-[10px] font-medium text-indigo-600">feeds {s.fanOut} meal{s.fanOut > 1 ? 's' : ''}</span>
                  )}
                </div>
                <p className="text-[11px] text-muted-foreground tabular-nums">
                  {Math.round(s.kg)} kg · {s.batches}× · cook {s.cookMin}m + chill {s.chillMin}m
                </p>
              </div>
              <span className="text-[11px] text-muted-foreground tabular-nums shrink-0">ready ~<b className="text-foreground">{fmtClock(s.readyMin)}</b></span>
            </li>
          );
        })}
      </ol>

      <p className="px-6 py-2.5 text-[10px] text-muted-foreground border-t border-border">
        Chill times are per-station estimates for now. The same order drives the kitchen / prep / portioning tablets.
      </p>
    </div>
  );
}
