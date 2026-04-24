import React, { useState, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AlertTriangle, Search, ShoppingCart, X, Loader2 } from 'lucide-react';
import CreatePOModal from '@/components/purchasing/CreatePOModal';

export default function ReorderReport() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [showCreatePO, setShowCreatePO] = useState(false);
  const [selectedItems, setSelectedItems] = useState([]);

  const { data: products = [], isLoading } = useQuery({
    queryKey: ['products-reorder'],
    queryFn: () => base44.entities.Product.filter({ status: 'active' }, 'name', 500),
  });

  const { data: stockRecords = [] } = useQuery({
    queryKey: ['stock-on-hand-reorder'],
    queryFn: () => base44.entities.StockOnHand.list('-updated_date', 2000),
  });

  const { data: suppliers = [] } = useQuery({
    queryKey: ['suppliers-active'],
    queryFn: () => base44.entities.Supplier.filter({ status: 'active' }, 'name', 200),
  });

  // Products below reorder point
  const reorderItems = useMemo(() => {
    return products
      .filter(p => p.min_before_reorder > 0) // only products with reorder point set
      .map(p => {
        const stockRows = stockRecords.filter(s => s.product_id === p.id);
        const totalOnHand = stockRows.reduce((sum, s) => sum + (s.qty_on_hand || 0), 0);
        const totalAvailable = stockRows.reduce((sum, s) => sum + (s.qty_available || 0), 0);
        const supplier = suppliers.find(s => s.id === p.supplier_id);
        return {
          ...p,
          total_on_hand: totalOnHand,
          total_available: totalAvailable,
          shortfall: p.min_before_reorder - totalOnHand,
          suggested_qty: p.reorder_qty || Math.max(p.min_before_reorder - totalOnHand, 0),
          supplier_name: supplier?.name || '—',
        };
      })
      .filter(p => p.total_on_hand < p.min_before_reorder) // below reorder point
      .sort((a, b) => b.shortfall - a.shortfall); // worst shortfall first
  }, [products, stockRecords, suppliers]);

  const filtered = useMemo(() => {
    let list = reorderItems;
    if (typeFilter !== 'all') list = list.filter(p => p.type === typeFilter);
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(p => p.name.toLowerCase().includes(q) || (p.sku || '').toLowerCase().includes(q));
    }
    return list;
  }, [reorderItems, typeFilter, search]);

  const toggleSelect = (id) => {
    setSelectedItems(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  };

  const selectAll = () => {
    if (selectedItems.length === filtered.length) setSelectedItems([]);
    else setSelectedItems(filtered.map(p => p.id));
  };

  const handleCreatePO = () => {
    const items = filtered.filter(p => selectedItems.includes(p.id));
    // Group by supplier
    if (items.length === 0) return;
    setShowCreatePO(true);
  };

  // Pre-fill PO lines from selected items
  const prefillLines = useMemo(() => {
    return filtered
      .filter(p => selectedItems.includes(p.id))
      .map(p => ({
        product_id: p.id,
        qty: String(p.suggested_qty),
        unit_cost: String(p.cost_avg || 0),
      }));
  }, [filtered, selectedItems]);

  const criticalCount = reorderItems.filter(p => p.total_on_hand === 0).length;
  const lowCount = reorderItems.length - criticalCount;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Reorder Report</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {reorderItems.length} items below reorder point
          </p>
        </div>
        {selectedItems.length > 0 && (
          <Button onClick={handleCreatePO} className="gap-2">
            <ShoppingCart className="w-4 h-4" />
            Create PO ({selectedItems.length} items)
          </Button>
        )}
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <div className="bg-card border border-border rounded-xl p-4">
          <p className="text-xs text-muted-foreground uppercase font-semibold">Total Below Reorder</p>
          <p className="text-2xl font-bold">{reorderItems.length}</p>
        </div>
        <div className="bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 rounded-xl p-4">
          <p className="text-xs text-red-600 uppercase font-semibold">Out of Stock</p>
          <p className="text-2xl font-bold text-red-700">{criticalCount}</p>
        </div>
        <div className="bg-amber-50 dark:bg-amber-950 border border-amber-200 dark:border-amber-800 rounded-xl p-4">
          <p className="text-xs text-amber-600 uppercase font-semibold">Low Stock</p>
          <p className="text-2xl font-bold text-amber-700">{lowCount}</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input placeholder="Search by name or SKU..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
        </div>
        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="w-40"><SelectValue placeholder="All types" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Types</SelectItem>
            <SelectItem value="raw">Raw</SelectItem>
            <SelectItem value="packaging">Packaging</SelectItem>
            <SelectItem value="sauce">Sauce</SelectItem>
          </SelectContent>
        </Select>
        {search && (
          <Button variant="ghost" size="sm" onClick={() => setSearch('')} className="gap-1">
            <X className="w-3.5 h-3.5" /> Clear
          </Button>
        )}
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="text-center py-12 text-sm text-muted-foreground">Loading...</div>
      ) : reorderItems.length === 0 ? (
        <div className="bg-card border border-border rounded-xl px-6 py-16 text-center">
          <div className="text-5xl mb-3">✅</div>
          <h2 className="text-lg font-semibold text-green-700">All Good!</h2>
          <p className="text-sm text-muted-foreground mt-1">No items are below their reorder point right now.</p>
        </div>
      ) : (
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="bg-muted/50 border-b border-border">
                <th className="px-4 py-3 w-10">
                  <input type="checkbox" checked={selectedItems.length === filtered.length && filtered.length > 0} onChange={selectAll} className="rounded border-border" />
                </th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase">Product</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase">Supplier</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-muted-foreground uppercase">On Hand</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-muted-foreground uppercase">Reorder At</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-muted-foreground uppercase">Shortfall</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-muted-foreground uppercase">Suggested Qty</th>
                <th className="text-center px-4 py-3 text-xs font-semibold text-muted-foreground uppercase">Severity</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filtered.map(item => {
                const pct = item.min_before_reorder > 0 ? item.total_on_hand / item.min_before_reorder : 1;
                const severity = item.total_on_hand === 0 ? 'critical' : pct < 0.5 ? 'low' : 'warning';
                return (
                  <tr key={item.id} className="hover:bg-muted/30 transition-colors">
                    <td className="px-4 py-2.5">
                      <input type="checkbox" checked={selectedItems.includes(item.id)} onChange={() => toggleSelect(item.id)} className="rounded border-border" />
                    </td>
                    <td className="px-4 py-2.5">
                      <p className="text-sm font-medium">{item.name}</p>
                      <p className="text-[10px] font-mono text-muted-foreground">{item.sku} · {item.stock_uom}</p>
                    </td>
                    <td className="px-4 py-2.5 text-sm text-muted-foreground">{item.supplier_name}</td>
                    <td className="px-4 py-2.5 text-right text-sm font-medium">{item.total_on_hand}</td>
                    <td className="px-4 py-2.5 text-right text-sm text-muted-foreground">{item.min_before_reorder}</td>
                    <td className="px-4 py-2.5 text-right text-sm font-bold text-red-600">{item.shortfall}</td>
                    <td className="px-4 py-2.5 text-right text-sm font-medium">{item.suggested_qty}</td>
                    <td className="px-4 py-2.5 text-center">
                      <Badge className={`text-[10px] ${
                        severity === 'critical' ? 'bg-red-100 text-red-700' :
                        severity === 'low' ? 'bg-amber-100 text-amber-700' :
                        'bg-yellow-100 text-yellow-700'
                      }`}>
                        {severity === 'critical' ? 'OUT' : severity === 'low' ? 'LOW' : 'WARN'}
                      </Badge>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {showCreatePO && (
        <CreatePOModal
          prefillLines={prefillLines}
          onCreated={() => {
            setShowCreatePO(false);
            setSelectedItems([]);
            queryClient.invalidateQueries({ queryKey: ['purchase-orders'] });
          }}
          onCancel={() => setShowCreatePO(false)}
        />
      )}
    </div>
  );
}