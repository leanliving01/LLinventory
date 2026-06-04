import React, { useState, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { SlidersHorizontal, Plus, Search, ArrowUp, ArrowDown } from 'lucide-react';
import { format } from 'date-fns';
import { formatZAR } from '@/lib/utils';
import { useAuth } from '@/lib/AuthContext';
import { getUserPermissions } from '@/lib/permissions';
import { useCustomRoles } from '@/components/settings/CustomRolesManager';
import StockAdjustForm from '@/components/stock-adjust/StockAdjustForm';

// Movement reasons used by manual adjustments (ref_type 'manual').
const ADJUST_MOVEMENT_REASONS = ['stocktake_adjustment', 'wastage_unusable', 'write_off'];

const REASON_BADGE = {
  stocktake_adjustment: 'bg-blue-100 text-blue-700',
  wastage_unusable: 'bg-amber-100 text-amber-700',
  write_off: 'bg-red-100 text-red-600',
};

const REASON_LABEL = {
  stocktake_adjustment: 'Adjustment',
  wastage_unusable: 'Wastage',
  write_off: 'Write Off',
};

const FILTERS = [
  { key: 'all', label: 'All', match: () => true },
  { key: 'in', label: 'Increases', match: m => !!m.to_location_id },
  { key: 'out', label: 'Decreases', match: m => !!m.from_location_id },
  { key: 'stocktake_adjustment', label: 'Adjustments', match: m => m.reason === 'stocktake_adjustment' },
  { key: 'wastage_unusable', label: 'Wastage', match: m => m.reason === 'wastage_unusable' },
  { key: 'write_off', label: 'Write Off', match: m => m.reason === 'write_off' },
];

export default function StockAdjustments() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const customRoles = useCustomRoles();
  const perms = getUserPermissions(user || {}, customRoles);
  const canView = !!perms.stocktake_view || !!perms.stocktake_create;
  const canCreate = !!perms.stocktake_create;

  const [showForm, setShowForm] = useState(false);
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');

  const { data: movements = [], isLoading } = useQuery({
    queryKey: ['stock-adjustments'],
    queryFn: () => base44.entities.StockMovement.filter({ ref_type: 'manual' }, '-created_date', 500),
    enabled: canView,
  });

  const adjustments = useMemo(() => {
    return movements.filter(m => ADJUST_MOVEMENT_REASONS.includes(m.reason));
  }, [movements]);

  const filtered = useMemo(() => {
    const f = FILTERS.find(x => x.key === filter) || FILTERS[0];
    let rows = adjustments.filter(f.match);
    if (search) {
      const s = search.toLowerCase();
      rows = rows.filter(m =>
        (m.product_name || '').toLowerCase().includes(s) ||
        (m.product_sku || '').toLowerCase().includes(s) ||
        (m.ref_number || '').toLowerCase().includes(s) ||
        (m.notes || '').toLowerCase().includes(s)
      );
    }
    return rows;
  }, [adjustments, filter, search]);

  const handleCreated = () => {
    queryClient.invalidateQueries({ queryKey: ['stock-adjustments'] });
    queryClient.invalidateQueries({ queryKey: ['stock-on-hand'] });
    setShowForm(false);
  };

  if (!canView) {
    return (
      <div className="text-center py-20 text-muted-foreground">
        <SlidersHorizontal className="w-10 h-10 mx-auto mb-3 opacity-30" />
        <p className="text-sm font-medium">You don't have permission to view stock adjustments.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <SlidersHorizontal className="w-6 h-6 text-primary" /> Stock Adjustments
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Manual corrections — damages, wastage, write-offs, internal use, value corrections, stock found
          </p>
        </div>
        {canCreate && (
          <Button onClick={() => setShowForm(!showForm)} className="gap-2">
            <Plus className="w-4 h-4" /> New Adjustment
          </Button>
        )}
      </div>

      {showForm && canCreate && (
        <StockAdjustForm
          user={user}
          canAdjustValue={canCreate}
          onCreated={handleCreated}
          onCancel={() => setShowForm(false)}
        />
      )}

      {/* Filter chips */}
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
        <div className="relative flex-1 min-w-[12rem] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search product, ref, or notes..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-9 h-9"
          />
        </div>
      </div>

      {isLoading ? (
        <div className="text-center py-12 text-sm text-muted-foreground">Loading adjustments...</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16">
          <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mx-auto mb-4">
            <SlidersHorizontal className="w-8 h-8 text-muted-foreground" />
          </div>
          <p className="text-sm font-medium">No adjustments here</p>
          <p className="text-xs text-muted-foreground mt-1">
            {canCreate ? 'Post a manual adjustment to get started.' : 'No adjustments match this filter.'}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map(m => {
            const isIn = !!m.to_location_id;
            const value = (m.qty || 0) * (m.unit_cost_at_movement || 0);
            return (
              <div
                key={m.id}
                className="w-full bg-card border border-border rounded-xl px-4 py-3 flex items-center gap-3"
              >
                <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${isIn ? 'bg-green-100' : 'bg-red-100'}`}>
                  {isIn ? <ArrowUp className="w-4 h-4 text-green-600" /> : <ArrowDown className="w-4 h-4 text-red-600" />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-sm truncate">{m.product_name || m.product_sku}</span>
                    <Badge className={`text-[10px] ${REASON_BADGE[m.reason] || 'bg-gray-100 text-gray-600'}`}>
                      {REASON_LABEL[m.reason] || m.reason}
                    </Badge>
                    {m.ref_number && <span className="text-[10px] font-mono text-muted-foreground">{m.ref_number}</span>}
                  </div>
                  <div className="flex items-center gap-2 mt-0.5 text-xs text-muted-foreground flex-wrap">
                    <span className="font-mono">{m.product_sku}</span>
                    {m.notes && <span className="truncate max-w-md">· {m.notes}</span>}
                    {m.created_date && <span>· {format(new Date(m.created_date), 'dd MMM yyyy HH:mm')}</span>}
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <p className={`text-sm font-bold tabular-nums ${isIn ? 'text-green-600' : 'text-red-600'}`}>
                    {isIn ? '+' : '-'}{m.qty} <span className="text-xs font-normal text-muted-foreground">{m.uom}</span>
                  </p>
                  {value > 0 && <p className="text-[11px] text-muted-foreground tabular-nums">{formatZAR(value)}</p>}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
