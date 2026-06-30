import React, { useState, useMemo, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Plus, Receipt, ChevronRight, AlertTriangle, Settings, PackageCheck } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import CreatePOModal from '@/components/purchasing/CreatePOModal';
import CreateBlindReceiptModal from '@/components/grn/CreateBlindReceiptModal';
import PODetailDrawer from '@/components/purchasing/PODetailDrawer';
import POFilters from '@/components/purchasing/POFilters';
import POPagination from '@/components/purchasing/POPagination';
import SyncStatusBanner from '@/components/shopify/SyncStatusBanner';
import SmartFolderNav from '@/components/purchasing/SmartFolderNav';
import { toast } from 'sonner';
import { useAuth } from '@/lib/AuthContext';
import { getUserPermissions } from '@/lib/permissions';
import { useCustomRoles } from '@/components/settings/CustomRolesManager';
import { dueDateColour } from '@/lib/utils';
import { usePersistentState, useScrollRestoration } from '@/lib/usePersistentState';
import { buildPoFolderContext, matchesFolder, PO_FOLDER_KEYS } from '@/lib/poFolders';

const STATUS_COLORS = {
  draft: 'bg-gray-100 text-gray-600',
  confirmed: 'bg-blue-100 text-blue-700',
  partially_received: 'bg-amber-100 text-amber-700',
  received: 'bg-green-100 text-green-700',
  invoiced: 'bg-purple-100 text-purple-700',
  credit_note_pending: 'bg-orange-100 text-orange-700',
  paid: 'bg-green-100 text-green-700',
  cancelled: 'bg-red-100 text-red-600',
};

const STATUS_LABELS = {
  draft: 'Draft',
  confirmed: 'Confirmed',
  partially_received: 'Partial',
  received: 'Received',
  invoiced: 'Invoiced',
  credit_note_pending: 'Credit Note Pending',
  paid: 'Paid',
  cancelled: 'Cancelled',
};

export default function PurchaseOrders() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { user } = useAuth();
  const customRoles = useCustomRoles();
  const perms = getUserPermissions(user || {}, customRoles);
  // View/filter state persists for the session so returning from a PO workspace
  // restores the same queue, filters and page instead of resetting to defaults.
  const [statusFilter, setStatusFilter] = usePersistentState('po:statusFilter', 'open');
  const [showCreate, setShowCreate] = useState(false);
  const [showBlind, setShowBlind] = useState(false);
  const [selectedPO, setSelectedPO] = useState(null);
  const [page, setPage] = usePersistentState('po:page', 1);
  const [pageSize, setPageSize] = usePersistentState('po:pageSize', 50);
  const [filters, setFilters] = usePersistentState('po:filters', {
    search: '',
    supplierId: 'all',
    dateFrom: null,
    dateTo: null,
    sortBy: 'date_desc',
  });

  const [needsAttentionOnly, setNeedsAttentionOnly] = usePersistentState('po:needsAttentionOnly', false);
  const [activeFolderRaw, setActiveFolder] = usePersistentState('po:activeFolder', 'all');
  const [creditReturnsFilter, setCreditReturnsFilter] = usePersistentState('po:creditReturnsFilter', 'all');
  // Normalise any legacy/removed folder key (e.g. 'paid', 'awaiting_grn') back to 'all'.
  const activeFolder = PO_FOLDER_KEYS.includes(activeFolderRaw) ? activeFolderRaw : 'all';

  const { data: pos = [], isLoading } = useQuery({
    queryKey: ['purchase-orders'],
    queryFn: () => base44.entities.PurchaseOrder.list('-created_date', 5000),
  });

  // Restore scroll position when returning from a PO workspace/detail.
  useScrollRestoration('po:scroll', !isLoading);

  // Auto-refresh on Xero PO sync progress
  const { data: syncStates = [] } = useQuery({
    queryKey: ['sync-states'],
    queryFn: () => base44.entities.SyncState.filter({}),
    refetchInterval: (q) => {
      const s = q.state.data || [];
      return s.some(x => x.sync_status === 'running' || x.sync_status === 'cancelling') ? 3000 : 30000;
    },
  });
  const xeroPoState = syncStates.find(s => s.source_key === 'xero_purchase_orders');
  useEffect(() => {
    queryClient.invalidateQueries({ queryKey: ['purchase-orders'] });
    queryClient.invalidateQueries({ queryKey: ['po-lines-all'] });
  }, [xeroPoState?.records_synced, xeroPoState?.sync_status, queryClient]);

  // Load lines to identify POs needing manual qty adjustment (qty≤1, total>50)
  const { data: allLines = [] } = useQuery({
    queryKey: ['po-lines-all'],
    queryFn: () => base44.entities.PurchaseOrderLine.list('created_date', 5000),
  });

  // Data for SmartFolderNav (shared queryKeys with dashboard = served from React Query cache)
  const { data: grns = [] } = useQuery({
    queryKey: ['pdash-grns'],
    queryFn: () => base44.entities.GoodsReceivedNote.list('-received_date', 500),
    staleTime: 60000,
  });
  const { data: invoices = [] } = useQuery({
    queryKey: ['pdash-invoices'],
    queryFn: () => base44.entities.PurchaseInvoice.list('-invoice_date', 500),
    staleTime: 60000,
  });
  const { data: returns = [] } = useQuery({
    queryKey: ['pdash-returns'],
    queryFn: () => base44.entities.SupplierReturn.list('-created_date', 200),
    staleTime: 60000,
  });
  const { data: creditNotes = [] } = useQuery({
    queryKey: ['supplier-credit-notes'],
    queryFn: () => base44.entities.SupplierCreditNote.list('-created_date', 200),
    staleTime: 60000,
  });

  const posNeedingAttention = useMemo(() => {
    const poIds = new Set();
    allLines.forEach(l => {
      if (l.ordered_qty <= 1 && (l.line_total || 0) > 50) {
        poIds.add(l.purchase_order_id);
      }
    });
    return poIds;
  }, [allLines]);

  // Unique suppliers for the filter dropdown
  const supplierOptions = useMemo(() => {
    const map = {};
    pos.forEach(po => {
      if (po.supplier_id && po.supplier_name) map[po.supplier_id] = po.supplier_name;
    });
    return Object.entries(map)
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [pos]);

  const folderCtx = useMemo(
    () => buildPoFolderContext({ grns, invoices, creditNotes, returns, posNeedingAttention }),
    [grns, invoices, creditNotes, returns, posNeedingAttention]
  );

  const filtered = useMemo(() => {
    let result = pos.filter(po => {
      // Smart-folder filter (always active; defaults to 'all')
      if (!matchesFolder(po, activeFolder, folderCtx, creditReturnsFilter)) return false;

      // Text search (always applied)
      if (filters.search) {
        const q = filters.search.toLowerCase();
        if (!(po.po_number || '').toLowerCase().includes(q) &&
            !(po.supplier_name || '').toLowerCase().includes(q) &&
            !(po.supplier_invoice_number || '').toLowerCase().includes(q)) return false;
      }

      // Supplier filter
      if (filters.supplierId !== 'all' && po.supplier_id !== filters.supplierId) return false;

      // Date range filter (on order_date)
      if (filters.dateFrom && po.order_date) {
        if (new Date(po.order_date) < filters.dateFrom) return false;
      }
      if (filters.dateTo && po.order_date) {
        const toEnd = new Date(filters.dateTo);
        toEnd.setHours(23, 59, 59, 999);
        if (new Date(po.order_date) > toEnd) return false;
      }

      return true;
    });

    // Sort
    const [field, dir] = filters.sortBy.split('_');
    const mult = dir === 'asc' ? 1 : -1;
    result.sort((a, b) => {
      if (field === 'date') {
        return mult * ((a.order_date || '').localeCompare(b.order_date || ''));
      }
      if (field === 'total') {
        return mult * ((a.total || 0) - (b.total || 0));
      }
      if (field === 'supplier') {
        return mult * ((a.supplier_name || '').localeCompare(b.supplier_name || ''));
      }
      return 0;
    });

    return result;
  }, [pos, filters, folderCtx, activeFolder, creditReturnsFilter]);

  // Pagination
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const paginatedPOs = filtered.slice((safePage - 1) * pageSize, safePage * pageSize);

  // Reset to page 1 when filters change
  const handleFiltersChange = (newFilters) => {
    setFilters(newFilters);
    setPage(1);
  };

  const statusCounts = useMemo(() => {
    const c = { open: 0 };
    pos.forEach(po => {
      c[po.status] = (c[po.status] || 0) + 1;
      if (!['received', 'paid', 'cancelled'].includes(po.status)) c.open += 1;
    });
    return c;
  }, [pos]);

  const dueDateClass = (dateStr) => {
    const colour = dueDateColour(dateStr);
    if (colour === 'red') return 'text-red-600 font-semibold';
    if (colour === 'amber') return 'text-amber-600';
    return 'text-green-700';
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Purchase Orders</h1>
          <p className="text-sm text-muted-foreground mt-0.5">{filtered.length} of {pos.length} orders</p>
        </div>
        <div className="flex items-center gap-2">
          {perms.po_create && (
            <Link to="/purchasing/settings">
              <Button variant="outline" className="gap-2">
                <Settings className="w-4 h-4" /> Settings
              </Button>
            </Link>
          )}
          {perms.po_create && (
            <Button variant="outline" onClick={() => setShowBlind(true)} className="gap-2">
              <PackageCheck className="w-4 h-4" /> Blind Receipt
            </Button>
          )}
          {perms.po_create && (
            <Button onClick={() => navigate('/purchasing/purchase-orders/new')} className="gap-2">
              <Plus className="w-4 h-4" /> New PO
            </Button>
          )}
        </div>
      </div>

      {perms.po_create && (
        <SyncStatusBanner syncKeys={['xero_purchase_orders']} title="Xero PO Sync" />
      )}

      {/* Needs Attention banner (only when no folder active) */}
      {!activeFolder && posNeedingAttention.size > 0 && (
        <button
          onClick={() => { setNeedsAttentionOnly(!needsAttentionOnly); setPage(1); }}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-all w-full ${
            needsAttentionOnly
              ? 'bg-amber-100 text-amber-800 ring-2 ring-amber-300'
              : 'bg-amber-50 text-amber-700 hover:bg-amber-100'
          }`}
        >
          <AlertTriangle className="w-4 h-4" />
          <span>{posNeedingAttention.size} order{posNeedingAttention.size !== 1 ? 's' : ''} need manual quantity adjustment</span>
          <span className="ml-auto text-xs underline">{needsAttentionOnly ? 'Show all' : 'Show only these'}</span>
        </button>
      )}

      {/* Status chips removed in favor of Smart Folders */}

      {/* Filters */}
      <POFilters filters={filters} onChange={handleFiltersChange} suppliers={supplierOptions} />

      {/* Main layout: SmartFolderNav + table */}
      <div className="flex gap-4 items-start">
        <SmartFolderNav
          pos={pos}
          grns={grns}
          invoices={invoices}
          returns={returns}
          creditNotes={creditNotes}
          posNeedingAttention={posNeedingAttention}
          activeFolder={activeFolder}
          onFolderSelect={key => { setActiveFolder(key); setPage(1); }}
          creditReturnsFilter={creditReturnsFilter}
          onCreditReturnsFilterChange={key => { setCreditReturnsFilter(key); setPage(1); }}
        />

        <div className="flex-1 min-w-0">
          {/* Table */}
          {isLoading ? (
            <div className="text-center py-12 text-sm text-muted-foreground">Loading...</div>
          ) : (
            <div className="bg-card border border-border rounded-xl overflow-hidden">
              <table className="w-full">
                <thead>
                  <tr className="bg-muted/50 border-b border-border">
                    <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase">PO #</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase">Supplier</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase">Date</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase">Due Date</th>
                    <th className="text-right px-4 py-3 text-xs font-semibold text-muted-foreground uppercase">Total</th>
                    <th className="text-center px-4 py-3 text-xs font-semibold text-muted-foreground uppercase">Status</th>
                    <th className="text-center px-4 py-3 text-xs font-semibold text-muted-foreground uppercase">Invoice</th>
                    <th className="text-center px-4 py-3 text-xs font-semibold text-muted-foreground uppercase">Source</th>
                    <th className="w-10"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {paginatedPOs.map(po => (
                    <tr key={po.id} className="hover:bg-muted/30 transition-colors cursor-pointer" onClick={() => navigate(`/purchasing/workspace/${po.id}`)}>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-2">
                          {posNeedingAttention.has(po.id) ? (
                            <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0" title="Needs qty adjustment" />
                          ) : (
                            <Receipt className="w-4 h-4 text-primary shrink-0" />
                          )}
                          <span className="text-sm font-mono font-medium">{po.po_number}</span>
                        </div>
                      </td>
                      <td className="px-4 py-2.5 text-sm">{po.supplier_name || '—'}</td>
                      <td className="px-4 py-2.5 text-sm text-muted-foreground">{po.order_date || '—'}</td>
                      <td className="px-4 py-2.5 text-sm">
                        {po.due_date_calculated ? (
                          <span className={dueDateClass(po.due_date_calculated)}>
                            {po.due_date_calculated}
                            {po.due_date_overridden && <span className="text-[10px] text-muted-foreground ml-1">(override)</span>}
                          </span>
                        ) : '—'}
                      </td>
                      <td className="px-4 py-2.5 text-sm text-right font-medium">R {(po.total || 0).toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                      <td className="px-4 py-2.5 text-center">
                        <Badge className={`text-[10px] ${STATUS_COLORS[po.status] || 'bg-gray-100 text-gray-600'}`}>
                          {STATUS_LABELS[po.status] || po.status}
                        </Badge>
                      </td>
                      <td className="px-4 py-2.5 text-center">
                        <Badge variant="outline" className={`text-[10px] ${po.payment_status === 'overdue' ? 'border-red-300 text-red-600' : po.payment_status === 'paid' ? 'border-green-300 text-green-700' : ''}`}>
                          {po.payment_status || 'unpaid'}
                        </Badge>
                      </td>
                      <td className="px-4 py-2.5 text-center">
                        {po.source === 'xero' ? (
                          <Badge variant="outline" className="text-[10px] border-blue-300 text-blue-600">Xero</Badge>
                        ) : (
                          <Badge variant="outline" className="text-[10px]">Manual</Badge>
                        )}
                      </td>
                      <td className="px-4 py-2.5">
                        <ChevronRight className="w-4 h-4 text-muted-foreground" />
                      </td>
                    </tr>
                  ))}
                  {filtered.length === 0 && (
                    <tr>
                      <td colSpan={9} className="px-4 py-12 text-center text-sm text-muted-foreground">
                        {activeFolder === 'credit_returns' ? (
                          <>No purchase orders with an open {creditReturnsFilter === 'returns' ? 'return' : creditReturnsFilter === 'credit_notes' ? 'credit note' : 'credit note or return'}.</>
                        ) : activeFolder === 'completed' ? (
                          'No completed purchase orders yet.'
                        ) : pos.length === 0 ? 'No purchase orders yet. Click "New PO" to create one.' : 'No orders match your filter.'}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
              {filtered.length > 0 && (
                <POPagination
                  page={safePage}
                  totalPages={totalPages}
                  totalItems={filtered.length}
                  pageSize={pageSize}
                  onPageChange={setPage}
                  onPageSizeChange={v => { setPageSize(v); setPage(1); }}
                />
              )}
            </div>
          )}
        </div>
      </div>

      {showCreate && (
        <CreatePOModal
          onCreated={(newPO) => {
            setShowCreate(false);
            queryClient.invalidateQueries({ queryKey: ['purchase-orders'] });
            if (newPO) setSelectedPO(newPO);
          }}
          onCancel={() => setShowCreate(false)}
        />
      )}

      {showBlind && (
        <CreateBlindReceiptModal
          onCreated={() => {
            setShowBlind(false);
            queryClient.invalidateQueries({ queryKey: ['purchase-orders'] });
          }}
          onCancel={() => setShowBlind(false)}
        />
      )}

      {selectedPO && (
        <PODetailDrawer
          po={selectedPO}
          onClose={() => setSelectedPO(null)}
          onUpdated={() => {
            queryClient.invalidateQueries({ queryKey: ['purchase-orders'] });
            base44.entities.PurchaseOrder.filter({ id: selectedPO.id }).then(res => {
              const refreshed = res[0];
              if (!refreshed) { toast.error('Could not refresh PO — it may have been deleted.'); return; }
              setSelectedPO(refreshed);
            });
          }}
        />
      )}
    </div>
  );
}