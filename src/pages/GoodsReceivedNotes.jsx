import React, { useState, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { PackageCheck, Plus } from 'lucide-react';
import { useAuth } from '@/lib/AuthContext';
import { getUserPermissions } from '@/lib/permissions';
import { useCustomRoles } from '@/components/settings/CustomRolesManager';
import GRNCard from '@/components/grn/GRNCard';
import CreateGRNModal from '@/components/grn/CreateGRNModal';
import GRNDrawer from '@/components/grn/GRNDrawer';
import PageHelp from '@/components/help/PageHelp';
import POFilters from '@/components/purchasing/POFilters';
import POPagination from '@/components/purchasing/POPagination';

const HELP_ITEMS = [
  { title: 'Create a GRN', text: 'Click "New GRN" to start. Select supplier and receiving location. Optionally link to an existing PO to pre-populate expected lines.' },
  { title: 'Blind receipt', text: 'If no PO exists yet (e.g. supplier delivered without a formal order), leave the PO field blank. Add products manually from the supplier catalog.' },
  { title: 'Enter quantities', text: 'Open a draft GRN and click "Edit Quantities". Enter actual received qty for each line. The system auto-calculates internal stock qty using the conversion factor and yield.' },
  { title: 'Flag issues', text: 'Set line condition to "Damaged" or "Rejected" for problem items. Rejected items are excluded from stock movements.' },
  { title: 'Confirm receipt', text: 'Click "Confirm Receipt" to finalise. This creates stock movements, updates on-hand quantities, recalculates weighted average costs, and logs shortages for any under-deliveries.' },
];

const STATUS_TABS = [
  { key: 'draft', label: 'Draft' },
  { key: 'confirmed', label: 'Confirmed' },
  { key: 'all', label: 'All' },
];

export default function GoodsReceivedNotes() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { user } = useAuth();
  const customRoles = useCustomRoles();
  const perms = getUserPermissions(user || {}, customRoles);

  const handleGRNClick = (grn) => {
    if (grn.purchase_order_id) {
      navigate(`/purchasing/workspace/${grn.purchase_order_id}?tab=grn`);
    } else {
      setSelectedGRN(grn);
    }
  };

  const [statusTab, setStatusTab] = useState('draft');
  const [showCreate, setShowCreate] = useState(false);
  const [selectedGRN, setSelectedGRN] = useState(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [filters, setFilters] = useState({
    search: '',
    supplierId: 'all',
    dateFrom: null,
    dateTo: null,
    sortBy: 'date_desc',
  });

  const { data: grns = [], isLoading } = useQuery({
    queryKey: ['grns-list'],
    queryFn: () => base44.entities.GoodsReceivedNote.list('-received_date', 5000),
  });

  const { data: suppliers = [] } = useQuery({
    queryKey: ['suppliers-for-grn-filter'],
    queryFn: () => base44.entities.Supplier.list('name', 500),
  });

  const filtered = useMemo(() => {
    const safeGRNs = Array.isArray(grns) ? grns : [];
    const result = safeGRNs.filter(g => {
      if (statusTab !== 'all' && g.status !== statusTab) return false;
      if (filters.supplierId !== 'all' && g.supplier_id !== filters.supplierId) return false;
      if (filters.search) {
        const q = String(filters.search).toLowerCase();
        if (!String(g.grn_number || '').toLowerCase().includes(q) &&
            !String(g.supplier_name || '').toLowerCase().includes(q)) return false;
      }
      if (filters.dateFrom && g.received_date && new Date(g.received_date) < filters.dateFrom) return false;
      if (filters.dateTo && g.received_date) {
        const toEnd = new Date(filters.dateTo);
        toEnd.setHours(23, 59, 59, 999);
        if (new Date(g.received_date) > toEnd) return false;
      }
      return true;
    });

    const sorted = [...result];
    switch (filters.sortBy) {
      case 'date_desc':     sorted.sort((a, b) => String(b.received_date || '').localeCompare(String(a.received_date || ''))); break;
      case 'date_asc':      sorted.sort((a, b) => String(a.received_date || '').localeCompare(String(b.received_date || ''))); break;
      case 'total_desc':    sorted.sort((a, b) => (Number(b.total_received_value) || 0) - (Number(a.total_received_value) || 0)); break;
      case 'total_asc':     sorted.sort((a, b) => (Number(a.total_received_value) || 0) - (Number(b.total_received_value) || 0)); break;
      case 'supplier_asc':  sorted.sort((a, b) => String(a.supplier_name || '').localeCompare(String(b.supplier_name || ''))); break;
      case 'supplier_desc': sorted.sort((a, b) => String(b.supplier_name || '').localeCompare(String(a.supplier_name || ''))); break;
    }
    return sorted;
  }, [grns, statusTab, filters]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const paginated = filtered.slice((safePage - 1) * pageSize, safePage * pageSize);

  const handleFiltersChange = (newFilters) => {
    setFilters(newFilters);
    setPage(1);
  };

  const statusCounts = useMemo(() => {
    const safeGRNs = Array.isArray(grns) ? grns : [];
    const c = { all: safeGRNs.length };
    safeGRNs.forEach(g => { c[g.status] = (c[g.status] || 0) + 1; });
    return c;
  }, [grns]);

  const handleGRNUpdated = () => {
    try {
      const grnId = selectedGRN?.id;
      queryClient.invalidateQueries({ queryKey: ['grns-list'] });
      if (grnId) {
        base44.entities.GoodsReceivedNote.filter({ id: grnId }).then(res => {
          if (res?.[0]) setSelectedGRN?.(res[0]); else setSelectedGRN?.(null);
        }).catch(() => {
          setSelectedGRN?.(null);
        });
      }
    } catch (err) {
      console.error('[GRN] handleGRNUpdated error:', err);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <PackageCheck className="w-6 h-6 text-primary" /> Goods Received
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Record and confirm supplier deliveries
          </p>
        </div>
        {perms.grn_create && (
          <Button onClick={() => setShowCreate(true)} className="gap-2 h-11 px-5">
            <Plus className="w-4 h-4" /> New GRN
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
          {grns.length === 0 ? 'No GRNs yet. Click "New GRN" to record a delivery.' : 'No GRNs match your filter.'}
        </div>
      ) : (
        <>
          <div className="grid gap-3">
            {paginated.map(grn => (
              <GRNCard key={grn.id} grn={grn} onClick={handleGRNClick} />
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
        <CreateGRNModal
          onCreated={(newGRN) => {
            setShowCreate(false);
            queryClient.invalidateQueries({ queryKey: ['grns-list'] });
            if (newGRN) setSelectedGRN(newGRN);
          }}
          onCancel={() => setShowCreate(false)}
        />
      )}

      {selectedGRN && (
        <GRNDrawer
          grn={selectedGRN}
          onClose={() => setSelectedGRN(null)}
          onUpdated={handleGRNUpdated}
        />
      )}
    </div>
  );
}
