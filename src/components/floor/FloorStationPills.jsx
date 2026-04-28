import React, { useMemo } from 'react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

const PILL_STYLES = {
  prep:    { active: 'bg-blue-500 text-white', inactive: 'bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300' },
  cook:    { active: 'bg-amber-500 text-white', inactive: 'bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300' },
  portion: { active: 'bg-green-500 text-white', inactive: 'bg-green-50 text-green-700 dark:bg-green-950 dark:text-green-300' },
};

const LABELS = { prep: 'Prepping', cook: 'Cooking', portion: 'Portioning' };

/**
 * Horizontal station-filter pills — one row beneath the run header.
 */
export default function FloorStationPills({ selected, onSelect, tasks }) {
  const stats = useMemo(() => {
    const map = {};
    ['prep', 'cook', 'portion'].forEach(s => {
      const st = tasks.filter(t => t.station === s);
      map[s] = { total: st.length, done: st.filter(t => t.status === 'done').length, active: st.filter(t => t.status === 'in_progress').length };
    });
    return map;
  }, [tasks]);

  return (
    <div className="flex gap-2">
      {['prep', 'cook', 'portion'].map(station => {
        const isActive = selected === station;
        const style = PILL_STYLES[station];
        const s = stats[station];
        return (
          <button
            key={station}
            onClick={() => onSelect(station)}
            className={cn(
              "flex-1 py-3 rounded-xl font-bold text-sm transition-all active:scale-95",
              isActive ? style.active : style.inactive,
            )}
          >
            <span className="block">{LABELS[station]}</span>
            <span className="block text-xs font-normal opacity-80 mt-0.5">
              {s.done}/{s.total} done{s.active > 0 ? ` · ${s.active} active` : ''}
            </span>
          </button>
        );
      })}
    </div>
  );
}