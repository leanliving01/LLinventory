import React, { useState, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { ClipboardCheck, Plus, MapPin, ChevronRight, FileSpreadsheet, Trash2, Loader2 } from 'lucide-react';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { useAuth } from '@/lib/AuthContext';
import { getUserPermissions } from '@/lib/permissions';
import { useCustomRoles } from '@/components/settings/CustomRolesManager';
import CreatePlannedCountModal from '@/components/stock-count/CreatePlannedCountModal';
import StockCountCSVImport from '@/components/stock-count/StockCountCSVImport';
import StockCountFilters, { EMPTY_STOCK_COUNT_FILTERS } from '@/components/stock-count/StockCountFilters';
import { COUNT_STATUS, deleteStockCount } from '@/lib/stockCount';

const STATUS_STYLES = {
  draft: 'bg-gray-100 text-gray-600',
  open: 'bg-blue-100 text-blue-700',
  in_progress: 'bg-amber-100 text-amber-700',
  floor_completed: 'bg-purple-100 text-purple-700',
  under_review: 'bg-purple-100 text-purple-700',
  recount_requested: 'bg-orange-100 text-orange-700',
  recount_in_progress: 'bg-orange-100 text-orange-700',
  completed: 'bg-green-100 text-green-700',
  cancelled: 'bg-red-100 text-red-600',
};

const FILTERS = [
  { key: 'active', label: 'Active', match: s => !['completed', 'cancelled'].includes(s) },
  { key: 'open', label: 'Open', match: s => ['open', 'in_progress'].includes(s) },
  { key: 'review', label: 'For Review', match: s => ['floor_completed', 'under_review'].includes(s) },
  { key: 'recount', label: 'Recount', match: s => ['recount_requested', 'recount_in_progress'].includes(s) },
  { key: 'completed', label: 'Completed', match: s => s === 'completed' },
  { key: 'cancelled', label: 'Cancelled', match: s => s === 'cancelled' },
  { key: 'all', label: 'All', match: () => true },
];

export default function StockCounts() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const customRoles = useCustomRoles();
  const perms = getUserPermissions(user || {}, customRoles);
  const canCreate = !!perms.stocktake_create;

  const [filter, setFilter] = useState('active');
  const [advFilters, setAdvFilters] = useState({ ...EMPTY_STOCK_COUNT_FILTERS });
  const [showCreate, setShowCreate] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [selected, setSelected] = useState(() => new Set());
  const [deleting, setDeleting] = useState(false);

  const { data: counts = [], isLoading } = useQuery({
    queryKey: ['stock-counts'],
    queryFn: () => base44.entities.NewStockTake.list('-created_date', 500),
  });

  const filtered = useMemo(() => {
    const f = FILTERS.find(x => x.key === filter) || FILTERS[0];
    const search = (advFilters.search || '').trim().toLowerCase();
    const assignee = (advFilters.assignee || '').trim().toLowerCase();
    return counts.filter(c => {
      if (!f.match(c.status)) return false;

      if (search) {
        const hay = `${c.reference || ''} ${c.location_name || ''}`.toLowerCase();
        if (!hay.includes(search)) return false;
      }

      if (advFilters.locationId && advFilters.locationId !== 'all') {
        if (c.location_id !== advFilters.locationId) return false;
      }

      if (advFilters.countType && advFilters.countType !== 'all') {
        if (c.count_type !== advFilters.countType) return false;
      }

      if (advFilters.dateFrom) {
        if (!c.stocktake_date || c.stocktake_date < advFilters.dateFrom) return false;
      }
      if (advFilters.dateTo) {
        if (!c.stocktake_date || c.stocktake_date > advFilters.dateTo) return false;
      }

      if (assignee) {
        if (!(c.assigned_to_name || '').toLowerCase().includes(assignee)) return false;
      }

      return true;
    });
  }, [counts, filter, advFilters]);

  const toggle = (id) => setSelected(prev => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });
  const allVisibleSelected = filtered.length > 0 && filtered.every(c => selected.has(c.id));
  const toggleAll = () => setSelected(prev => {
    if (filtered.every(c => prev.has(c.id))) {
      const next = new Set(prev);
      filtered.forEach(c => next.delete(c.id));
      return next;
    }
    return new Set([...prev, ...filtered.map(c => c.id)]);
  });

  const selectedCounts = useMemo(
    () => counts.filter(c => selected.has(c.id)),
    [counts, selected]
  );
  const activeSelectedCount = selectedCounts.filter(c => !['completed', 'cancelled'].includes(c.status)).length;

  const handleDeleteSelected = async () => {
    setDeleting(true);
    try {
      for (const id of selected) await deleteStockCount(id);
      toast.success(`Deleted ${selected.size} count${selected.size > 1 ? 's' : ''}`);
      setSelected(new Set());
      queryClient.invalidateQueries({ queryKey: ['stock-counts'] });
    } catch (err) {
      toast.error('Delete failed: ' + (err.message || 'Unknown error'));
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <ClipboardCheck className="w-6 h-6 text-primary" /> Stock Counts
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Plan counts, review floor counts, and post approved counts to stock
          </p>
        </div>
        {canCreate && (
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => setShowImport(true)} className="gap-2">
              <FileSpreadsheet className="w-4 h-4" /> Import CSV
            </Button>
            <Button onClick={() => setShowCreate(true)} className="gap-2">
              <Plus className="w-4 h-4" /> New Planned Count
            </Button>
          </div>
        )}
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        {FILTERS.map(f => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
              filter === f.key ? 'bg-primary text-primary-foreground border-primary' : 'border-border text-muted-foreground hover:bg-muted'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      <StockCountFilters filters={advFilters} onChange={setAdvFilters} />

      {/* Selection / delete bar */}
      {canCreate && filtered.length > 0 && (
        <div className="flex items-center gap-3 px-3 py-2 rounded-lg bg-muted/40 border border-border text-sm flex-wrap">
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <Checkbox checked={allVisibleSelected} onCheckedChange={toggleAll} />
            <span className="text-xs text-muted-foreground">Select all ({filtered.length})</span>
          </label>
          {selected.size > 0 && (
            <>
              <span className="text-xs font-medium">{selected.size} selected</span>
              <button onClick={() => setSelected(new Set())} className="text-xs text-muted-foreground hover:text-foreground underline">
                Clear
              </button>
              <div className="ml-auto">
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="outline" size="sm" className="gap-1.5 text-destructive border-destructive/40 hover:bg-destructive/10">
                      {deleting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                      Delete ({selected.size})
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Delete {selected.size} stock count{selected.size > 1 ? 's' : ''}?</AlertDialogTitle>
                      <AlertDialogDescription>
                        This permanently removes the selected count{selected.size > 1 ? 's' : ''} and all their lines.
                        {activeSelectedCount > 0 && (
                          <> <strong>{activeSelectedCount}</strong> of them {activeSelectedCount > 1 ? 'are' : 'is'} still active and freezing stock — deleting releases that freeze without posting any counts.</>
                        )}
                        {' '}This can't be undone. Posted stock movements from completed counts are kept.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Keep them</AlertDialogCancel>
                      <AlertDialogAction onClick={handleDeleteSelected} className="bg-destructive hover:bg-destructive/90">
                        Delete
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            </>
          )}
        </div>
      )}

      {isLoading ? (
        <div className="text-center py-12 text-sm text-muted-foreground">Loading...</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16">
          <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mx-auto mb-4">
            <ClipboardCheck className="w-8 h-8 text-muted-foreground" />
          </div>
          <p className="text-sm font-medium">No stock counts here</p>
          <p className="text-xs text-muted-foreground mt-1">
            {canCreate ? 'Create a planned count to get started.' : 'No counts match this filter.'}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map(c => {
            const counted = (c.total_lines || 0) - (c.uncounted_count || 0);
            return (
              <div
                key={c.id}
                className="w-full bg-card border border-border rounded-xl pl-3 pr-4 py-3 flex items-center gap-3 hover:border-primary/30 transition-colors"
              >
                {canCreate && (
                  <Checkbox
                    checked={selected.has(c.id)}
                    onCheckedChange={() => toggle(c.id)}
                    aria-label={`Select ${c.reference || 'count'}`}
                    className="shrink-0"
                  />
                )}
                <button
                  onClick={() => navigate(`/stock/stock-take/${c.id}`)}
                  className="flex-1 min-w-0 text-left flex items-center gap-3"
                >
                  <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                    <ClipboardCheck className="w-4 h-4 text-primary" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono font-semibold text-sm">{c.reference || c.id.slice(0, 8)}</span>
                      <Badge className={`text-[10px] ${STATUS_STYLES[c.status] || 'bg-gray-100 text-gray-600'}`}>
                        {COUNT_STATUS[c.status] || c.status}
                      </Badge>
                      <span className="text-[10px] text-muted-foreground uppercase">{c.count_type}</span>
                    </div>
                    <div className="flex items-center gap-2 mt-0.5 text-xs text-muted-foreground flex-wrap">
                      <span className="flex items-center gap-1"><MapPin className="w-3 h-3" /> {c.location_name || '—'}</span>
                      <span>{c.stocktake_date ? format(new Date(c.stocktake_date), 'dd MMM yyyy') : ''}</span>
                      <span>{counted}/{c.total_lines || 0} counted</span>
                      {c.assigned_to_name && <span>· {c.assigned_to_name}</span>}
                    </div>
                  </div>
                  <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
                </button>
              </div>
            );
          })}
        </div>
      )}

      {showCreate && (
        <CreatePlannedCountModal
          onCreated={(header) => {
            setShowCreate(false);
            queryClient.invalidateQueries({ queryKey: ['stock-counts'] });
            navigate(`/stock/stock-take/${header.id}`);
          }}
          onCancel={() => setShowCreate(false)}
        />
      )}

      {showImport && (
        <StockCountCSVImport
          onImported={(header) => {
            setShowImport(false);
            queryClient.invalidateQueries({ queryKey: ['stock-counts'] });
            navigate(`/stock/stock-take/${header.id}`);
          }}
          onCancel={() => setShowImport(false)}
        />
      )}
    </div>
  );
}
