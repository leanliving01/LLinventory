import React from 'react';
import { Badge } from '@/components/ui/badge';
import { Factory } from 'lucide-react';
import { format } from 'date-fns';
import { Link } from 'react-router-dom';

const STATUS_STYLES = {
  draft: 'bg-muted text-muted-foreground',
  scheduled: 'bg-blue-100 text-blue-700',
  in_progress: 'bg-amber-100 text-amber-700',
  completed: 'bg-green-100 text-green-700',
  cancelled: 'bg-red-100 text-red-700',
};

export default function RecentRunsList({ runs }) {
  if (runs.length === 0) {
    return (
      <div className="bg-card border border-border rounded-xl p-5">
        <h3 className="text-sm font-semibold text-foreground mb-4">Recent Production Runs</h3>
        <div className="text-center py-10 text-muted-foreground text-sm">
          <Factory className="w-8 h-8 mx-auto mb-2 text-muted-foreground/40" />
          No production runs in period
        </div>
      </div>
    );
  }

  return (
    <div className="bg-card border border-border rounded-xl p-5">
      <h3 className="text-sm font-semibold text-foreground mb-4">Recent Production Runs</h3>
      <div className="space-y-2">
        {runs.slice(0, 8).map(run => (
          <Link
            key={run.id}
            to={`/production/run/${run.id}`}
            className="flex items-center justify-between py-2.5 px-3 rounded-lg hover:bg-muted/50 transition-colors border-b border-border last:border-0"
          >
            <div>
              <p className="text-sm font-medium">{run.run_number || format(new Date(run.run_date), 'dd MMM yyyy')}</p>
              <p className="text-[10px] text-muted-foreground">
                {run.run_date ? format(new Date(run.run_date), 'dd MMM') : '—'} · {run.total_units || 0} units · {run.total_lines || 0} meals
              </p>
            </div>
            <Badge className={`text-[10px] ${STATUS_STYLES[run.status] || STATUS_STYLES.draft}`}>
              {(run.status || 'draft').replace('_', ' ')}
            </Badge>
          </Link>
        ))}
      </div>
    </div>
  );
}