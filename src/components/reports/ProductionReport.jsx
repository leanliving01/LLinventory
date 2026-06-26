import React, { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Badge } from '@/components/ui/badge';
import { format, subDays, isWithinInterval, startOfDay } from 'date-fns';
import { Link } from 'react-router-dom';
import { ChevronDown, ChevronRight } from 'lucide-react';
import ReportDateFilter from './ReportDateFilter';
import ProductionTimeBreakdown from './ProductionTimeBreakdown';
import { downloadCSV } from '@/lib/csvExport';

const STATUS_STYLES = {
  draft: 'bg-muted text-muted-foreground',
  scheduled: 'bg-blue-100 text-blue-700',
  in_progress: 'bg-amber-100 text-amber-700',
  completed: 'bg-green-100 text-green-700',
  cancelled: 'bg-red-100 text-red-700',
};

export default function ProductionReport() {
  const now = new Date();
  const [from, setFrom] = useState(subDays(now, 30));
  const [to, setTo] = useState(now);
  const [expandedRun, setExpandedRun] = useState(null);

  const { data: runs = [] } = useQuery({
    queryKey: ['report-runs'],
    queryFn: () => base44.entities.ProductionRun.list('-run_date', 200),
  });

  const filtered = useMemo(() =>
    runs.filter(r => r.run_date && isWithinInterval(new Date(r.run_date), { start: startOfDay(from), end: to })),
    [runs, from, to]
  );

  const totals = useMemo(() => ({
    count: filtered.length,
    completed: filtered.filter(r => r.status === 'completed').length,
    units: filtered.reduce((s, r) => s + (r.total_units || 0), 0),
    lines: filtered.reduce((s, r) => s + (r.total_lines || 0), 0),
  }), [filtered]);

  const handleExport = () => {
    downloadCSV('production_report.csv', filtered.map(r => ({
      run_number: r.run_number, date: r.run_date, status: r.status,
      meal_lines: r.total_lines, units: r.total_units,
      started: r.started_at || '', completed: r.completed_at || '',
    })));
  };

  return (
    <div className="space-y-4">
      <ReportDateFilter from={from} to={to} onChange={(f, t) => { setFrom(f); setTo(t); }} onExportCSV={handleExport} onPrint={() => window.print()} />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <SumCard label="Runs" value={totals.count} />
        <SumCard label="Completed" value={totals.completed} />
        <SumCard label="Meal Lines" value={totals.lines} />
        <SumCard label="Total Units" value={totals.units.toLocaleString()} accent />
      </div>

      <div className="border border-border rounded-lg overflow-hidden divide-y divide-border">
        {filtered.length === 0 ? (
          <div className="px-4 py-8 text-center text-muted-foreground text-sm">No production runs in period</div>
        ) : filtered.map(run => (
          <div key={run.id}>
            <div className="px-4 py-3 flex items-center justify-between hover:bg-muted/30">
              <Link to={`/production/run/${run.id}`} className="flex-1 min-w-0">
                <p className="text-sm font-medium">{run.run_number || '—'}</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {run.run_date ? format(new Date(run.run_date), 'dd MMM yyyy') : '—'}
                  {' · '}{run.total_units || 0} units · {run.total_lines || 0} meal lines
                </p>
              </Link>
              <div className="flex items-center gap-2">
                <Badge className={`text-[10px] ${STATUS_STYLES[run.status] || ''}`}>{(run.status || '').replace('_', ' ')}</Badge>
                {run.status === 'completed' && (
                  <button onClick={() => setExpandedRun(expandedRun === run.id ? null : run.id)} className="p-1 rounded hover:bg-muted">
                    {expandedRun === run.id ? <ChevronDown className="w-4 h-4 text-muted-foreground" /> : <ChevronRight className="w-4 h-4 text-muted-foreground" />}
                  </button>
                )}
              </div>
            </div>
            {expandedRun === run.id && (
              <div className="px-4 pb-4">
                <ProductionTimeBreakdown runId={run.id} run={run} />
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function SumCard({ label, value, accent }) {
  return (
    <div className={`rounded-lg px-4 py-3 border ${accent ? 'bg-primary/10 border-primary/20' : 'bg-muted/50 border-border'}`}>
      <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">{label}</p>
      <p className={`text-lg font-bold mt-0.5 ${accent ? 'text-primary' : 'text-foreground'}`}>{value}</p>
    </div>
  );
}