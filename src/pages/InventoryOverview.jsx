import React, { useState, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Search, X, Package } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import InventoryCSVExport from '@/components/inventory/InventoryCSVExport';
import InventoryCSVImport from '@/components/inventory/InventoryCSVImport';
import RecalcCommittedStock from '@/components/inventory/RecalcCommittedStock';
import { useAuth } from '@/lib/AuthContext';
import { getUserPermissions } from '@/lib/permissions';

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

const PAGE_SIZE = 15;

export default function InventoryOverview() {
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [stockFilter, setStockFilter] = useState('all'); // all, in_stock, low, out
  const [page, setPage] = useState(0);
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

  const pageProducts = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);

  const typeCounts = useMemo(() => {
    const counts = {};
    products.forEach(p => { counts[p.type] = (counts[p.type] || 0) + 1; });
    return counts;
  }, [products]);

  const isLoading = loadingProducts || loadingStock;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Inventory Overview</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {filtered.length} of {products.length} tracked products
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

      {/* Recalculate Committed Stock */}
      {(user?.role === 'admin' || perms.inventory_recalc_committed) && (
        <RecalcCommittedStock />
      )}

      {/* Type chips */}
      <div className="flex flex-wrap gap-2">
        {Object.entries(typeCounts).sort((a, b) => b[1] - a[1]).map(([type, count]) => (
          <button
            key={type}
            onClick={() => { setTypeFilter(typeFilter === type ? 'all' : type); setPage(0); }}
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

      {/* Table */}
      {isLoading ? (
        <div className="text-center py-12 text-sm text-muted-foreground">Loading inventory…</div>
      ) : (
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="bg-muted/50 border-b border-border">
                <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase">SKU</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase">Name</th>
                <th className="text-center px-4 py-3 text-xs font-semibold text-muted-foreground uppercase">Type</th>
                <th className="text-center px-4 py-3 text-xs font-semibold text-muted-foreground uppercase">UoM</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-muted-foreground uppercase">On Hand</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-muted-foreground uppercase">Committed</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-muted-foreground uppercase">Available</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-muted-foreground uppercase">Reorder Pt</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {pageProducts.map(p => {
                const stock = stockByProduct[p.id] || { on_hand: 0, committed: 0, available: 0 };
                const reorder = p.min_before_reorder || 0;
                const isLow = stock.on_hand > 0 && reorder > 0 && stock.on_hand <= reorder;
                const isOut = stock.on_hand <= 0;

                return (
                  <tr
                    key={p.id}
                    className="hover:bg-muted/30 transition-colors cursor-pointer"
                    onClick={() => navigate(`/catalog/${p.id}`)}
                  >
                    <td className="px-4 py-2.5 text-sm font-mono font-medium">{p.sku}</td>
                    <td className="px-4 py-2.5 text-sm">{p.name}</td>
                    <td className="px-4 py-2.5 text-center">
                      <Badge className={`text-[10px] ${TYPE_COLORS[p.type] || 'bg-gray-100 text-gray-700'}`}>
                        {TYPE_LABELS[p.type] || p.type}
                      </Badge>
                    </td>
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
                  </tr>
                );
              })}
              {pageProducts.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-sm text-muted-foreground">
                    No products match your filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>

          {totalPages > 1 && (
            <div className="flex items-center justify-between px-4 py-3 border-t border-border bg-muted/30">
              <span className="text-xs text-muted-foreground">
                Showing {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, filtered.length)} of {filtered.length}
              </span>
              <div className="flex gap-1">
                <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage(p => p - 1)}>Prev</Button>
                <Button variant="outline" size="sm" disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)}>Next</Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}