import React, { useState, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AlertTriangle, Search, ShoppingCart, X, CheckCircle2, Clock, Pencil, Check, Loader2 } from 'lucide-react';
import CreatePOModal from '@/components/purchasing/CreatePOModal';
import HelpDrawer from '@/components/help/HelpDrawer';
import { toast } from 'sonner';

export default function ReorderReport() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [viewFilter, setViewFilter] = useState('low_first'); // low_first | low_only | all_alpha
  const [sortBy, setSortBy] = useState('severity');
  const [showCreatePO, setShowCreatePO] = useState(false);
  const [selectedItems, setSelectedItems] = useState([]);
  const [editingId, setEditingId] = useState(null);
  const [editValues, setEditValues] = useState({});
  const [saving, setSaving] = useState(false);

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

  const { data: supplierProducts = [] } = useQuery({
    queryKey: ['supplier-products-reorder'],
    queryFn: () => base44.entities.SupplierProduct.filter({ active: true }, 'product_name', 2000),
  });

  // Build full product list with stock info
  const allItems = useMemo(() => {
    return products.map(p => {
      const stockRows = stockRecords.filter(s => s.product_id === p.id);
      const totalOnHand = stockRows.reduce((sum, s) => sum + (s.qty_on_hand || 0), 0);
      const totalAvailable = stockRows.reduce((sum, s) => sum + (s.qty_available || 0), 0);
      const defaultSupplier = supplierProducts.find(sp => sp.product_id === p.id && sp.is_default_supplier)
        || supplierProducts.find(sp => sp.product_id === p.id);
      const legacySupplier = suppliers.find(s => s.id === p.supplier_id);
      const reorderPoint = p.min_before_reorder || 0;
      const isBelow = reorderPoint > 0 && totalOnHand < reorderPoint;
      const shortfall = isBelow ? reorderPoint - totalOnHand : 0;

      let severity = 'ok';
      if (isBelow) {
        if (totalOnHand === 0) severity = 'critical';
        else if (reorderPoint > 0 && totalOnHand / reorderPoint < 0.5) severity = 'low';
        else severity = 'warning';
      }

      return {
        ...p,
        total_on_hand: totalOnHand,
        total_available: totalAvailable,
        shortfall,
        is_below: isBelow,
        severity,
        suggested_qty: p.reorder_qty || Math.max(shortfall, 0),
        supplier_name: defaultSupplier?.supplier_name || legacySupplier?.name || '—',
      };
    });
  }, [products, stockRecords, suppliers, supplierProducts]);

  // Counts
  const criticalCount = allItems.filter(p => p.severity === 'critical').length;
  const lowCount = allItems.filter(p => p.severity === 'low').length;
  const warningCount = allItems.filter(p => p.severity === 'warning').length;
  const belowCount = criticalCount + lowCount + warningCount;

  // Filter and sort
  const filtered = useMemo(() => {
    let list = allItems;

    if (typeFilter !== 'all') list = list.filter(p => p.type === typeFilter);
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(p => p.name.toLowerCase().includes(q) || (p.sku || '').toLowerCase().includes(q));
    }

    if (viewFilter === 'low_only') {
      list = list.filter(p => p.is_below);
    }

    const severityOrder = { critical: 0, low: 1, warning: 2, ok: 3 };
    switch (sortBy) {
      case 'date_desc':
        list.sort((a, b) => new Date(b.created_date || 0) - new Date(a.created_date || 0));
        break;
      case 'date_asc':
        list.sort((a, b) => new Date(a.created_date || 0) - new Date(b.created_date || 0));
        break;
      case 'name_asc':
        list.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
        break;
      case 'severity':
      default:
        list.sort((a, b) => {
          const sa = severityOrder[a.severity] ?? 3;
          const sb = severityOrder[b.severity] ?? 3;
          if (sa !== sb) return sa - sb;
          if (a.is_below && b.is_below) return b.shortfall - a.shortfall;
          return a.name.localeCompare(b.name);
        });
        break;
    }

    return list;
  }, [allItems, typeFilter, search, viewFilter, sortBy]);

  const startEdit = (item) => {
    setEditingId(item.id);
    setEditValues({
      min_before_reorder: item.min_before_reorder || 0,
      reorder_qty: item.reorder_qty || 0,
      lead_time_days: item.lead_time_days || 0,
    });
  };

  const cancelEdit = () => { setEditingId(null); setEditValues({}); };

  const saveEdit = async () => {
    if (!editingId) return;
    setSaving(true);

    try {
      await base44.entities.Product.update(editingId, {
        min_before_reorder: Number(editValues.min_before_reorder) || 0,
        reorder_qty: Number(editValues.reorder_qty) || 0,
        lead_time_days: Number(editValues.lead_time_days) || 0,
      });
      queryClient.invalidateQueries({ queryKey: ['products-reorder'] });
      setEditingId(null);
      setEditValues({});
    } catch (err) {
      toast.error('Save failed: ' + (err.message || 'Unknown error'));
    } finally {
      setSaving(false);
    }

    toast.success('Product updated');
  };

  const toggleSelect = (id) => {
    setSelectedItems(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  };

  const selectAllLow = () => {
    const lowIds = filtered.filter(p => p.is_below).map(p => p.id);
    if (lowIds.every(id => selectedItems.includes(id))) setSelectedItems([]);
    else setSelectedItems(lowIds);
  };

  // Pre-fill PO lines from selected items
  const prefillLines = useMemo(() => {
    return filtered
      .filter(p => selectedItems.includes(p.id))
      .map(p => ({
        product_id: p.id,
        qty: String(p.suggested_qty || 1),
        unit_cost: String(p.cost_avg || 0),
      }));
  }, [filtered, selectedItems]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Reorder Report</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {allItems.length} products · {belowCount} below reorder point
          </p>
        </div>
        <div className="flex items-center gap-2">
          {selectedItems.length > 0 && (
            <Button onClick={() => setShowCreatePO(true)} className="gap-2">
              <ShoppingCart className="w-4 h-4" />
              Create PO ({selectedItems.length} items)
            </Button>
          )}
          <HelpDrawer pageKey="reorder-report" />
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="bg-card border border-border rounded-xl p-4">
          <p className="text-xs text-muted-foreground uppercase font-semibold">Total Products</p>
          <p className="text-2xl font-bold">{allItems.length}</p>
        </div>
        <div className="bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 rounded-xl p-4">
          <p className="text-xs text-red-600 uppercase font-semibold">Out of Stock</p>
          <p className="text-2xl font-bold text-red-700">{criticalCount}</p>
        </div>
        <div className="bg-amber-50 dark:bg-amber-950 border border-amber-200 dark:border-amber-800 rounded-xl p-4">
          <p className="text-xs text-amber-600 uppercase font-semibold">Low Stock</p>
          <p className="text-2xl font-bold text-amber-700">{lowCount + warningCount}</p>
        </div>
        <div className="bg-green-50 dark:bg-green-950 border border-green-200 dark:border-green-800 rounded-xl p-4">
          <p className="text-xs text-green-600 uppercase font-semibold">OK</p>
          <p className="text-2xl font-bold text-green-700">{allItems.length - belowCount}</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input placeholder="Search by name or SKU..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
        </div>
        <Select value={viewFilter} onValueChange={setViewFilter}>
          <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="low_first">All (low stock first)</SelectItem>
            <SelectItem value="low_only">Low stock only</SelectItem>
          </SelectContent>
        </Select>
        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="w-40"><SelectValue placeholder="All types" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Types</SelectItem>
            <SelectItem value="raw">Raw</SelectItem>
            <SelectItem value="packaging">Packaging</SelectItem>
            <SelectItem value="sauce">Sauce</SelectItem>
            <SelectItem value="wip_bulk">WIP Bulk</SelectItem>
            <SelectItem value="finished_meal">Finished Meal</SelectItem>
          </SelectContent>
        </Select>
        <Select value={sortBy} onValueChange={setSortBy}>
          <SelectTrigger className="w-[160px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="severity">Severity (default)</SelectItem>
            <SelectItem value="date_desc">Date (newest)</SelectItem>
            <SelectItem value="date_asc">Date (oldest)</SelectItem>
            <SelectItem value="name_asc">Name (A-Z)</SelectItem>
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
      ) : (
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="bg-muted/50 border-b border-border">
                <th className="px-4 py-3 w-10">
                  <input
                    type="checkbox"
                    checked={filtered.filter(p => p.is_below).length > 0 && filtered.filter(p => p.is_below).every(p => selectedItems.includes(p.id))}
                    onChange={selectAllLow}
                    className="rounded border-border"
                    title="Select all low stock items"
                  />
                </th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase">Product</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase">Supplier</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-muted-foreground uppercase">On Hand</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-muted-foreground uppercase">Reorder At</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-muted-foreground uppercase">Shortfall</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-muted-foreground uppercase">Reorder Qty</th>
                <th className="text-center px-4 py-3 text-xs font-semibold text-muted-foreground uppercase">Lead Time</th>
                <th className="text-center px-4 py-3 text-xs font-semibold text-muted-foreground uppercase">Status</th>
                <th className="w-10"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filtered.map(item => (
                <tr
                  key={item.id}
                  className={`hover:bg-muted/30 transition-colors ${
                    item.severity === 'critical' ? 'bg-red-50/50 dark:bg-red-950/30' :
                    item.severity === 'low' ? 'bg-amber-50/50 dark:bg-amber-950/30' :
                    item.severity === 'warning' ? 'bg-yellow-50/30 dark:bg-yellow-950/20' : ''
                  }`}
                >
                  <td className="px-4 py-2.5">
                    <input
                      type="checkbox"
                      checked={selectedItems.includes(item.id)}
                      onChange={() => toggleSelect(item.id)}
                      className="rounded border-border"
                    />
                  </td>
                  <td className="px-4 py-2.5">
                    <p className="text-sm font-medium">{item.name}</p>
                    <p className="text-[10px] font-mono text-muted-foreground">{item.sku} · {item.stock_uom}</p>
                  </td>
                  <td className="px-4 py-2.5 text-sm text-muted-foreground">{item.supplier_name}</td>
                  <td className="px-4 py-2.5 text-right text-sm font-medium">{item.total_on_hand}</td>
                  <td className="px-4 py-2.5 text-right text-sm">
                    {editingId === item.id ? (
                      <Input type="number" className="w-20 h-7 text-right text-sm ml-auto" value={editValues.min_before_reorder} onChange={e => setEditValues(v => ({ ...v, min_before_reorder: e.target.value }))} />
                    ) : (
                      <span className="text-muted-foreground">{item.min_before_reorder || '—'}</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-right text-sm">
                    {item.shortfall > 0 ? (
                      <span className="font-bold text-red-600">{item.shortfall}</span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-right text-sm">
                    {editingId === item.id ? (
                      <Input type="number" className="w-20 h-7 text-right text-sm ml-auto" value={editValues.reorder_qty} onChange={e => setEditValues(v => ({ ...v, reorder_qty: e.target.value }))} />
                    ) : (
                      <span>{item.reorder_qty || '—'}</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-center text-sm">
                    {editingId === item.id ? (
                      <Input type="number" className="w-16 h-7 text-center text-sm mx-auto" value={editValues.lead_time_days} onChange={e => setEditValues(v => ({ ...v, lead_time_days: e.target.value }))} />
                    ) : item.lead_time_days ? (
                      <span className="flex items-center justify-center gap-1 text-muted-foreground">
                        <Clock className="w-3 h-3" /> {item.lead_time_days}d
                      </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-center">
                    {item.severity === 'critical' ? (
                      <Badge className="text-[10px] bg-red-100 text-red-700">OUT</Badge>
                    ) : item.severity === 'low' ? (
                      <Badge className="text-[10px] bg-amber-100 text-amber-700">LOW</Badge>
                    ) : item.severity === 'warning' ? (
                      <Badge className="text-[10px] bg-yellow-100 text-yellow-700">WARN</Badge>
                    ) : (
                      <Badge className="text-[10px] bg-green-100 text-green-700">OK</Badge>
                    )}
                  </td>
                  <td className="px-4 py-2.5">
                    {editingId === item.id ? (
                      <div className="flex gap-1">
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={saveEdit} disabled={saving}>
                          {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5 text-green-600" />}
                        </Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={cancelEdit}>
                          <X className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    ) : (
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => startEdit(item)}>
                        <Pencil className="w-3.5 h-3.5 text-muted-foreground" />
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={10} className="px-4 py-12 text-center text-sm text-muted-foreground">
                    No products match your filters.
                  </td>
                </tr>
              )}
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