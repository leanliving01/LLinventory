import React, { useState, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ClipboardCheck, Plus, MapPin, ChevronRight, FileSpreadsheet } from 'lucide-react';
import { format } from 'date-fns';
import { useAuth } from '@/lib/AuthContext';
import { getUserPermissions } from '@/lib/permissions';
import { useCustomRoles } from '@/components/settings/CustomRolesManager';
import CreatePlannedCountModal from '@/components/stock-count/CreatePlannedCountModal';
import StockCountCSVImport from '@/components/stock-count/StockCountCSVImport';
import { COUNT_STATUS } from '@/lib/stockCount';

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
  const [showCreate, setShowCreate] = useState(false);
  const [showImport, setShowImport] = useState(false);

  const { data: counts = [], isLoading } = useQuery({
    queryKey: ['stock-counts'],
    queryFn: () => base44.entities.NewStockTake.list('-created_date', 500),
  });

  const filtered = useMemo(() => {
    const f = FILTERS.find(x => x.key === filter) || FILTERS[0];
    return counts.filter(c => f.match(c.status));
  }, [counts, filter]);

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
              <button
                key={c.id}
                onClick={() => navigate(`/stock/stock-take/${c.id}`)}
                className="w-full text-left bg-card border border-border rounded-xl px-4 py-3 flex items-center gap-3 hover:border-primary/30 transition-colors"
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
