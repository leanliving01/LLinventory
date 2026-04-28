import React from 'react';
import { Badge } from '@/components/ui/badge';
import { Loader2, Factory, AlertCircle } from 'lucide-react';
import { format } from 'date-fns';

export default function FloorRunPicker({ runs, loading, onSelect }) {
  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-muted-foreground gap-2">
        <Loader2 className="w-5 h-5 animate-spin" /> Loading runs...
      </div>
    );
  }

  if (runs.length === 0) {
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
      <div className="space-y-3">
        {runs.map(run => (
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