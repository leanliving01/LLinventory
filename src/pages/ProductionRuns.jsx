import React, { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Link } from 'react-router-dom';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Factory, ChevronRight, Plus } from 'lucide-react';
import HelpDrawer from '@/components/help/HelpDrawer';
import { formatDateSAST } from '@/lib/dateUtils';
import { cn } from '@/lib/utils';
import { useAuth } from '@/lib/AuthContext';
import { getUserPermissions } from '@/lib/permissions';
import { useCustomRoles } from '@/components/settings/CustomRolesManager';
import POFilters from '@/components/purchasing/POFilters';
import POPagination from '@/components/purchasing/POPagination';

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

const STATUS_TABS = [
  { key: 'all', label: 'All' },
  { key: 'draft', label: 'Draft' },
  { key: 'scheduled', label: 'Scheduled' },
  { key: 'in_progress', label: 'In Progress' },
  { key: 'completed', label: 'Completed' },
  { key: 'cancelled', label: 'Cancelled' },
];

export default function ProductionRuns() {
  const { user } = useAuth();
  const customRoles = useCustomRoles();
  const perms = getUserPermissions(user || {}, customRoles);

  const [statusTab, setStatusTab] = useState('all');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [filters, setFilters] = useState({
    search: '',
    supplierId: 'all',
    dateFrom: null,
    dateTo: null,
    sortBy: 'date_desc',
  });

  const { data: runs = [], isLoading } = useQuery({
    queryKey: ['production-runs'],
    queryFn: () => base44.entities.ProductionRun.list('-created_date', 5000),
  });

  const filtered = useMemo(() => {
    const result = runs.filter(r => {
      if (statusTab !== 'all' && r.status !== statusTab) return false;
      if (filters.search) {
        const q = filters.search.toLowerCase();
        if (!(r.run_number || '').toLowerCase().includes(q)) return false;
      }
      const dateField = r.run_date || r.planned_date || r.created_date;
      if (filters.dateFrom && dateField) {
        if (new Date(dateField) < filters.dateFrom) return false;
      }
      if (filters.dateTo && dateField) {
        const toEnd = new Date(filters.dateTo);
        toEnd.setHours(23, 59, 59, 999);
        if (new Date(dateField) > toEnd) return false;
      }
      return true;
    });

    const sorted = [...result];
    const [field, dir] = filters.sortBy.split('_');
    const mult = dir === 'asc' ? 1 : -1;
    sorted.sort((a, b) => {
      if (field === 'date') {
        const aD = a.run_date || a.planned_date || a.created_date || '';
        const bD = b.run_date || b.planned_date || b.created_date || '';
        return mult * (aD).localeCompare(bD);
      }
      return 0;
    });
    return sorted;
  }, [runs, statusTab, filters]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const paginated = filtered.slice((safePage - 1) * pageSize, safePage * pageSize);

  const handleFiltersChange = (newFilters) => {
    setFilters(newFilters);
    setPage(1);
  };

  const activeRuns = paginated.filter(r => r.status !== 'completed' && r.status !== 'cancelled');
  const pastRuns = paginated.filter(r => r.status === 'completed' || r.status === 'cancelled');

  const statusCounts = useMemo(() => {
    const c = { all: runs.length };
    runs.forEach(r => { c[r.status] = (c[r.status] || 0) + 1; });
    return c;
  }, [runs]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Production Runs</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {filtered.length} of {runs.length} runs
          </p>
        </div>
        <div className="flex items-center gap-2">
          <HelpDrawer pageKey="production-runs" />
          {perms.runs_create && (
            <Link to="/production">
              <Button className="gap-2">
                <Plus className="w-4 h-4" /> New Run
              </Button>
            </Link>
          )}
        </div>
      </div>

      <div className="flex gap-2 flex-wrap">
        {STATUS_TABS.map(tab => (
          <button
            key={tab.key}
            onClick={() => { setStatusTab(tab.key); setPage(1); }}
            className={`text-xs px-3 py-1.5 rounded-full font-medium transition-all ${
              statusTab === tab.key
                ? 'bg-primary/10 text-primary ring-2 ring-primary/30'
                : 'bg-muted text-muted-foreground hover:bg-muted/80'
            }`}
          >
            {tab.label} ({statusCounts[tab.key] || 0})
          </button>
        ))}
      </div>

      <POFilters filters={filters} onChange={handleFiltersChange} suppliers={[]} />

      {isLoading ? (
        <div className="text-center py-12 text-sm text-muted-foreground">Loading runs...</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 bg-card border border-border rounded-xl">
          <Factory className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
          <p className="text-muted-foreground text-sm">
            {runs.length === 0 ? 'No production runs yet' : 'No runs match your filter'}
          </p>
          {runs.length === 0 && (
            <p className="text-muted-foreground text-xs mt-1">Create one from the Production Plan page</p>
          )}
        </div>
      ) : (
        <>
          {activeRuns.length > 0 && (
            <RunSection title="Active Runs" runs={activeRuns} />
          )}
          {pastRuns.length > 0 && (
            <RunSection title="Past Runs" runs={pastRuns} defaultCollapsed={activeRuns.length > 0} />
          )}
          <div className="bg-card border border-border rounded-xl">
            <POPagination
              page={safePage}
              totalPages={totalPages}
              totalItems={filtered.length}
              pageSize={pageSize}
              onPageChange={setPage}
              onPageSizeChange={v => { setPageSize(v); setPage(1); }}
            />
          </div>
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
                  {run.run_date ? formatDateSAST(run.run_date) : '—'} · {run.total_lines || 0} meals · {run.total_units || 0} units
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
