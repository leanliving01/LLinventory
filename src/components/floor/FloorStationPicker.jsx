import React, { useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

export default function FloorStationPicker({ stations, tasks, run, onSelect, onBack }) {
  const stats = useMemo(() => {
    const map = {};
    stations.forEach(s => {
      const stationTasks = tasks.filter(t => t.station === s.id);
      const done = stationTasks.filter(t => t.status === 'done').length;
      const active = stationTasks.filter(t => t.status === 'in_progress').length;
      map[s.id] = { total: stationTasks.length, done, active };
    });
    return map;
  }, [stations, tasks]);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={onBack} className="-ml-2">← Runs</Button>
        <div>
          <h1 className="text-xl font-bold">Choose Your Station</h1>
          <p className="text-xs text-muted-foreground">{run?.run_number}</p>
        </div>
      </div>

      <div className="space-y-3">
        {stations.map(station => {
          const s = stats[station.id] || { total: 0, done: 0, active: 0 };
          const pct = s.total > 0 ? Math.round((s.done / s.total) * 100) : 0;
          return (
            <button
              key={station.id}
              onClick={() => onSelect(station.id)}
              className="w-full bg-card border-2 border-border rounded-2xl p-5 flex items-center gap-4 active:scale-[0.98] transition-transform text-left hover:border-primary/50"
            >
              <div className={cn("w-14 h-14 rounded-xl flex items-center justify-center text-white", station.color)}>
                <station.icon className="w-7 h-7" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-bold text-lg">{station.label}</p>
                <div className="flex items-center gap-3 mt-1">
                  <span className="text-sm text-muted-foreground">{s.done}/{s.total} done</span>
                  {s.active > 0 && (
                    <Badge className="bg-amber-100 text-amber-700 text-[10px]">{s.active} active</Badge>
                  )}
                </div>
                {/* Mini progress bar */}
                <div className="h-1.5 bg-muted rounded-full mt-2 overflow-hidden">
                  <div
                    className={cn("h-full rounded-full transition-all", station.color)}
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}