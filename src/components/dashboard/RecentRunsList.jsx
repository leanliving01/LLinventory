import React from 'react';
import { Badge } from '@/components/ui/badge';
import { Factory } from 'lucide-react';
import { formatDateSAST } from '@/lib/dateUtils';
import { Link } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { STATUS_COLORS } from '@/lib/getKpiStatus';

const RUN_STATUS_MAP = {
  draft: 'neutral',
  scheduled: 'info',
  in_progress: 'warn',
  completed: 'good',
  cancelled: 'bad',
};

export default function RecentRunsList({ runs }) {
  if (runs.length === 0) {
    return (
      <div className="bg-card border border-border rounded-lg shadow-sm p-5">
        <h3 className="text-sm font-semibold text-foreground mb-4">Recent Runs</h3>
        <div className="text-center py-10 text-muted-foreground text-sm">
          <div className="w-10 h-10 rounded-md bg-muted flex items-center justify-center mx-auto mb-2">
            <Factory className="w-5 h-5 text-muted-foreground" strokeWidth={1.5} />
          </div>
          No production runs in period
        </div>
      </div>
    );
  }

  return (
    <div className="bg-card border border-border rounded-lg shadow-sm p-5">
      <h3 className="text-sm font-semibold text-foreground mb-4">Recent Runs</h3>
      <div className="space-y-1">
        {runs.slice(0, 8).map(run => {
          const statusKey = RUN_STATUS_MAP[run.status] || 'neutral';
          const colors = STATUS_COLORS[statusKey];
          return (
            <Link
              key={run.id}
              to={`/production/run/${run.id}`}
              className="flex items-center justify-between py-2.5 px-2 rounded-md hover:bg-muted/50 transition-colors"
            >
              <div className="flex items-center gap-3 min-w-0">
                <div className={cn("w-8 h-8 rounded-md flex items-center justify-center shrink-0", colors.bg)}>
                  <Factory className={cn("w-4 h-4", colors.icon)} strokeWidth={1.5} />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{run.run_number || formatDateSAST(run.run_date)}</p>
                  <p className="text-[11px] text-muted-foreground tabular-nums">
                    {run.run_date ? formatDateSAST(run.run_date) : '—'} · {run.total_units || 0} units
                  </p>
                </div>
              </div>
              <Badge className={cn("text-[10px] uppercase tracking-wider", colors.bg, colors.text)}>
                {(run.status || 'draft').replace('_', ' ')}
              </Badge>
            </Link>
          );
        })}
      </div>
    </div>
  );
}