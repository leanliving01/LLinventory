import React, { useState, useMemo } from 'react';
import { Badge } from '@/components/ui/badge';
import { Loader2, Factory, AlertCircle } from 'lucide-react';
import { format, isToday, startOfWeek, endOfWeek, isWithinInterval, parseISO } from 'date-fns';
import { cn } from '@/lib/utils';

const FILTERS = [
  { key: 'today', label: 'Today' },
  { key: 'week', label: 'This Week' },
  { key: 'all', label: 'All' },
];

export default function FloorRunPicker({ runs, loading, onSelect }) {
  const [filter, setFilter] = useState('today');

  const filteredRuns = useMemo(() => {
    if (!runs || runs.length === 0) return [];
    if (filter === 'all') return runs;
    const now = new Date();
    return runs.filter(run => {
      if (!run.run_date) return false;
      const d = typeof run.run_date === 'string' ? parseISO(run.run_date) : new Date(run.run_date);
      if (filter === 'today') return isToday(d);
      if (filter === 'week') return isWithinInterval(d, { start: startOfWeek(now, { weekStartsOn: 1 }), end: endOfWeek(now, { weekStartsOn: 1 }) });
      return true;
    });
  }, [runs, filter]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-muted-foreground gap-2">
        <Loader2 className="w-5 h-5 animate-spin" /> Loading runs...
      </div>
    );
  }

  if (!runs || runs.length === 0) {
    return (
      <div className="text-center py-16 space-y-3">
        <AlertCircle className="w-10 h-10 text-muted-foreground mx-auto" />
        <h2 className="text-lg font-bold">No Active Runs</h2>
        <p className="text-sm text-muted-foreground">
          There are no production runs in progress right now.<br />
          Ask your manager to start a run from the admin dashboard.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">Select Production Run</h1>

      {/* Date filter pills */}
      <div className="flex gap-2">
        {FILTERS.map(f => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={cn(
              "px-4 py-2 rounded-xl text-sm font-semibold transition-colors",
              filter === f.key
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground hover:bg-muted/80"
            )}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div className="space-y-3">
        {filteredRuns.length === 0 && (
          <div className="text-center py-10 space-y-2">
            <p className="text-sm text-muted-foreground">No runs found for this filter.</p>
            <button onClick={() => setFilter('all')} className="text-sm text-primary font-semibold">Show all runs</button>
          </div>
        )}
        {filteredRuns.map(run => (
          <button
            key={run.id}
            onClick={() => onSelect(run.id)}
            className="w-full bg-card border-2 border-border rounded-2xl p-5 flex items-center gap-4 active:scale-[0.98] transition-transform text-left hover:border-primary/50"
          >
            <div className="w-12 h-12 rounded-xl bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center shrink-0">
              <Factory className="w-6 h-6 text-amber-600" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-bold text-base">{run.run_number}</p>
              <p className="text-sm text-muted-foreground">
                {run.run_date ? format(new Date(run.run_date), 'dd MMM yyyy') : '—'} · {run.total_lines || 0} meals · {run.total_units || 0} units
              </p>
            </div>
            <Badge className="bg-amber-100 text-amber-700 text-xs shrink-0">Active</Badge>
          </button>
        ))}
      </div>
    </div>
  );
}