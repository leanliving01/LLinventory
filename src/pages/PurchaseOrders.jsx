import React, { useState, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Plus, Search, X, Receipt, ChevronRight } from 'lucide-react';
import CreatePOModal from '@/components/purchasing/CreatePOModal';
import PODetailDrawer from '@/components/purchasing/PODetailDrawer';

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
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('open');
  const [showCreate, setShowCreate] = useState(false);
  const [selectedPO, setSelectedPO] = useState(null);

  const { data: pos = [], isLoading } = useQuery({
    queryKey: ['purchase-orders'],
    queryFn: () => base44.entities.PurchaseOrder.list('-created_date', 200),
  });

  const filtered = useMemo(() => {
    return pos.filter(po => {
      // Status filter
      if (statusFilter === 'open' && ['received', 'paid', 'cancelled'].includes(po.status)) return false;
      if (statusFilter !== 'open' && statusFilter !== 'all' && po.status !== statusFilter) return false;

      // Search
      if (search) {
        const q = search.toLowerCase();
        return (po.po_number || '').toLowerCase().includes(q) ||
               (po.supplier_name || '').toLowerCase().includes(q);
      }
      return true;
    });
  }, [pos, search, statusFilter]);

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
          <p className="text-sm text-muted-foreground mt-0.5">{filtered.length} orders</p>
        </div>
        <Button onClick={() => setShowCreate(true)} className="gap-2">
          <Plus className="w-4 h-4" /> New PO
        </Button>
      </div>

      {/* Status chips */}
      <div className="flex gap-2 flex-wrap">
        {[
          { key: 'open', label: `Open (${statusCounts.open || 0})` },
          { key: 'draft', label: `Draft (${statusCounts.draft || 0})` },
          { key: 'confirmed', label: `Confirmed (${statusCounts.confirmed || 0})` },
          { key: 'partially_received', label: `Partial (${statusCounts.partially_received || 0})` },
          { key: 'received', label: `Received (${statusCounts.received || 0})` },
          { key: 'invoiced', label: `Invoiced (${statusCounts.invoiced || 0})` },
          { key: 'all', label: 'All' },
        ].map(chip => (
          <button
            key={chip.key}
            onClick={() => setStatusFilter(statusFilter === chip.key ? 'all' : chip.key)}
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

      {/* Search */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input placeholder="Search by PO number or supplier..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
        </div>
        {search && (
          <Button variant="ghost" size="sm" onClick={() => setSearch('')} className="gap-1">
            <X className="w-3.5 h-3.5" /> Clear
          </Button>
        )}
      </div>

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
                <th className="w-10"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filtered.map(po => (
                <tr key={po.id} className="hover:bg-muted/30 transition-colors cursor-pointer" onClick={() => setSelectedPO(po)}>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-2">
                      <Receipt className="w-4 h-4 text-primary shrink-0" />
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
                  <td className="px-4 py-2.5">
                    <ChevronRight className="w-4 h-4 text-muted-foreground" />
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-12 text-center text-sm text-muted-foreground">
                    {pos.length === 0 ? 'No purchase orders yet. Click "New PO" to create one.' : 'No orders match your filter.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
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