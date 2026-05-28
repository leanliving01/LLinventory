import React, { useState, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  ArrowLeft, Search, Save, Loader2, Filter, CheckCircle2, AlertTriangle, Package
} from 'lucide-react';
import { toast } from 'sonner';

const TYPE_LABELS = {
  raw: 'Raw Material',
  packaging: 'Packaging',
  sauce: 'Sauce',
  supplement: 'Supplement',
  wip_bulk: 'WIP / Bulk',
  finished_meal: 'Finished Meal',
  solo_serve: 'Solo Serve',
  service: 'Service',
  bundle: 'Bundle',
  package: 'Package',
};

const STOCK_UOM_OPTIONS = ['g', 'kg', 'ml', 'L', 'pcs', 'box'];

export default function BulkPurchaseUomEditor({ onBack }) {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [showFilter, setShowFilter] = useState('missing'); // 'missing' | 'all' | 'set'
  const [edits, setEdits] = useState({}); // { productId: { purchase_uom, purchase_to_stock_factor } }
  const [saving, setSaving] = useState(false);

  const { data: products = [], isLoading } = useQuery({
    queryKey: ['bulk-uom-products'],
    queryFn: () => base44.entities.Product.filter({ status: 'active' }, 'name', 1000),
  });

  const filtered = useMemo(() => {
    return products.filter(p => {
      // Type filter
      if (typeFilter !== 'all' && p.type !== typeFilter) return false;

      // Show filter
      if (showFilter === 'missing' && p.purchase_uom) return false;
      if (showFilter === 'set' && !p.purchase_uom) return false;

      // Search
      if (search) {
        const q = search.toLowerCase();
        if (!(p.name || '').toLowerCase().includes(q) && !(p.sku || '').toLowerCase().includes(q)) return false;
      }

      return true;
    });
  }, [products, typeFilter, showFilter, search]);

  const editCount = Object.keys(edits).length;

  const updateEdit = (productId, field, value) => {
    setEdits(prev => {
      const existing = prev[productId] || {};
      const product = products.find(p => p.id === productId);
      const updated = { ...existing, [field]: value };

      // If both fields match original, remove from edits
      const origUom = product?.purchase_uom || '';
      const origFactor = product?.purchase_to_stock_factor || '';
      if ((updated.purchase_uom ?? origUom) === origUom &&
          (updated.purchase_to_stock_factor ?? origFactor) === String(origFactor)) {
        const copy = { ...prev };
        delete copy[productId];
        return copy;
      }

      return { ...prev, [productId]: updated };
    });
  };

  const handleSaveAll = async () => {
    const entries = Object.entries(edits);
    if (entries.length === 0) return;

    setSaving(true);

    try {
      let saved = 0;

      for (const [productId, changes] of entries) {
        const updateData = {};
        if (changes.purchase_uom !== undefined) updateData.purchase_uom = changes.purchase_uom;
        if (changes.purchase_to_stock_factor !== undefined) {
          const val = parseFloat(changes.purchase_to_stock_factor);
          if (!isNaN(val) && val > 0) updateData.purchase_to_stock_factor = val;
        }

        if (Object.keys(updateData).length > 0) {
          await base44.entities.Product.update(productId, updateData);
          saved++;
        }
      }

      setEdits({});
      queryClient.invalidateQueries({ queryKey: ['bulk-uom-products'] });
      toast.success(`Updated purchase UoM for ${saved} product${saved !== 1 ? 's' : ''}`);
    } catch (err) {
      toast.error('Save failed: ' + (err.message || 'Unknown error'));
    } finally {
      setSaving(false);
    }
  };

  const missingCount = products.filter(p => !p.purchase_uom).length;
  const setCount = products.filter(p => p.purchase_uom).length;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={onBack} className="h-8 w-8">
            <ArrowLeft className="w-4 h-4" />
          </Button>
          <div>
            <h2 className="text-lg font-bold">Bulk Purchase UoM Editor</h2>
            <p className="text-xs text-muted-foreground">
              Set the buying unit and conversion factor for each product
            </p>
          </div>
        </div>
        {editCount > 0 && (
          <Button onClick={handleSaveAll} disabled={saving} className="gap-2">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Save {editCount} change{editCount !== 1 ? 's' : ''}
          </Button>
        )}
      </div>

      {/* Stats + Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input placeholder="Search by name or SKU..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
        </div>

        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="w-[160px]">
            <SelectValue placeholder="All types" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All types</SelectItem>
            {Object.entries(TYPE_LABELS).map(([k, v]) => (
              <SelectItem key={k} value={k}>{v}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <div className="flex gap-1.5">
          {[
            { key: 'missing', label: `Missing (${missingCount})`, icon: AlertTriangle, color: 'text-amber-600' },
            { key: 'set', label: `Set (${setCount})`, icon: CheckCircle2, color: 'text-green-600' },
            { key: 'all', label: 'All', icon: Package, color: 'text-muted-foreground' },
          ].map(chip => {
            const Icon = chip.icon;
            return (
              <button
                key={chip.key}
                onClick={() => setShowFilter(chip.key)}
                className={`text-xs px-3 py-1.5 rounded-full font-medium flex items-center gap-1.5 transition-all ${
                  showFilter === chip.key
                    ? 'bg-primary/10 text-primary ring-2 ring-primary/30'
                    : 'bg-muted text-muted-foreground hover:bg-muted/80'
                }`}
              >
                <Icon className={`w-3 h-3 ${showFilter === chip.key ? 'text-primary' : chip.color}`} />
                {chip.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="text-center py-12 text-sm text-muted-foreground">Loading products...</div>
      ) : (
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted/50 border-b border-border">
                <th className="text-left px-4 py-2.5 text-[10px] font-semibold text-muted-foreground uppercase">SKU</th>
                <th className="text-left px-4 py-2.5 text-[10px] font-semibold text-muted-foreground uppercase">Product</th>
                <th className="text-left px-4 py-2.5 text-[10px] font-semibold text-muted-foreground uppercase w-20">Type</th>
                <th className="text-center px-4 py-2.5 text-[10px] font-semibold text-muted-foreground uppercase w-20">Stock UoM</th>
                <th className="text-left px-4 py-2.5 text-[10px] font-semibold text-muted-foreground uppercase w-48">Purchase UoM</th>
                <th className="text-left px-4 py-2.5 text-[10px] font-semibold text-muted-foreground uppercase w-32">Factor → Stock</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filtered.slice(0, 100).map(p => {
                const edit = edits[p.id] || {};
                const uomValue = edit.purchase_uom ?? (p.purchase_uom || '');
                const factorValue = edit.purchase_to_stock_factor ?? (p.purchase_to_stock_factor || '');
                const isEdited = p.id in edits;

                return (
                  <tr key={p.id} className={isEdited ? 'bg-primary/5' : 'hover:bg-muted/30'}>
                    <td className="px-4 py-2 font-mono text-xs text-muted-foreground">{p.sku}</td>
                    <td className="px-4 py-2 text-sm font-medium">{p.name}</td>
                    <td className="px-4 py-2">
                      <Badge variant="outline" className="text-[10px]">
                        {TYPE_LABELS[p.type] || p.type}
                      </Badge>
                    </td>
                    <td className="px-4 py-2 text-center">
                      <span className="text-xs font-mono font-medium">{p.stock_uom || '—'}</span>
                    </td>
                    <td className="px-4 py-2">
                      <Input
                        value={uomValue}
                        onChange={e => updateEdit(p.id, 'purchase_uom', e.target.value)}
                        placeholder="e.g. Box of 10kg"
                        className="h-8 text-xs"
                      />
                    </td>
                    <td className="px-4 py-2">
                      <div className="flex items-center gap-1.5">
                        <Input
                          type="number"
                          value={factorValue}
                          onChange={e => updateEdit(p.id, 'purchase_to_stock_factor', e.target.value)}
                          placeholder="e.g. 10"
                          className="h-8 text-xs w-20"
                          min="0"
                          step="0.01"
                        />
                        <span className="text-[10px] text-muted-foreground whitespace-nowrap">
                          {p.stock_uom || '?'}
                        </span>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-12 text-center text-sm text-muted-foreground">
                    No products match your filters
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          {filtered.length > 100 && (
            <div className="px-4 py-2 text-xs text-muted-foreground bg-muted/30 border-t border-border">
              Showing 100 of {filtered.length} — use search or filters to narrow down
            </div>
          )}
          {filtered.length > 0 && filtered.length <= 100 && (
            <div className="px-4 py-2 text-xs text-muted-foreground bg-muted/30 border-t border-border">
              {filtered.length} product{filtered.length !== 1 ? 's' : ''}
            </div>
          )}
        </div>
      )}
    </div>
  );
}