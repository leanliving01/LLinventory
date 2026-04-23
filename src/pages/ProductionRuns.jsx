import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Link } from 'react-router-dom';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Factory, ChevronRight, Plus } from 'lucide-react';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';

const STATUS_STYLES = {
  draft: 'bg-muted text-muted-foreground',
  scheduled: 'bg-blue-100 text-blue-700',
  in_progress: 'bg-amber-100 text-amber-700',
  completed: 'bg-green-100 text-green-700',
  cancelled: 'bg-red-100 text-red-700',
};

const STATUS_LABELS = {
  draft: 'Draft',
  scheduled: 'Scheduled',
  in_progress: 'In Progress',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

export default function ProductionRuns() {
  const { data: runs = [], isLoading } = useQuery({
    queryKey: ['production-runs'],
    queryFn: () => base44.entities.ProductionRun.list('-created_date', 50),
  });

  const activeRuns = runs.filter(r => r.status !== 'completed' && r.status !== 'cancelled');
  const pastRuns = runs.filter(r => r.status === 'completed' || r.status === 'cancelled');

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Production Runs</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Manage and complete production runs</p>
        </div>
        <Link to="/production">
          <Button className="gap-2">
            <Plus className="w-4 h-4" /> New Run
          </Button>
        </Link>
      </div>

      {isLoading ? (
        <div className="text-center py-12 text-sm text-muted-foreground">Loading runs...</div>
      ) : runs.length === 0 ? (
        <div className="text-center py-16 bg-card border border-border rounded-xl">
          <Factory className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
          <p className="text-muted-foreground text-sm">No production runs yet</p>
          <p className="text-muted-foreground text-xs mt-1">Create one from the Production Plan page</p>
        </div>
      ) : (
        <>
          {activeRuns.length > 0 && (
            <RunSection title="Active Runs" runs={activeRuns} />
          )}
          {pastRuns.length > 0 && (
            <RunSection title="Past Runs" runs={pastRuns} defaultCollapsed={activeRuns.length > 0} />
          )}
        </>
      )}
    </div>
  );
}

function RunSection({ title, runs, defaultCollapsed = false }) {
  const [collapsed, setCollapsed] = React.useState(defaultCollapsed);

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="w-full flex items-center justify-between px-6 py-3 border-b border-border bg-muted/30 hover:bg-muted/50 transition-colors"
      >
        <h3 className="text-sm font-bold text-foreground uppercase tracking-wide">{title} ({runs.length})</h3>
        <ChevronRight className={cn("w-4 h-4 text-muted-foreground transition-transform", !collapsed && "rotate-90")} />
      </button>
      {!collapsed && (
        <div className="divide-y divide-border">
          {runs.map(run => (
            <Link
              key={run.id}
              to={`/production/run/${run.id}`}
              className="flex items-center gap-4 px-6 py-4 hover:bg-muted/30 transition-colors"
            >
              <Factory className="w-5 h-5 text-muted-foreground shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-sm">{run.run_number || 'Untitled Run'}</span>
                  <Badge className={cn("text-[10px]", STATUS_STYLES[run.status])}>
                    {STATUS_LABELS[run.status] || run.status}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {run.run_date ? format(new Date(run.run_date), 'dd MMM yyyy') : '—'} · {run.total_lines || 0} meals · {run.total_units || 0} units
                </p>
              </div>
              <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}