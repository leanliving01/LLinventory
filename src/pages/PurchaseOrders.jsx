import React, { useState, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Plus, Receipt, ChevronRight, RefreshCw, Loader2, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';
import CreatePOModal from '@/components/purchasing/CreatePOModal';
import PODetailDrawer from '@/components/purchasing/PODetailDrawer';
import POFilters from '@/components/purchasing/POFilters';
import POPagination from '@/components/purchasing/POPagination';

const STATUS_COLORS = {
  draft: 'bg-gray-100 text-gray-600',
  confirmed: 'bg-blue-100 text-blue-700',
  partially_received: 'bg-amber-100 text-amber-700',
  received: 'bg-green-100 text-green-700',
  invoiced: 'bg-purple-100 text-purple-700',
  paid: 'bg-green-100 text-green-700',
  cancelled: 'bg-red-100 text-red-600',
};

const STATUS_LABELS = {
  draft: 'Draft',
  confirmed: 'Confirmed',
  partially_received: 'Partial',
  received: 'Received',
  invoiced: 'Invoiced',
  paid: 'Paid',
  cancelled: 'Cancelled',
};

export default function PurchaseOrders() {
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState('open');
  const [showCreate, setShowCreate] = useState(false);
  const [selectedPO, setSelectedPO] = useState(null);
  const [syncing, setSyncing] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [filters, setFilters] = useState({
    search: '',
    supplierId: 'all',
    dateFrom: null,
    dateTo: null,
    sortBy: 'date_desc',
  });

  const handleXeroSync = async () => {
    setSyncing(true);
    const res = await base44.functions.invoke('syncXeroPurchaseOrders', {});
    setSyncing(false);
    const s = res.data?.summary;
    if (res.data?.error) {
      toast.error(res.data.error);
      return;
    }
    const poCount = (s.purchase_orders?.created || 0) + (s.bills?.created || 0);
    const updCount = (s.purchase_orders?.updated || 0) + (s.bills?.updated || 0);
    toast.success(`Xero sync done — ${poCount} new, ${updCount} updated, ${s.suppliers_matched} suppliers matched`);
    queryClient.invalidateQueries({ queryKey: ['purchase-orders'] });
  };

  const [needsAttentionOnly, setNeedsAttentionOnly] = useState(false);

  const { data: pos = [], isLoading } = useQuery({
    queryKey: ['purchase-orders'],
    queryFn: () => base44.entities.PurchaseOrder.list('-created_date', 2000),
  });

  // Load lines to identify POs needing manual qty adjustment (qty≤1, total>50)
  const { data: allLines = [] } = useQuery({
    queryKey: ['po-lines-all'],
    queryFn: () => base44.entities.PurchaseOrderLine.list('created_date', 5000),
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

  const filtered = useMemo(() => {
    let result = pos.filter(po => {
      // Status filter
      if (statusFilter === 'open' && ['received', 'paid', 'cancelled'].includes(po.status)) return false;
      if (statusFilter !== 'open' && statusFilter !== 'all' && po.status !== statusFilter) return false;

      // Text search
      if (filters.search) {
        const q = filters.search.toLowerCase();
        if (!(po.po_number || '').toLowerCase().includes(q) &&
            !(po.supplier_name || '').toLowerCase().includes(q) &&
            !(po.supplier_invoice_number || '').toLowerCase().includes(q)) return false;
      }

      // Needs attention filter
      if (needsAttentionOnly && !posNeedingAttention.has(po.id)) return false;

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
  }, [pos, filters, statusFilter, needsAttentionOnly, posNeedingAttention]);

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

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Purchase Orders</h1>
          <p className="text-sm text-muted-foreground mt-0.5">{filtered.length} of {pos.length} orders</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={handleXeroSync} disabled={syncing} className="gap-2">
            {syncing ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            {syncing ? 'Syncing Xero...' : 'Sync from Xero'}
          </Button>
          <Button onClick={() => setShowCreate(true)} className="gap-2">
            <Plus className="w-4 h-4" /> New PO
          </Button>
        </div>
      </div>

      {/* Needs Attention banner */}
      {posNeedingAttention.size > 0 && (
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

      {/* Status chips */}
      <div className="flex gap-2 flex-wrap">
        {[
          { key: 'open', label: `Open (${statusCounts.open || 0})` },
          { key: 'draft', label: `Draft (${statusCounts.draft || 0})` },
          { key: 'confirmed', label: `Confirmed (${statusCounts.confirmed || 0})` },
          { key: 'partially_received', label: `Partial (${statusCounts.partially_received || 0})` },
          { key: 'received', label: `Received (${statusCounts.received || 0})` },
          { key: 'invoiced', label: `Invoiced (${statusCounts.invoiced || 0})` },
          { key: 'paid', label: `Paid (${statusCounts.paid || 0})` },
          { key: 'cancelled', label: `Cancelled (${statusCounts.cancelled || 0})` },
          { key: 'all', label: 'All' },
        ].map(chip => (
          <button
            key={chip.key}
            onClick={() => { setStatusFilter(statusFilter === chip.key ? 'all' : chip.key); setPage(1); }}
            className={`text-xs px-3 py-1.5 rounded-full font-medium transition-all ${
              statusFilter === chip.key
                ? 'bg-primary/10 text-primary ring-2 ring-primary/30'
                : 'bg-muted text-muted-foreground hover:bg-muted/80'
            }`}
          >
            {chip.label}
          </button>
        ))}
      </div>

      {/* Filters */}
      <POFilters filters={filters} onChange={handleFiltersChange} suppliers={supplierOptions} />

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
                <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase">Expected</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-muted-foreground uppercase">Total</th>
                <th className="text-center px-4 py-3 text-xs font-semibold text-muted-foreground uppercase">Status</th>
                <th className="text-center px-4 py-3 text-xs font-semibold text-muted-foreground uppercase">Payment</th>
                <th className="text-center px-4 py-3 text-xs font-semibold text-muted-foreground uppercase">Source</th>
                <th className="w-10"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {paginatedPOs.map(po => (
                <tr key={po.id} className="hover:bg-muted/30 transition-colors cursor-pointer" onClick={() => setSelectedPO(po)}>
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
                  <td className="px-4 py-2.5 text-sm text-muted-foreground">{po.expected_date || '—'}</td>
                  <td className="px-4 py-2.5 text-sm text-right font-medium">R {(po.total || 0).toLocaleString('en-ZA', { minimumFractionDigits: 2 })}</td>
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
                    {pos.length === 0 ? 'No purchase orders yet. Click "New PO" to create one.' : 'No orders match your filter.'}
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

      {selectedPO && (
        <PODetailDrawer
          po={selectedPO}
          onClose={() => setSelectedPO(null)}
          onUpdated={() => {
            queryClient.invalidateQueries({ queryKey: ['purchase-orders'] });
            // Re-fetch selected PO
            base44.entities.PurchaseOrder.filter({ id: selectedPO.id }).then(res => {
              if (res[0]) setSelectedPO(res[0]);
            });
          }}
        />
      )}
    </div>
  );
}