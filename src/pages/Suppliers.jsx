import React, { useState, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Search, X, ChevronRight, Truck, Plus, Utensils, Package, MoreHorizontal, ShoppingBag, Pencil } from 'lucide-react';
import { formatPaymentTerms, computePaymentTermsLabel } from '@/lib/utils';
import { toast } from 'sonner';

// Unified payment-terms display — prefers the structured (v2) fields, then the
// computed label, then legacy fields, then the raw free-text. Keeps the table
// in sync with what's edited in the supplier drawer.
function supplierTermsDisplay(s) {
  if (s.payment_term_type) return formatPaymentTerms(s.payment_term_type, s.payment_term_value);
  return s.payment_terms_label
    || computePaymentTermsLabel(s.payment_terms_basis, s.payment_terms_days, s.payment_terms_cutoff_day)
    || s.payment_terms
    || '—';
}

const CATEGORY_META = {
  food:      { label: 'Food', color: 'bg-green-100 text-green-700', icon: Utensils },
  packaging: { label: 'Packaging', color: 'bg-blue-100 text-blue-700', icon: Package },
  resale:    { label: 'Resale', color: 'bg-purple-100 text-purple-700', icon: ShoppingBag },
  other:     { label: 'Other', color: 'bg-gray-100 text-gray-500', icon: MoreHorizontal },
};
import SupplierDetailDrawer from '@/components/suppliers/SupplierDetailDrawer';
import SupplierBulkEditModal from '@/components/suppliers/SupplierBulkEditModal';
import TablePagination from '@/components/shared/TablePagination';
import CreateSupplierModal from '@/components/suppliers/CreateSupplierModal';
import SyncStatusBanner from '@/components/shopify/SyncStatusBanner';

export default function Suppliers() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('active');
  const [categoryFilter, setCategoryFilter] = useState('all'); // 'production' = food+packaging, 'all', or specific category
  const [selectedSupplier, setSelectedSupplier] = useState(null);
  const [showCreate, setShowCreate] = useState(false);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(15);
  const [selected, setSelected] = useState([]);
  const [showBulkEdit, setShowBulkEdit] = useState(false);

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
      if (categoryFilter === 'production') {
        const cat = s.category || 'other';
        if (cat !== 'food' && cat !== 'packaging') return false;
      } else if (categoryFilter !== 'all') {
        if ((s.category || 'other') !== categoryFilter) return false;
      }
      if (search) {
        const q = search.toLowerCase();
        return (s.name || '').toLowerCase().includes(q) ||
               (s.contact_name || '').toLowerCase().includes(q) ||
               (s.email || '').toLowerCase().includes(q);
      }
      return true;
    });
  }, [suppliers, search, statusFilter, categoryFilter]);

  const activeCount = suppliers.filter(s => s.status === 'active').length;
  const inactiveCount = suppliers.filter(s => s.status !== 'active').length;

  const categoryCounts = useMemo(() => {
    const c = { food: 0, packaging: 0, resale: 0, other: 0 };
    suppliers.forEach(s => {
      const cat = s.category || 'other';
      if (c[cat] !== undefined) c[cat]++; else c.other++;
    });
    return { ...c, production: c.food + c.packaging };
  }, [suppliers]);

  const pageSuppliers = filtered.slice(page * pageSize, (page + 1) * pageSize);
  const pageIds = pageSuppliers.map(s => s.id);
  const allPageSelected = pageIds.length > 0 && pageIds.every(id => selected.includes(id));
  const toggleRow = (id) => setSelected(p => p.includes(id) ? p.filter(x => x !== id) : [...p, id]);
  const togglePage = () => setSelected(p => allPageSelected ? p.filter(id => !pageIds.includes(id)) : [...new Set([...p, ...pageIds])]);

  // Inline toggle for "Production Supplier" (these pull in from Xero).
  const [togglingProd, setTogglingProd] = useState(null);
  const toggleProduction = async (s) => {
    const next = !s.is_production_supplier;
    setTogglingProd(s.id);
    try {
      // Production status is coupled to active/archived: production suppliers are
      // active; non-production suppliers are archived (inactive).
      await base44.entities.Supplier.update(s.id, {
        is_production_supplier: next,
        status: next ? 'active' : 'inactive',
      });
      queryClient.invalidateQueries({ queryKey: ['suppliers-list'] });
      toast.success(next ? `${s.name} marked as production supplier (active)` : `${s.name} archived (non-production)`);
    } catch (err) {
      console.error('[Suppliers] toggle production supplier failed:', err);
      toast.error(`Update failed: ${err.message || 'Unknown error'}`);
    } finally {
      setTogglingProd(null);
    }
  };

  return (
    <div className="space-y-4">
      {showCreate ? (
        <CreateSupplierModal
          onCreated={() => {
            setShowCreate(false);
            queryClient.invalidateQueries({ queryKey: ['suppliers-list'] });
          }}
          onCancel={() => setShowCreate(false)}
        />
      ) : selectedSupplier ? (
        <SupplierDetailDrawer
          supplier={selectedSupplier}
          onClose={() => setSelectedSupplier(null)}
          onUpdated={(updated) => {
            if (updated) setSelectedSupplier(updated);
            queryClient.invalidateQueries({ queryKey: ['suppliers-list'] });
          }}
        />
      ) : (
      <>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Suppliers</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {filtered.length} of {suppliers.length} suppliers
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button onClick={() => setShowCreate(true)} className="gap-2">
            <Plus className="w-4 h-4" /> Add Supplier
          </Button>
        </div>
      </div>

      <SyncStatusBanner syncKeys={['xero_purchase_orders']} title="Xero PO Sync" />

      {/* Status chips */}
      <div className="flex gap-2">
        <button
          onClick={() => { setStatusFilter(statusFilter === 'active' ? 'all' : 'active'); setPage(0); }}
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
            onClick={() => { setStatusFilter(statusFilter === 'inactive' ? 'all' : 'inactive'); setPage(0); }}
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

      {/* Category filter chips */}
      <div className="flex gap-2 flex-wrap">
        {[
          { key: 'production', label: `Production (${categoryCounts.production})`, color: 'bg-primary/10 text-primary' },
          { key: 'food', label: `Food (${categoryCounts.food})`, color: 'bg-green-100 text-green-700' },
          { key: 'packaging', label: `Packaging (${categoryCounts.packaging})`, color: 'bg-blue-100 text-blue-700' },
          { key: 'resale', label: `Resale (${categoryCounts.resale})`, color: 'bg-purple-100 text-purple-700' },
          { key: 'other', label: `Other (${categoryCounts.other})`, color: 'bg-gray-100 text-gray-500' },
          { key: 'all', label: `All (${suppliers.length})`, color: 'bg-muted text-muted-foreground' },
        ].map(chip => (
          <button
            key={chip.key}
            onClick={() => { setCategoryFilter(chip.key); setPage(0); }}
            className={`text-xs px-3 py-1.5 rounded-full font-medium transition-all ${
              categoryFilter === chip.key
                ? `${chip.color} ring-2 ring-primary/30`
                : `${chip.color} opacity-60 hover:opacity-100`
            }`}
          >
            {chip.label}
          </button>
        ))}
      </div>

      {/* Search */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search by name, contact, or email..."
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(0); }}
            className="pl-9"
          />
        </div>
        {(search || statusFilter !== 'active' || categoryFilter !== 'production') && (
          <Button variant="ghost" size="sm" onClick={() => { setSearch(''); setStatusFilter('active'); setCategoryFilter('production'); }} className="gap-1">
            <X className="w-3.5 h-3.5" /> Clear
          </Button>
        )}
      </div>

      {/* Bulk action bar */}
      {selected.length > 0 && (
        <div className="flex items-center justify-between bg-primary/5 border border-primary/20 rounded-lg px-4 py-2">
          <span className="text-sm font-medium">{selected.length} selected</span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setSelected([])}>Clear selection</Button>
            <Button size="sm" className="gap-1.5" onClick={() => setShowBulkEdit(true)}>
              <Pencil className="w-3.5 h-3.5" /> Bulk edit
            </Button>
          </div>
        </div>
      )}

      {/* Table */}
      {isLoading ? (
        <div className="text-center py-12 text-sm text-muted-foreground">Loading suppliers...</div>
      ) : (
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="bg-muted/50 border-b border-border">
                <th className="px-3 py-3 w-10">
                  <input type="checkbox" className="rounded w-4 h-4" checked={allPageSelected} onChange={togglePage} />
                </th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase">Supplier</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase">Category</th>
                <th className="text-center px-4 py-3 text-xs font-semibold text-muted-foreground uppercase whitespace-nowrap">Production Supplier</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase">Contact</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase">Phone</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase">Email</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase">Payment Terms</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-muted-foreground uppercase">Open POs</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-muted-foreground uppercase">Outstanding (Xero)</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-muted-foreground uppercase">Overdue</th>
                <th className="text-center px-4 py-3 text-xs font-semibold text-muted-foreground uppercase">Status</th>
                <th className="w-10"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {pageSuppliers.map(s => (
                <tr
                  key={s.id}
                  className={`hover:bg-muted/30 transition-colors cursor-pointer ${selected.includes(s.id) ? 'bg-primary/5' : ''}`}
                  onClick={() => setSelectedSupplier(s)}
                >
                  <td className="px-3 py-2.5" onClick={e => e.stopPropagation()}>
                    <input type="checkbox" className="rounded w-4 h-4" checked={selected.includes(s.id)} onChange={() => toggleRow(s.id)} />
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-2.5">
                      <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                        <Truck className="w-4 h-4 text-primary" />
                      </div>
                      <span className="text-sm font-medium">{s.name}</span>
                    </div>
                  </td>
                  <td className="px-4 py-2.5">
                    {(() => {
                      const cat = s.category || 'other';
                      const meta = CATEGORY_META[cat] || CATEGORY_META.other;
                      return <Badge className={`text-[10px] ${meta.color}`}>{meta.label}</Badge>;
                    })()}
                  </td>
                  <td className="px-4 py-2.5 text-center" onClick={e => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      className="rounded w-4 h-4 cursor-pointer disabled:opacity-50"
                      checked={!!s.is_production_supplier}
                      disabled={togglingProd === s.id}
                      onChange={() => toggleProduction(s)}
                      title="Production suppliers pull in from Xero"
                    />
                  </td>
                  <td className="px-4 py-2.5 text-sm text-muted-foreground">{s.contact_name || '—'}</td>
                  <td className="px-4 py-2.5 text-sm text-muted-foreground">{s.phone || '—'}</td>
                  <td className="px-4 py-2.5 text-sm text-muted-foreground">{s.email || '—'}</td>
                  <td className="px-4 py-2.5 text-sm text-muted-foreground">{supplierTermsDisplay(s)}</td>
                  <td className="px-4 py-2.5 text-right">
                    {supplierPOStats[s.id]?.count ? (
                      <Badge variant="outline" className="text-[10px]">{supplierPOStats[s.id].count}</Badge>
                    ) : (
                      <span className="text-sm text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-right text-sm font-medium">
                    {s.outstanding_balance ? (
                      <span className="text-amber-600">R {s.outstanding_balance.toLocaleString('en-ZA', { minimumFractionDigits: 2 })}</span>
                    ) : supplierPOStats[s.id]?.outstanding ? (
                      <span className="text-muted-foreground">R {supplierPOStats[s.id].outstanding.toLocaleString('en-ZA', { minimumFractionDigits: 2 })}</span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-right text-sm font-medium">
                    {s.overdue_balance ? (
                      <span className="text-red-600">R {s.overdue_balance.toLocaleString('en-ZA', { minimumFractionDigits: 2 })}</span>
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
                  <td colSpan={13} className="px-4 py-8 text-center text-sm text-muted-foreground">
                    {suppliers.length === 0 ? 'No suppliers imported yet.' : 'No suppliers match your search.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          <TablePagination
            page={page}
            pageSize={pageSize}
            totalItems={filtered.length}
            onPageChange={setPage}
            onPageSizeChange={v => { setPageSize(v); setPage(0); }}
          />
        </div>
      )}
      </>
      )}

      {showBulkEdit && (
        <SupplierBulkEditModal
          supplierIds={selected}
          onCancel={() => setShowBulkEdit(false)}
          onDone={() => {
            setShowBulkEdit(false);
            setSelected([]);
            queryClient.invalidateQueries({ queryKey: ['suppliers-list'] });
          }}
        />
      )}
    </div>
  );
}