import React, { useState, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Search, X, ChevronRight, Truck, Plus } from 'lucide-react';
import SupplierDetailDrawer from '@/components/suppliers/SupplierDetailDrawer';
import CreateSupplierModal from '@/components/suppliers/CreateSupplierModal';

export default function Suppliers() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('active');
  const [selectedSupplier, setSelectedSupplier] = useState(null);
  const [showCreate, setShowCreate] = useState(false);

  const { data: suppliers = [], isLoading } = useQuery({
    queryKey: ['suppliers-list'],
    queryFn: () => base44.entities.Supplier.list('name', 200),
  });

  // Fetch open POs (not received/cancelled/paid) for all suppliers
  const { data: openPOs = [] } = useQuery({
    queryKey: ['open-pos'],
    queryFn: async () => {
      const all = await base44.entities.PurchaseOrder.list('-created_date', 500);
      return all.filter(po => !['received', 'cancelled', 'paid'].includes(po.status));
    },
  });

  // Aggregate open PO count and outstanding balance per supplier
  const supplierPOStats = useMemo(() => {
    const stats = {};
    openPOs.forEach(po => {
      if (!stats[po.supplier_id]) stats[po.supplier_id] = { count: 0, outstanding: 0 };
      stats[po.supplier_id].count += 1;
      stats[po.supplier_id].outstanding += (po.total || 0);
    });
    return stats;
  }, [openPOs]);

  const filtered = useMemo(() => {
    return suppliers.filter(s => {
      if (statusFilter !== 'all' && s.status !== statusFilter) return false;
      if (search) {
        const q = search.toLowerCase();
        return (s.name || '').toLowerCase().includes(q) ||
               (s.contact_name || '').toLowerCase().includes(q) ||
               (s.email || '').toLowerCase().includes(q);
      }
      return true;
    });
  }, [suppliers, search, statusFilter]);

  const activeCount = suppliers.filter(s => s.status === 'active').length;
  const inactiveCount = suppliers.filter(s => s.status !== 'active').length;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Suppliers</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {filtered.length} of {suppliers.length} suppliers
          </p>
        </div>
        <Button onClick={() => setShowCreate(true)} className="gap-2">
          <Plus className="w-4 h-4" /> Add Supplier
        </Button>
      </div>

      {/* Status chips */}
      <div className="flex gap-2">
        <button
          onClick={() => setStatusFilter(statusFilter === 'active' ? 'all' : 'active')}
          className={`text-xs px-3 py-1.5 rounded-full font-medium transition-all ${
            statusFilter === 'active'
              ? 'bg-green-100 text-green-700 ring-2 ring-primary/30'
              : 'bg-green-100 text-green-700 opacity-70 hover:opacity-100'
          }`}
        >
          Active ({activeCount})
        </button>
        {inactiveCount > 0 && (
          <button
            onClick={() => setStatusFilter(statusFilter === 'inactive' ? 'all' : 'inactive')}
            className={`text-xs px-3 py-1.5 rounded-full font-medium transition-all ${
              statusFilter === 'inactive'
                ? 'bg-gray-100 text-gray-700 ring-2 ring-primary/30'
                : 'bg-gray-100 text-gray-700 opacity-70 hover:opacity-100'
            }`}
          >
            Inactive ({inactiveCount})
          </button>
        )}
      </div>

      {/* Search */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search by name, contact, or email..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        {(search || statusFilter !== 'active') && (
          <Button variant="ghost" size="sm" onClick={() => { setSearch(''); setStatusFilter('active'); }} className="gap-1">
            <X className="w-3.5 h-3.5" /> Clear
          </Button>
        )}
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="text-center py-12 text-sm text-muted-foreground">Loading suppliers...</div>
      ) : (
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="bg-muted/50 border-b border-border">
                <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase">Supplier</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase">Contact</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase">Phone</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase">Email</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase">Payment Terms</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-muted-foreground uppercase">Open POs</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-muted-foreground uppercase">Outstanding</th>
                <th className="text-center px-4 py-3 text-xs font-semibold text-muted-foreground uppercase">Status</th>
                <th className="w-10"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filtered.map(s => (
                <tr
                  key={s.id}
                  className="hover:bg-muted/30 transition-colors cursor-pointer"
                  onClick={() => setSelectedSupplier(s)}
                >
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-2.5">
                      <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                        <Truck className="w-4 h-4 text-primary" />
                      </div>
                      <span className="text-sm font-medium">{s.name}</span>
                    </div>
                  </td>
                  <td className="px-4 py-2.5 text-sm text-muted-foreground">{s.contact_name || '—'}</td>
                  <td className="px-4 py-2.5 text-sm text-muted-foreground">{s.phone || '—'}</td>
                  <td className="px-4 py-2.5 text-sm text-muted-foreground">{s.email || '—'}</td>
                  <td className="px-4 py-2.5 text-sm text-muted-foreground">{s.payment_terms || '—'}</td>
                  <td className="px-4 py-2.5 text-right">
                    {supplierPOStats[s.id]?.count ? (
                      <Badge variant="outline" className="text-[10px]">{supplierPOStats[s.id].count}</Badge>
                    ) : (
                      <span className="text-sm text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-right text-sm font-medium">
                    {supplierPOStats[s.id]?.outstanding ? (
                      <span className="text-amber-600">R {supplierPOStats[s.id].outstanding.toLocaleString('en-ZA', { minimumFractionDigits: 2 })}</span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-center">
                    <Badge className={`text-[10px] ${s.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                      {s.status || 'active'}
                    </Badge>
                  </td>
                  <td className="px-4 py-2.5">
                    <ChevronRight className="w-4 h-4 text-muted-foreground" />
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-4 py-8 text-center text-sm text-muted-foreground">
                    {suppliers.length === 0 ? 'No suppliers imported yet.' : 'No suppliers match your search.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {selectedSupplier && (
        <SupplierDetailDrawer
          supplier={selectedSupplier}
          onClose={() => setSelectedSupplier(null)}
          onUpdated={() => queryClient.invalidateQueries({ queryKey: ['suppliers-list'] })}
        />
      )}

      {showCreate && (
        <CreateSupplierModal
          onCreated={() => {
            setShowCreate(false);
            queryClient.invalidateQueries({ queryKey: ['suppliers-list'] });
          }}
          onCancel={() => setShowCreate(false)}
        />
      )}
    </div>
  );
}