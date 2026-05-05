import React, { useState, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Search, Package, X, Merge, Check, ScanSearch } from 'lucide-react';
import { Button } from '@/components/ui/button';
import SyncStatusBanner from '@/components/shopify/SyncStatusBanner';
import TablePagination from '@/components/shared/TablePagination';
import MergeProductsModal from '@/components/catalog/MergeProductsModal';
import DuplicateAuditModal from '@/components/catalog/DuplicateAuditModal';
import RawMaterialGroupedTable from '@/components/catalog/RawMaterialGroupedTable';
import { useAuth } from '@/lib/AuthContext';
import { getUserPermissions } from '@/lib/permissions';
import { useCustomRoles } from '@/components/settings/CustomRolesManager';

const TYPE_LABELS = {
  raw: 'Raw Material',
  packaging: 'Packaging',
  wip_bulk: 'Bulk Cooked',
  finished_meal: 'Finished Meal',
  supplement: 'Supplement',
  package: 'Package',
  sauce: 'Sauce',
  solo_serve: 'Solo Serve',
  bundle: 'Bundle',
  service: 'Service',
};

const TYPE_COLORS = {
  raw: 'bg-amber-100 text-amber-700',
  packaging: 'bg-gray-100 text-gray-700',
  wip_bulk: 'bg-orange-100 text-orange-700',
  finished_meal: 'bg-green-100 text-green-700',
  supplement: 'bg-purple-100 text-purple-700',
  package: 'bg-blue-100 text-blue-700',
  sauce: 'bg-red-100 text-red-700',
  solo_serve: 'bg-pink-100 text-pink-700',
  bundle: 'bg-indigo-100 text-indigo-700',
  service: 'bg-slate-100 text-slate-700',
};

export default function Catalog() {
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('active');
  const [sellableFilter, setSellableFilter] = useState('all');
  const [purchasableFilter, setPurchasableFilter] = useState('all');
  const [inventoryFilter, setInventoryFilter] = useState('all');
  const navigate = useNavigate();
  const { user } = useAuth();
  const customRoles = useCustomRoles();
  const perms = getUserPermissions(user || {}, customRoles);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(15);
  const [mergeSelection, setMergeSelection] = useState([]);
  const [showMergeModal, setShowMergeModal] = useState(false);
  const [showDuplicateAudit, setShowDuplicateAudit] = useState(false);
  const queryClient = useQueryClient();

  const { data: products = [], isLoading } = useQuery({
    queryKey: ['catalog-products'],
    queryFn: () => base44.entities.Product.list('-created_date', 500),
  });

  const filtered = useMemo(() => {
    return products.filter(p => {
      if (statusFilter !== 'all' && p.status !== statusFilter) return false;
      if (typeFilter !== 'all' && p.type !== typeFilter) return false;
      if (sellableFilter !== 'all') {
        const isSellable = p.sellable === true;
        if (sellableFilter === 'yes' && !isSellable) return false;
        if (sellableFilter === 'no' && isSellable) return false;
      }
      if (purchasableFilter !== 'all') {
        const isPurchasable = p.purchasable !== false;
        if (purchasableFilter === 'yes' && !isPurchasable) return false;
        if (purchasableFilter === 'no' && isPurchasable) return false;
      }
      if (inventoryFilter !== 'all') {
        const isTracked = p.inventory_tracked !== false;
        if (inventoryFilter === 'yes' && !isTracked) return false;
        if (inventoryFilter === 'no' && isTracked) return false;
      }
      if (search) {
        const s = search.toLowerCase();
        return (p.sku || '').toLowerCase().includes(s) ||
               (p.name || '').toLowerCase().includes(s) ||
               (p.barcode || '').toLowerCase().includes(s);
      }
      return true;
    });
  }, [products, search, typeFilter, statusFilter, sellableFilter, purchasableFilter, inventoryFilter]);

  const pageProducts = filtered.slice(page * pageSize, (page + 1) * pageSize);

  // Count by type
  const typeCounts = useMemo(() => {
    const counts = {};
    products.filter(p => statusFilter === 'all' || p.status === statusFilter).forEach(p => {
      counts[p.type] = (counts[p.type] || 0) + 1;
    });
    return counts;
  }, [products, statusFilter]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Products</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {filtered.length} of {products.length} products
          </p>
        </div>
        <div className="flex items-center gap-2">
          {perms.catalog_edit && (
            <Button variant="outline" onClick={() => setShowDuplicateAudit(true)} className="gap-2">
              <ScanSearch className="w-4 h-4" />
              Scan Duplicates
            </Button>
          )}
          {perms.catalog_edit && mergeSelection.length >= 2 && (
            <Button onClick={() => setShowMergeModal(true)} className="gap-2">
              <Merge className="w-4 h-4" />
              Merge {mergeSelection.length} Products
            </Button>
          )}
        </div>
      </div>

      <SyncStatusBanner syncKeys={['shopify_products']} />

      {/* Type summary chips */}
      <div className="flex flex-wrap gap-2">
        {Object.entries(typeCounts).sort((a, b) => b[1] - a[1]).map(([type, count]) => (
          <button
            key={type}
            onClick={() => setTypeFilter(typeFilter === type ? 'all' : type)}
            className={`text-xs px-2.5 py-1 rounded-full font-medium transition-all ${
              typeFilter === type ? TYPE_COLORS[type] + ' ring-2 ring-primary/30' : TYPE_COLORS[type] + ' opacity-70 hover:opacity-100'
            }`}
          >
            {TYPE_LABELS[type] || type} ({count})
          </button>
        ))}
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search by SKU, name, or barcode..."
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(0); }}
            className="pl-9"
          />
        </div>
        <Select value={statusFilter} onValueChange={v => { setStatusFilter(v); setPage(0); }}>
          <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="archived">Inactive</SelectItem>
          </SelectContent>
        </Select>
        <Select value={sellableFilter} onValueChange={v => { setSellableFilter(v); setPage(0); }}>
          <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Sellable</SelectItem>
            <SelectItem value="yes">Sellable</SelectItem>
            <SelectItem value="no">Not Sellable</SelectItem>
          </SelectContent>
        </Select>
        <Select value={purchasableFilter} onValueChange={v => { setPurchasableFilter(v); setPage(0); }}>
          <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Purchasable</SelectItem>
            <SelectItem value="yes">Purchasable</SelectItem>
            <SelectItem value="no">Not Purchasable</SelectItem>
          </SelectContent>
        </Select>
        <Select value={inventoryFilter} onValueChange={v => { setInventoryFilter(v); setPage(0); }}>
          <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Inventory</SelectItem>
            <SelectItem value="yes">Tracked</SelectItem>
            <SelectItem value="no">Not Tracked</SelectItem>
          </SelectContent>
        </Select>
        {(search || typeFilter !== 'all' || statusFilter !== 'active' || sellableFilter !== 'all' || purchasableFilter !== 'all' || inventoryFilter !== 'all') && (
          <Button variant="ghost" size="sm" onClick={() => { setSearch(''); setTypeFilter('all'); setStatusFilter('active'); setSellableFilter('all'); setPurchasableFilter('all'); setInventoryFilter('all'); setPage(0); }} className="gap-1">
            <X className="w-3.5 h-3.5" /> Clear
          </Button>
        )}
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="text-center py-12 text-sm text-muted-foreground">Loading catalog...</div>
      ) : typeFilter === 'raw' ? (
        <RawMaterialGroupedTable
          products={filtered}
          showCheckbox={perms.catalog_edit}
          mergeSelection={mergeSelection}
          setMergeSelection={setMergeSelection}
        />
      ) : (
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="bg-muted/50 border-b border-border">
                {perms.catalog_edit && (
                  <th className="w-10 px-3 py-3"></th>
                )}
                <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase">SKU</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase">Name</th>
                <th className="text-center px-4 py-3 text-xs font-semibold text-muted-foreground uppercase">Type</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase">Category</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-muted-foreground uppercase">Cost (ZAR)</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-muted-foreground uppercase">Price (ZAR)</th>
                <th className="text-center px-4 py-3 text-xs font-semibold text-muted-foreground uppercase">UoM</th>
                <th className="text-center px-4 py-3 text-xs font-semibold text-muted-foreground uppercase">Inventory</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {pageProducts.map(p => {
                const isSelected = mergeSelection.includes(p.id);
                return (
                <tr
                  key={p.id}
                  className={`hover:bg-muted/30 transition-colors cursor-pointer ${isSelected ? 'bg-primary/5' : ''}`}
                  onClick={() => navigate(`/catalog/${p.id}`)}
                >
                  {perms.catalog_edit && (
                    <td className="px-3 py-2.5" onClick={e => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => setMergeSelection(prev =>
                          prev.includes(p.id) ? prev.filter(id => id !== p.id) : [...prev, p.id]
                        )}
                        className="rounded w-4 h-4"
                      />
                    </td>
                  )}
                  <td className="px-4 py-2.5 text-sm font-mono font-medium">{p.sku}</td>
                  <td className="px-4 py-2.5 text-sm">{p.name}</td>
                  <td className="px-4 py-2.5 text-center">
                    <Badge className={`text-[10px] ${TYPE_COLORS[p.type] || 'bg-gray-100 text-gray-700'}`}>
                      {TYPE_LABELS[p.type] || p.type}
                    </Badge>
                  </td>
                  <td className="px-4 py-2.5 text-sm text-muted-foreground">{p.category || '—'}</td>
                  <td className="px-4 py-2.5 text-sm text-right tabular-nums">
                    {p.cost_avg ? `R ${p.cost_avg.toFixed(2)}` : '—'}
                  </td>
                  <td className="px-4 py-2.5 text-sm text-right tabular-nums">
                    {p.price ? `R ${p.price.toFixed(2)}` : '—'}
                  </td>
                  <td className="px-4 py-2.5 text-sm text-center">{p.stock_uom}</td>
                  <td className="px-4 py-2.5 text-center">
                    <Badge className={p.inventory_tracked === false ? 'bg-gray-100 text-gray-500 text-[10px]' : 'bg-emerald-100 text-emerald-700 text-[10px]'}>
                      {p.inventory_tracked === false ? 'No' : 'Yes'}
                    </Badge>
                  </td>
                </tr>
                );
              })}
              {pageProducts.length === 0 && (
                <tr>
                  <td colSpan={perms.catalog_edit ? 9 : 8} className="px-4 py-8 text-center text-sm text-muted-foreground">
                    {products.length === 0 ? 'No products imported yet. Go to Settings → Cin7 Import to get started.' : 'No products match your filters.'}
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


      {showMergeModal && (
        <MergeProductsModal
          products={products.filter(p => mergeSelection.includes(p.id))}
          onClose={() => setShowMergeModal(false)}
          onMerged={() => {
            setShowMergeModal(false);
            setMergeSelection([]);
            queryClient.invalidateQueries({ queryKey: ['catalog-products'] });
          }}
        />
      )}

      {showDuplicateAudit && (
        <DuplicateAuditModal
          onClose={() => setShowDuplicateAudit(false)}
          onMergesComplete={() => {
            queryClient.invalidateQueries({ queryKey: ['catalog-products'] });
          }}
        />
      )}
    </div>
  );
}