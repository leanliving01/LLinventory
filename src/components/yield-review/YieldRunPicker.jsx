import React from 'react';
import { Badge } from '@/components/ui/badge';
import { format } from 'date-fns';

export default function YieldRunPicker({ runs, selectedRunId, onSelect }) {
  if (!runs || runs.length === 0) return null;

  return (
    <div className="flex gap-2 flex-wrap">
      <button
        onClick={() => onSelect('all')}
        className={`text-xs px-3 py-1.5 rounded-full font-medium transition-all ${
          selectedRunId === 'all' ? 'bg-primary/10 text-primary ring-2 ring-primary/30' : 'bg-muted text-muted-foreground hover:bg-muted/80'
        }`}
      >
        All Runs ({runs.length})
      </button>
      {runs.slice(0, 10).map(run => (
        <button
          key={run.id}
          onClick={() => onSelect(run.id)}
          className={`text-xs px-3 py-1.5 rounded-full font-medium transition-all ${
            selectedRunId === run.id ? 'bg-primary/10 text-primary ring-2 ring-primary/30' : 'bg-muted text-muted-foreground hover:bg-muted/80'
          }`}
        >
          {run.run_number || 'Run'} · {run.run_date || '—'}
        </button>
      ))}
    </div>
  );
}