import React from 'react';
import { cn } from '@/lib/utils';

function DonutRing({ pct, color, size = 92 }) {
  const r = size / 2 - 9;
  const circ = 2 * Math.PI * r;
  const offset = circ - (Math.min(100, Math.max(0, pct)) / 100) * circ;
  const cx = size / 2;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="shrink-0">
      <circle cx={cx} cy={cx} r={r} fill="none" stroke="currentColor" strokeWidth="8" className="text-border" />
      <circle
        cx={cx} cy={cx} r={r} fill="none"
        stroke={color} strokeWidth="8"
        strokeDasharray={circ}
        strokeDashoffset={offset}
        strokeLinecap="round"
        transform={`rotate(-90 ${cx} ${cx})`}
        style={{ transition: 'stroke-dashoffset 0.35s ease' }}
      />
    </svg>
  );
}

/**
 * A single package summary card used in the horizontal card row on the
 * Production Planning page.
 *
 * Props:
 *   pkg        – one entry from groupMealsByPackage() (code, fullLabel, color, meals)
 *   stats      – { totalToProduce, committed, belowPar, onPlanPct, totalMeals }
 *   selected   – boolean
 *   onClick    – () => void
 *   maxPerRun  – number, used to compute runs needed
 */
export default function PackageSummaryCard({ pkg, stats, selected, onClick, maxPerRun }) {
  const { fullLabel, color } = pkg;
  const { totalToProduce, committed, belowPar, onPlanPct, totalMeals } = stats;
  const runsNeeded = totalToProduce > 0 ? Math.max(1, Math.ceil(totalToProduce / (maxPerRun || 1500))) : 0;
  const ringColor = color || '#6b7280';

  return (
    <button
      onClick={onClick}
      className={cn(
        'flex flex-col gap-3 p-4 rounded-xl border text-left shrink-0 w-[200px] transition-all duration-150',
        selected
          ? 'border-primary border-2 bg-primary/5 shadow-md ring-1 ring-primary/20'
          : 'border-border bg-card hover:border-primary/40 hover:shadow-sm'
      )}
    >
      {/* Label */}
      <div>
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: ringColor }} />
          <span className="text-[11px] font-bold uppercase tracking-wide text-foreground leading-tight line-clamp-1">
            {fullLabel}
          </span>
        </div>
        <p className="text-[10px] text-muted-foreground mt-0.5 pl-4">{totalMeals} meals</p>
      </div>

      {/* Donut ring */}
      <div className="relative flex items-center justify-center">
        <DonutRing pct={onPlanPct} color={ringColor} />
        <div className="absolute text-center pointer-events-none">
          <span className="text-[15px] font-bold text-foreground leading-none">{Math.round(onPlanPct)}%</span>
          <span className="block text-[9px] text-muted-foreground mt-0.5">On Plan</span>
        </div>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-2 gap-x-3 gap-y-2">
        <div>
          <p className="text-[9px] text-muted-foreground uppercase tracking-wider">To Produce</p>
          <p className="text-xs font-bold text-foreground tabular-nums">{totalToProduce.toLocaleString()}</p>
        </div>
        <div>
          <p className="text-[9px] text-muted-foreground uppercase tracking-wider">Committed</p>
          <p className={cn('text-xs font-bold tabular-nums', committed > 0 ? 'text-amber-600' : 'text-foreground')}>
            {committed.toLocaleString()}
          </p>
        </div>
        <div>
          <p className="text-[9px] text-muted-foreground uppercase tracking-wider">Runs Needed</p>
          <p className="text-xs font-bold text-foreground tabular-nums">{runsNeeded}</p>
        </div>
        <div>
          <p className="text-[9px] text-muted-foreground uppercase tracking-wider">Below Par</p>
          <p className={cn('text-xs font-bold tabular-nums', belowPar > 0 ? 'text-red-500' : 'text-emerald-500')}>
            {belowPar}
          </p>
        </div>
      </div>
    </button>
  );
}
