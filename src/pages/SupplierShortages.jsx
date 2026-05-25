import React, { useState, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { AlertTriangle } from 'lucide-react';
import { useAuth } from '@/lib/AuthContext';
import { getUserPermissions } from '@/lib/permissions';
import { useCustomRoles } from '@/components/settings/CustomRolesManager';
import ShortageCard from '@/components/shortages/ShortageCard';
import ShortageDrawer from '@/components/shortages/ShortageDrawer';
import PageHelp from '@/components/help/PageHelp';
import POFilters from '@/components/purchasing/POFilters';
import POPagination from '@/components/purchasing/POPagination';

const HELP_ITEMS = [
  { title: 'What are shortages?', text: 'When a GRN is confirmed and the received quantity is less than expected, the system automatically creates a shortage record for the difference.' },
  { title: 'Resolve a shortage', text: 'Click on an open shortage and choose a resolution: Follow-up Delivery (supplier will send the rest), Credit Received (supplier issued a credit note), or Write Off (absorb the loss).' },
  { title: 'Track by supplier', text: 'Use the search to filter by supplier or product name to identify repeat offenders.' },
];

const STATUS_TABS = [
  { key: 'open', label: 'Open' },
  { key: 'all_resolved', label: 'Resolved' },
  { key: 'all', label: 'All' },
];

export default function SupplierShortages() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const customRoles = useCustomRoles();
  const perms = getUserPermissions(user || {}, customRoles);

  const [statusTab, setStatusTab] = useState('open');
  const [selected, setSelected] = useState(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [filters, setFilters] = useState({
    search: '',
    supplierId: 'all',
    dateFrom: null,
    dateTo: null,
    sortBy: 'date_desc',
  });

  const { data: shortages = [], isLoading } = useQuery({
    queryKey: ['supplier-shortages'],
    queryFn: () => base44.entities.SupplierShortage.list('-created_date', 5000),
  });

  const { data: suppliers = [] } = useQuery({
    queryKey: ['suppliers-for-shortages-filter'],
    queryFn: () => base44.entities.Supplier.list('name', 500),
  });

  const filtered = useMemo(() => {
    const result = shortages.filter(s => {
      if (statusTab === 'open' && s.status !== 'open') return false;
      if (statusTab === 'all_resolved' && s.status === 'open') return false;
      if (filters.supplierId !== 'all' && s.supplier_id !== filters.supplierId) return false;
      if (filters.search) {
        const q = filters.search.toLowerCase();
        if (!(s.product_name || '').toLowerCase().includes(q) &&
            !(s.product_sku || '').toLowerCase().includes(q) &&
            !(s.supplier_name || '').toLowerCase().includes(q)) return false;
      }
      if (filters.dateFrom && s.created_date && new Date(s.created_date) < filters.dateFrom) return false;
      if (filters.dateTo && s.created_date) {
        const toEnd = new Date(filters.dateTo);
        toEnd.setHours(23, 59, 59, 999);
        if (new Date(s.created_date) > toEnd) return false;
      }
      return true;
    });

    const sorted = [...result];
    switch (filters.sortBy) {
      case 'date_desc':     sorted.sort((a, b) => (b.created_date || '').localeCompare(a.created_date || '')); break;
      case 'date_asc':      sorted.sort((a, b) => (a.created_date || '').localeCompare(b.created_date || '')); break;
      case 'total_desc':    sorted.sort((a, b) => (b.shortage_value || 0) - (a.shortage_value || 0)); break;
      case 'total_asc':     sorted.sort((a, b) => (a.shortage_value || 0) - (b.shortage_value || 0)); break;
      case 'supplier_asc':  sorted.sort((a, b) => (a.supplier_name || '').localeCompare(b.supplier_name || '')); break;
      case 'supplier_desc': sorted.sort((a, b) => (b.supplier_name || '').localeCompare(a.supplier_name || '')); break;
    }
    return sorted;
  }, [shortages, statusTab, filters]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const paginated = filtered.slice((safePage - 1) * pageSize, safePage * pageSize);

  const handleFiltersChange = (newFilters) => {
    setFilters(newFilters);
    setPage(1);
  };

  const openCount = shortages.filter(s => s.status === 'open').length;
  const resolvedCount = shortages.filter(s => s.status !== 'open').length;
  const totalOpenValue = shortages
    .filter(s => s.status === 'open')
    .reduce((sum, s) => sum + (s.shortage_value || 0), 0);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <AlertTriangle className="w-6 h-6 text-amber-600" /> Supplier Shortages
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Track and resolve under-deliveries from suppliers
          </p>
        </div>
        {totalOpenValue > 0 && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-2 text-right">
            <p className="text-[10px] text-amber-600 uppercase font-semibold">Open Shortage Value</p>
            <p className="text-lg font-bold text-amber-700">R {totalOpenValue.toLocaleString('en-ZA', { minimumFractionDigits: 2 })}</p>
          </div>
        )}
      </div>

      <PageHelp items={HELP_ITEMS} />

      {/* Status tabs */}
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
            {tab.label} ({tab.key === 'open' ? openCount : tab.key === 'all_resolved' ? resolvedCount : shortages.length})
          </button>
        ))}
      </div>

      {/* Filters */}
      <POFilters filters={filters} onChange={handleFiltersChange} suppliers={suppliers} />

      {/* List */}
      {isLoading ? (
        <div className="text-center py-12 text-sm text-muted-foreground">Loading...</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12 text-sm text-muted-foreground">
          {shortages.length === 0 ? 'No shortages recorded yet.' : 'No shortages match your filter.'}
        </div>
      ) : (
        <>
          <div className="grid gap-3">
            {paginated.map(s => (
              <ShortageCard key={s.id} shortage={s} onClick={setSelected} />
            ))}
          </div>
          <POPagination
            page={safePage}
            totalPages={totalPages}
            totalItems={filtered.length}
            pageSize={pageSize}
            onPageChange={setPage}
            onPageSizeChange={(sz) => { setPageSize(sz); setPage(1); }}
          />
        </>
      )}

      {selected && (
        <ShortageDrawer
          shortage={selected}
          onClose={() => setSelected(null)}
          onUpdated={() => queryClient.invalidateQueries({ queryKey: ['supplier-shortages'] })}
          canResolve={perms.returns_process}
        />
      )}
    </div>
  );
}
