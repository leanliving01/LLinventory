import React, { useState, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { RotateCcw, Plus } from 'lucide-react';
import { useAuth } from '@/lib/AuthContext';
import { getUserPermissions } from '@/lib/permissions';
import { useCustomRoles } from '@/components/settings/CustomRolesManager';
import ReturnCard from '@/components/returns/ReturnCard';
import CreateReturnModal from '@/components/returns/CreateReturnModal';
import ReturnDrawer from '@/components/returns/ReturnDrawer';
import PageHelp from '@/components/help/PageHelp';
import POFilters from '@/components/purchasing/POFilters';
import POPagination from '@/components/purchasing/POPagination';

const HELP_ITEMS = [
  { title: 'Create a return', text: 'Click "New Return" to start. Select a supplier, choose a confirmed GRN, then pick the lines you want to return with quantities and reasons.' },
  { title: 'Process the return', text: 'Open a pending return and click "Mark as Returned". This deducts the returned items from stock (creates stock OUT movements).' },
  { title: 'Record credit note', text: 'Once the supplier issues a credit, open the returned record and enter the credit note number to mark it as resolved.' },
];

const STATUS_TABS = [
  { key: 'pending_return', label: 'Pending' },
  { key: 'returned', label: 'Returned' },
  { key: 'credit_received', label: 'Credit Received' },
  { key: 'all', label: 'All' },
];

export default function SupplierReturns() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const customRoles = useCustomRoles();
  const perms = getUserPermissions(user || {}, customRoles);

  const [statusTab, setStatusTab] = useState('pending_return');
  const [showCreate, setShowCreate] = useState(false);
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

  const { data: returns = [], isLoading } = useQuery({
    queryKey: ['supplier-returns'],
    queryFn: () => base44.entities.SupplierReturn.list('-created_date', 5000),
  });

  const { data: suppliers = [] } = useQuery({
    queryKey: ['suppliers-for-returns-filter'],
    queryFn: () => base44.entities.Supplier.list('name', 500),
  });

  const filtered = useMemo(() => {
    const result = returns.filter(r => {
      if (statusTab !== 'all' && r.status !== statusTab) return false;
      if (filters.supplierId !== 'all' && r.supplier_id !== filters.supplierId) return false;
      if (filters.search) {
        const q = filters.search.toLowerCase();
        if (!(r.return_number || '').toLowerCase().includes(q) &&
            !(r.supplier_name || '').toLowerCase().includes(q)) return false;
      }
      if (filters.dateFrom && r.created_date && new Date(r.created_date) < filters.dateFrom) return false;
      if (filters.dateTo && r.created_date) {
        const toEnd = new Date(filters.dateTo);
        toEnd.setHours(23, 59, 59, 999);
        if (new Date(r.created_date) > toEnd) return false;
      }
      return true;
    });

    const sorted = [...result];
    switch (filters.sortBy) {
      case 'date_desc':     sorted.sort((a, b) => (b.created_date || '').localeCompare(a.created_date || '')); break;
      case 'date_asc':      sorted.sort((a, b) => (a.created_date || '').localeCompare(b.created_date || '')); break;
      case 'total_desc':    sorted.sort((a, b) => (b.total_return_value || 0) - (a.total_return_value || 0)); break;
      case 'total_asc':     sorted.sort((a, b) => (a.total_return_value || 0) - (b.total_return_value || 0)); break;
      case 'supplier_asc':  sorted.sort((a, b) => (a.supplier_name || '').localeCompare(b.supplier_name || '')); break;
      case 'supplier_desc': sorted.sort((a, b) => (b.supplier_name || '').localeCompare(a.supplier_name || '')); break;
    }
    return sorted;
  }, [returns, statusTab, filters]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const paginated = filtered.slice((safePage - 1) * pageSize, safePage * pageSize);

  const handleFiltersChange = (newFilters) => {
    setFilters(newFilters);
    setPage(1);
  };

  const statusCounts = useMemo(() => {
    const c = { all: returns.length };
    returns.forEach(r => { c[r.status] = (c[r.status] || 0) + 1; });
    return c;
  }, [returns]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <RotateCcw className="w-6 h-6 text-red-600" /> Supplier Returns
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Manage product returns and credit notes
          </p>
        </div>
        {perms.returns_process && (
          <Button onClick={() => setShowCreate(true)} className="gap-2 h-11 px-5">
            <Plus className="w-4 h-4" /> New Return
          </Button>
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
            {tab.label} ({statusCounts[tab.key] || 0})
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
          {returns.length === 0 ? 'No returns yet.' : 'No returns match your filter.'}
        </div>
      ) : (
        <>
          <div className="grid gap-3">
            {paginated.map(r => (
              <ReturnCard key={r.id} ret={r} onClick={setSelected} />
            ))}
          </div>
          <POPagination
            page={safePage}
            totalPages={totalPages}
            totalItems={filtered.length}
            pageSize={pageSize}
            onPageChange={setPage}
            onPageSizeChange={(s) => { setPageSize(s); setPage(1); }}
          />
        </>
      )}

      {showCreate && (
        <CreateReturnModal
          onCreated={(newRet) => {
            setShowCreate(false);
            queryClient.invalidateQueries({ queryKey: ['supplier-returns'] });
            if (newRet) setSelected(newRet);
          }}
          onCancel={() => setShowCreate(false)}
        />
      )}

      {selected && (
        <ReturnDrawer
          ret={selected}
          onClose={() => setSelected(null)}
          onUpdated={() => {
            queryClient.invalidateQueries({ queryKey: ['supplier-returns'] });
            base44.entities.SupplierReturn.filter({ id: selected.id }).then(res => {
              if (res[0]) setSelected(res[0]); else setSelected(null);
            });
          }}
          canProcess={perms.returns_process}
        />
      )}
    </div>
  );
}
