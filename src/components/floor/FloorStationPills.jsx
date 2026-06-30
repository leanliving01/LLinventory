import React, { useMemo } from 'react';
import { Utensils, Flame, ChefHat } from 'lucide-react';
import { cn } from '@/lib/utils';

const STATIONS = {
  prep:    { label: 'Prepping',   icon: Utensils, bg: 'bg-blue-500',  chip: 'bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300' },
  cook:    { label: 'Cooking',    icon: Flame,    bg: 'bg-amber-500', chip: 'bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300' },
  portion: { label: 'Portioning', icon: ChefHat,  bg: 'bg-green-500', chip: 'bg-green-50 text-green-700 dark:bg-green-950 dark:text-green-300' },
};
const ORDER = ['prep', 'cook', 'portion'];

// Small SVG completion ring drawn in the current text colour.
function Ring({ pct }) {
  const r = 13;
  const c = 2 * Math.PI * r;
  return (
    <svg width="34" height="34" viewBox="0 0 34 34" className="shrink-0">
      <circle cx="17" cy="17" r={r} fill="none" stroke="currentColor" strokeWidth="3" className="opacity-30" />
      <circle
        cx="17" cy="17" r={r} fill="none" stroke="currentColor" strokeWidth="3"
        strokeDasharray={c} strokeDashoffset={c * (1 - pct)} strokeLinecap="round"
        transform="rotate(-90 17 17)" className="transition-all"
      />
    </svg>
  );
}

/**
 * Station header for the auto-locked single-station tablet view.
 * The ACTIVE station fills a full-width coloured banner; the other two
 * stations show as slim "peek" chips you can tap to switch to.
 */
export default function FloorStationPills({ selected, onSelect, tasks }) {
  const stats = useMemo(() => {
    const map = {};
    ORDER.forEach(s => {
      const st = tasks.filter(t => t.station === s);
      map[s] = {
        total: st.length,
        done: st.filter(t => t.status === 'done').length,
        active: st.filter(t => t.status === 'in_progress').length,
      };
    });
    return map;
  }, [tasks]);

  const station = STATIONS[selected] || STATIONS.prep;
  const ActiveIcon = station.icon;
  const aStat = stats[selected] || { total: 0, done: 0, active: 0 };
  const others = ORDER.filter(s => s !== selected);

  return (
    <div className={cn('rounded-2xl px-4 sm:px-5 py-4 flex items-center justify-between gap-3 text-white', station.bg)}>
      <div className="flex items-center gap-3 min-w-0">
        <ActiveIcon className="w-7 h-7 shrink-0" />
        <h2 className="text-xl sm:text-2xl font-extrabold tracking-tight truncate">
          {station.label} <span className="font-bold opacity-90">— {aStat.done} / {aStat.total}</span>
        </h2>
        <Ring pct={aStat.total > 0 ? aStat.done / aStat.total : 0} />
        {aStat.active > 0 && (
          <span className="text-xs font-semibold bg-white/20 rounded-full px-2 py-0.5">{aStat.active} active</span>
        )}
      </div>

      <div className="flex items-center gap-2 shrink-0">
        {others.map(s => {
          const cfg = STATIONS[s];
          const Icon = cfg.icon;
          const st = stats[s];
          return (
            <button
              key={s}
              onClick={() => onSelect(s)}
              className={cn(
                'flex items-center gap-1.5 rounded-xl px-2.5 sm:px-3 py-2 text-sm font-semibold transition-all active:scale-95',
                cfg.chip,
              )}
            >
              <Icon className="w-4 h-4" />
              <span className="hidden md:inline">{cfg.label}</span>
              <span className="tabular-nums opacity-80">{st.done}/{st.total}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
