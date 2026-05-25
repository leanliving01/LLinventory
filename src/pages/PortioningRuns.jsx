import React, { useState, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { UtensilsCrossed, Plus, ChevronRight, Clock } from 'lucide-react';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { useAuth } from '@/lib/AuthContext';
import { getUserPermissions } from '@/lib/permissions';
import { useCustomRoles } from '@/components/settings/CustomRolesManager';
import PortioningRunDrawer from '@/components/portioning/PortioningRunDrawer';
import PageHelp from '@/components/help/PageHelp';
import POFilters from '@/components/purchasing/POFilters';
import POPagination from '@/components/purchasing/POPagination';

const HELP_ITEMS = [
  { title: 'Create a portioning run', text: 'Click "New Portioning Run" to start a session where bulk cooked WIP is portioned into individual meals.' },
  { title: 'Add portioning lines', text: 'Inside a run, click "Add Line" to select which bulk cooked product to portion. The system shows available WIP kg.' },
  { title: 'Quality check warning', text: 'If any WIP batch for the selected product has NOT been quality checked today, you will see a warning. You must enter a reason to proceed — this is logged for the Production Manager.' },
  { title: 'Record actual usage', text: 'While the run is active, enter the actual kg used and number of meals portioned for each line. The system calculates variance automatically.' },
  { title: 'Complete the run', text: 'Click "Complete Portioning Run" when done. The total meals portioned is saved and the run is marked as completed.' },
];

const STATUS_STYLES = {
  draft: 'bg-gray-100 text-gray-600',
  in_progress: 'bg-blue-100 text-blue-700',
  completed: 'bg-green-100 text-green-700',
};

export default function PortioningRuns() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const customRoles = useCustomRoles();
  const perms = getUserPermissions(user || {}, customRoles);
  const [statusFilter, setStatusFilter] = useState('active');
  const [selectedRun, setSelectedRun] = useState(null);
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
    queryKey: ['portioning-runs'],
    queryFn: () => base44.entities.PortioningRun.list('-created_date', 5000),
  });

  const filtered = useMemo(() => {
    const result = runs.filter(r => {
      if (statusFilter === 'active' && r.status === 'completed') return false;
      if (statusFilter !== 'active' && statusFilter !== 'all' && r.status !== statusFilter) return false;
      if (filters.search) {
        const q = filters.search.toLowerCase();
        if (!(r.run_number || '').toLowerCase().includes(q) &&
            !(r.staff_assigned_names || '').toLowerCase().includes(q)) return false;
      }
      const dateField = r.portioning_date || r.run_date || r.created_date;
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
        const aD = a.portioning_date || a.run_date || a.created_date || '';
        const bD = b.portioning_date || b.run_date || b.created_date || '';
        return mult * (aD).localeCompare(bD);
      }
      return 0;
    });
    return sorted;
  }, [runs, statusFilter, filters]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const paginated = filtered.slice((safePage - 1) * pageSize, safePage * pageSize);

  const handleFiltersChange = (newFilters) => {
    setFilters(newFilters);
    setPage(1);
  };

  const handleCreate = async () => {
    const existing = await base44.entities.PortioningRun.list('-created_date', 1);
    const nextNum = existing.length > 0 ?
      (parseInt((existing[0].run_number || '').replace(/\D/g, '') || '0') + 1) : 1;
    const runNumber = `PORT-${new Date().getFullYear()}-${String(nextNum).padStart(4, '0')}`;

    const created = await base44.entities.PortioningRun.create({
      run_number: runNumber,
      run_date: format(new Date(), 'yyyy-MM-dd'),
      status: 'draft',
    });
    queryClient.invalidateQueries({ queryKey: ['portioning-runs'] });
    toast.success(`Portioning run ${runNumber} created`);
    setSelectedRun(created);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <UtensilsCrossed className="w-6 h-6 text-primary" /> Portioning Runs
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Portion bulk cooked WIP into individual meals
          </p>
        </div>
        {perms.portioning_create && (
          <Button onClick={handleCreate} className="gap-2 h-11 px-5">
            <Plus className="w-4 h-4" /> New Portioning Run
          </Button>
        )}
      </div>

      <PageHelp items={HELP_ITEMS} />

      {/* Status tabs */}
      <div className="flex gap-2 flex-wrap">
        {[
          { key: 'active', label: 'Active' },
          { key: 'draft', label: 'Draft' },
          { key: 'in_progress', label: 'In Progress' },
          { key: 'completed', label: 'Completed' },
          { key: 'all', label: 'All' },
        ].map(tab => (
          <button
            key={tab.key}
            onClick={() => { setStatusFilter(tab.key); setPage(1); }}
            className={`text-xs px-3 py-1.5 rounded-full font-medium transition-all ${
              statusFilter === tab.key ? 'bg-primary/10 text-primary ring-2 ring-primary/30' : 'bg-muted text-muted-foreground hover:bg-muted/80'
            }`}
          >
            {tab.label} ({tab.key === 'active' ? runs.filter(r => r.status !== 'completed').length :
              tab.key === 'all' ? runs.length : runs.filter(r => r.status === tab.key).length})
          </button>
        ))}
      </div>

      <POFilters filters={filters} onChange={handleFiltersChange} suppliers={[]} />

      {isLoading ? (
        <div className="text-center py-12 text-sm text-muted-foreground">Loading...</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12 text-sm text-muted-foreground">
          {runs.length === 0 ? 'No portioning runs yet.' : 'No runs match filter.'}
        </div>
      ) : (
        <>
          <div className="grid gap-3">
            {paginated.map(run => (
              <button
                key={run.id}
                onClick={() => setSelectedRun(run)}
                className="w-full text-left bg-card border border-border rounded-xl p-4 hover:shadow-md transition-all flex items-center justify-between group"
              >
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                    <UtensilsCrossed className="w-5 h-5 text-primary" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="text-sm font-bold font-mono">{run.run_number}</span>
                      <Badge className={`text-[10px] ${STATUS_STYLES[run.status] || ''}`}>{run.status?.replace('_', ' ')}</Badge>
                    </div>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1"><Clock className="w-3.5 h-3.5" />{run.run_date}</span>
                      {run.staff_assigned_names && <span>{run.staff_assigned_names}</span>}
                      {run.total_meals_portioned > 0 && <span className="font-medium text-foreground">{run.total_meals_portioned} meals</span>}
                    </div>
                  </div>
                </div>
                <ChevronRight className="w-4 h-4 text-muted-foreground group-hover:text-foreground" />
              </button>
            ))}
          </div>
          <POPagination
            page={safePage}
            totalPages={totalPages}
            totalItems={filtered.length}
            pageSize={pageSize}
            onPageChange={setPage}
            onPageSizeChange={v => { setPageSize(v); setPage(1); }}
          />
        </>
      )}

      {selectedRun && (
        <PortioningRunDrawer
          run={selectedRun}
          onClose={() => setSelectedRun(null)}
          onUpdated={() => {
            queryClient.invalidateQueries({ queryKey: ['portioning-runs'] });
            base44.entities.PortioningRun.filter({ id: selectedRun.id }).then(res => {
              if (res[0]) setSelectedRun(res[0]); else setSelectedRun(null);
            });
          }}
        />
      )}
    </div>
  );
}