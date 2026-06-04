import React, { useState, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Search, X, Gauge, MapPin, CheckSquare } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import ProductionFloorBanner from '@/components/inventory/ProductionFloorBanner';
import InventoryCSVExport from '@/components/inventory/InventoryCSVExport';
import TablePagination from '@/components/shared/TablePagination';
import InventoryCSVImport from '@/components/inventory/InventoryCSVImport';
import RecalcCommittedStock from '@/components/inventory/RecalcCommittedStock';
import InventoryBulkEditModal from '@/components/inventory/InventoryBulkEditModal';
import { useAuth } from '@/lib/AuthContext';
import { getUserPermissions } from '@/lib/permissions';
import {
  CATEGORY_LABELS,
  CATEGORY_COLORS,
  getCategoryLabel,
  getCategoryColor,
  resolveSubcategory,
} from '@/lib/productClassification';

export default function InventoryOverview() {
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [stockFilter, setStockFilter] = useState('all'); // all, in_stock, low, out
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(15);
  const [selection, setSelection] = useState([]); // product ids
  const [bulkMode, setBulkMode] = useState(null); // 'reorder' | 'location' | null
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const perms = user ? getUserPermissions(user) : {};

  const { data: products = [], isLoading: loadingProducts } = useQuery({
    queryKey: ['inv-overview-products'],
    queryFn: () => base44.entities.Product.filter({ status: 'active', inventory_tracked: true }, 'name', 2000),
  });

  const { data: stockRecords = [], isLoading: loadingStock } = useQuery({
    queryKey: ['inv-overview-soh'],
    queryFn: () => base44.entities.StockOnHand.list('product_sku', 5000),
  });

  const { data: locations = [] } = useQuery({
    queryKey: ['inv-overview-locations'],
    queryFn: () => base44.entities.Location.list('name', 500),
    staleTime: 300_000,
  });

  const locationMap = useMemo(() => {
    const m = {};
    locations.forEach(l => { m[l.id] = l.name; });
    return m;
  }, [locations]);

  // Aggregate SOH per product (sum across locations)
  const stockByProduct = useMemo(() => {
    const map = {};
    stockRecords.forEach(s => {
      if (!s.product_id) return;
      if (!map[s.product_id]) {
        map[s.product_id] = { on_hand: 0, committed: 0, available: 0 };
      }
      map[s.product_id].on_hand += s.qty_on_hand || 0;
      map[s.product_id].committed += s.qty_committed || 0;
      map[s.product_id].available += s.qty_available || 0;
    });
    return map;
  }, [stockRecords]);

  const filtered = useMemo(() => {
    return products.filter(p => {
      if (typeFilter !== 'all' && p.type !== typeFilter) return false;
      const stock = stockByProduct[p.id];
      const onHand = stock?.on_hand || 0;
      const reorder = p.min_before_reorder || 0;
      if (stockFilter === 'in_stock' && onHand <= 0) return false;
      if (stockFilter === 'low' && (onHand <= 0 || onHand > reorder)) return false;
      if (stockFilter === 'out' && onHand > 0) return false;
      if (search) {
        const s = search.toLowerCase();
        return (p.sku || '').toLowerCase().includes(s) ||
               (p.name || '').toLowerCase().includes(s);
      }
      return true;
    });
  }, [products, search, typeFilter, stockFilter, stockByProduct]);

  const pageProducts = filtered.slice(page * pageSize, (page + 1) * pageSize);

  const typeCounts = useMemo(() => {
    const counts = {};
    products.forEach(p => { counts[p.type] = (counts[p.type] || 0) + 1; });
    return counts;
  }, [products]);

  // ── Selection helpers (id-keyed, persist across pages/filters) ──
  const toggleRow = (id) => setSelection(prev =>
    prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
  );
  const pageAllSelected = pageProducts.length > 0 && pageProducts.every(p => selection.includes(p.id));
  const togglePage = () => {
    const ids = pageProducts.map(p => p.id);
    if (pageAllSelected) {
      const set = new Set(ids);
      setSelection(prev => prev.filter(x => !set.has(x)));
    } else {
      setSelection(prev => [...new Set([...prev, ...ids])]);
    }
  };
  const allFilteredSelected = filtered.length > 0 && filtered.every(p => selection.includes(p.id));
  const toggleSelectAllFiltered = () => {
    const ids = filtered.map(p => p.id);
    if (allFilteredSelected) {
      const set = new Set(ids);
      setSelection(prev => prev.filter(x => !set.has(x)));
    } else {
      setSelection(prev => [...new Set([...prev, ...ids])]);
    }
  };

  const selectedProducts = useMemo(
    () => products.filter(p => selection.includes(p.id)),
    [products, selection]
  );

  const isLoading = loadingProducts || loadingStock;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Inventory Overview</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {filtered.length} of {products.length} tracked products
            {selection.length > 0 && ` · ${selection.length} selected`}
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <InventoryCSVExport products={filtered} stockByProduct={stockByProduct} />
          <InventoryCSVImport
            products={products}
            onImportComplete={() => {
              queryClient.invalidateQueries({ queryKey: ['inv-overview-products'] });
              queryClient.invalidateQueries({ queryKey: ['inv-overview-soh'] });
            }}
          />
        </div>
      </div>

      {/* Production Floor Banner (virtual calculation) */}
      <ProductionFloorBanner />

      {/* Recalculate Committed Stock */}
      {(user?.role === 'admin' || perms.inventory_recalc_committed) && (
        <RecalcCommittedStock />
      )}

      {/* Category chips */}
      <div className="flex flex-wrap gap-2">
        {Object.entries(typeCounts).sort((a, b) => b[1] - a[1]).map(([type, count]) => (
          <button
            key={type}
            onClick={() => { setTypeFilter(typeFilter === type ? 'all' : type); setPage(0); }}
            className={`text-xs px-2.5 py-1 rounded-full font-medium transition-all ${
              typeFilter === type ? (CATEGORY_COLORS[type] || 'bg-gray-100 text-gray-700') + ' ring-2 ring-primary/30' : (CATEGORY_COLORS[type] || 'bg-gray-100 text-gray-700') + ' opacity-70 hover:opacity-100'
            }`}
          >
            {CATEGORY_LABELS[type] || type} ({count})
          </button>
        ))}
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search by SKU or name..."
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(0); }}
            className="pl-9"
          />
        </div>
        <Select value={stockFilter} onValueChange={v => { setStockFilter(v); setPage(0); }}>
          <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Stock</SelectItem>
            <SelectItem value="in_stock">In Stock</SelectItem>
            <SelectItem value="low">Low Stock</SelectItem>
            <SelectItem value="out">Out of Stock</SelectItem>
          </SelectContent>
        </Select>
        {(search || typeFilter !== 'all' || stockFilter !== 'all') && (
          <Button variant="ghost" size="sm" onClick={() => { setSearch(''); setTypeFilter('all'); setStockFilter('all'); setPage(0); }} className="gap-1">
            <X className="w-3.5 h-3.5" /> Clear
          </Button>
        )}
      </div>

      {/* Bulk action bar */}
      <div className="flex items-center gap-2 flex-wrap">
        <Button variant="outline" size="sm" onClick={toggleSelectAllFiltered} className="gap-1.5">
          <CheckSquare className="w-3.5 h-3.5" />
          {allFilteredSelected ? 'Deselect all' : `Select all ${filtered.length}`}
        </Button>
        <Button variant="outline" size="sm" disabled={selection.length === 0} onClick={() => setBulkMode('reorder')} className="gap-1.5">
          <Gauge className="w-3.5 h-3.5" />
          Update Reorder Point{selection.length > 0 ? ` (${selection.length})` : ''}
        </Button>
        <Button variant="outline" size="sm" disabled={selection.length === 0} onClick={() => setBulkMode('location')} className="gap-1.5">
          <MapPin className="w-3.5 h-3.5" />
          Set Default Location{selection.length > 0 ? ` (${selection.length})` : ''}
        </Button>
        {selection.length > 0 && (
          <Button variant="ghost" size="sm" onClick={() => setSelection([])} className="gap-1">
            <X className="w-3.5 h-3.5" /> Clear selection
          </Button>
        )}
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="text-center py-12 text-sm text-muted-foreground">Loading inventory…</div>
      ) : (
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="bg-muted/50 border-b border-border">
                <th className="w-10 px-3 py-3">
                  <input type="checkbox" className="rounded w-4 h-4" checked={pageAllSelected} onChange={togglePage} />
                </th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase">SKU</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase">Name</th>
                <th className="text-center px-4 py-3 text-xs font-semibold text-muted-foreground uppercase">Category</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase">Subcategory</th>
                <th className="text-center px-4 py-3 text-xs font-semibold text-muted-foreground uppercase">UoM</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-muted-foreground uppercase">On Hand</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-muted-foreground uppercase">Committed</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-muted-foreground uppercase">Available</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-muted-foreground uppercase">Reorder Pt</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase">Default Location</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {pageProducts.map(p => {
                const stock = stockByProduct[p.id] || { on_hand: 0, committed: 0, available: 0 };
                const reorder = p.min_before_reorder || 0;
                const isLow = stock.on_hand > 0 && reorder > 0 && stock.on_hand <= reorder;
                const isOut = stock.on_hand <= 0;
                const isSelected = selection.includes(p.id);

                return (
                  <tr
                    key={p.id}
                    className={`hover:bg-muted/30 transition-colors cursor-pointer ${isSelected ? 'bg-primary/5' : ''}`}
                    onClick={() => navigate(`/catalog/${p.id}`)}
                  >
                    <td className="px-3 py-2.5" onClick={e => e.stopPropagation()}>
                      <input type="checkbox" className="rounded w-4 h-4" checked={isSelected} onChange={() => toggleRow(p.id)} />
                    </td>
                    <td className="px-4 py-2.5 text-sm font-mono font-medium">{p.sku}</td>
                    <td className="px-4 py-2.5 text-sm">{p.name}</td>
                    <td className="px-4 py-2.5 text-center">
                      <Badge className={`text-[10px] ${getCategoryColor(p.type)}`}>
                        {getCategoryLabel(p.type)}
                      </Badge>
                    </td>
                    <td className="px-4 py-2.5 text-sm text-muted-foreground">{resolveSubcategory(p)}</td>
                    <td className="px-4 py-2.5 text-sm text-center">{p.stock_uom}</td>
                    <td className={`px-4 py-2.5 text-sm text-right tabular-nums font-medium ${isOut ? 'text-red-600' : isLow ? 'text-amber-600' : ''}`}>
                      {stock.on_hand.toLocaleString('en-ZA', { maximumFractionDigits: 2 })}
                    </td>
                    <td className="px-4 py-2.5 text-sm text-right tabular-nums text-muted-foreground">
                      {stock.committed.toLocaleString('en-ZA', { maximumFractionDigits: 2 })}
                    </td>
                    <td className={`px-4 py-2.5 text-sm text-right tabular-nums font-medium ${stock.available < 0 ? 'text-red-600' : ''}`}>
                      {stock.available.toLocaleString('en-ZA', { maximumFractionDigits: 2 })}
                    </td>
                    <td className="px-4 py-2.5 text-sm text-right tabular-nums text-muted-foreground">
                      {reorder > 0 ? reorder.toLocaleString('en-ZA', { maximumFractionDigits: 2 }) : '—'}
                    </td>
                    <td className="px-4 py-2.5 text-sm text-muted-foreground">
                      {locationMap[p.default_location_id] || '—'}
                    </td>
                  </tr>
                );
              })}
              {pageProducts.length === 0 && (
                <tr>
                  <td colSpan={11} className="px-4 py-8 text-center text-sm text-muted-foreground">
                    No products match your filters.
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

      {bulkMode && (
        <InventoryBulkEditModal
          mode={bulkMode}
          products={selectedProducts}
          locations={locations}
          onCancel={() => setBulkMode(null)}
          onDone={() => {
            setBulkMode(null);
            setSelection([]);
            queryClient.invalidateQueries({ queryKey: ['inv-overview-products'] });
            queryClient.invalidateQueries({ queryKey: ['inv-overview-soh'] });
          }}
        />
      )}
    </div>
  );
}
