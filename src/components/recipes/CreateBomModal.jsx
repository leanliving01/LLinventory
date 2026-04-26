import React, { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { X, Plus, Loader2, Search } from 'lucide-react';
import { Badge } from '@/components/ui/badge';

const LAYER_OPTIONS = [
  { value: 'cook', label: 'Cook', desc: 'Raw materials → Bulk cooked (WIP)' },
  { value: 'portion', label: 'Portion', desc: 'Bulk cooked → Portioned meal' },
  { value: 'pack', label: 'Pack', desc: 'Meals → Package' },
];

export default function CreateBomModal({ onCreated, onCancel, defaults }) {
  const [bomType, setBomType] = useState(defaults?.bomType || 'cook');
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [search, setSearch] = useState('');
  const [yieldQty, setYieldQty] = useState('1');
  const [yieldUom, setYieldUom] = useState('');
  const [notes, setNotes] = useState('');
  const [creating, setCreating] = useState(false);

  const { data: products = [] } = useQuery({
    queryKey: ['products-for-bom-create'],
    queryFn: () => base44.entities.Product.filter({ status: 'active' }, 'name', 500),
  });

  // Auto-select product from defaults (deep-link from Product page)
  React.useEffect(() => {
    if (defaults?.productId && products.length > 0 && !selectedProduct) {
      const match = products.find(p => p.id === defaults.productId);
      if (match) {
        setSelectedProduct(match);
        setYieldUom(match.stock_uom || '');
      }
    }
  }, [defaults, products]);

  const filtered = useMemo(() => {
    const available = products;
    if (!search.trim()) return available.slice(0, 50);
    const q = search.toLowerCase();
    return available.filter(p =>
      (p.name || '').toLowerCase().includes(q) ||
      (p.sku || '').toLowerCase().includes(q)
    ).slice(0, 50);
  }, [products, search]);

  const handleCreate = async () => {
    if (!selectedProduct) return;
    setCreating(true);
    await base44.entities.Bom.create({
      product_id: selectedProduct.id,
      product_name: selectedProduct.name,
      product_sku: selectedProduct.sku,
      bom_type: bomType,
      yield_qty: Number(yieldQty) || 1,
      yield_uom: yieldUom || selectedProduct.stock_uom || 'pcs',
      version: 1,
      is_active: true,
      notes: notes || undefined,
    });
    setCreating(false);
    onCreated();
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-[60] flex items-center justify-center p-4">
      <div className="bg-card rounded-2xl border border-border w-full max-w-md shadow-xl flex flex-col max-h-[85vh]">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border shrink-0">
          <h3 className="text-lg font-bold">Create New BOM</h3>
          <Button variant="ghost" size="icon" onClick={onCancel}>
            <X className="w-5 h-5" />
          </Button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {/* Layer type */}
          <div>
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block mb-2">Recipe Type</label>
            <div className="space-y-2">
              {LAYER_OPTIONS.map(opt => (
                <button
                  key={opt.value}
                  onClick={() => setBomType(opt.value)}
                  className={`w-full text-left px-4 py-3 rounded-xl border transition-all ${
                    bomType === opt.value
                      ? 'border-primary bg-primary/5 ring-1 ring-primary/30'
                      : 'border-border hover:bg-muted/30'
                  }`}
                >
                  <p className="text-sm font-semibold">{opt.label}</p>
                  <p className="text-xs text-muted-foreground">{opt.desc}</p>
                </button>
              ))}
            </div>
          </div>

          {/* Output product */}
          <div>
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block mb-2">Output Product</label>
            {selectedProduct ? (
              <div className="bg-muted/50 rounded-lg p-3 flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold">{selectedProduct.name}</p>
                  <p className="text-xs text-muted-foreground font-mono">{selectedProduct.sku}</p>
                </div>
                <Button variant="ghost" size="sm" className="text-xs" onClick={() => setSelectedProduct(null)}>Change</Button>
              </div>
            ) : (
              <>
                <div className="relative mb-2">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    placeholder="Search product by name or SKU..."
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    className="pl-9"
                  />
                </div>
                <div className="space-y-1 max-h-[30vh] overflow-y-auto">
                  {filtered.map(p => (
                    <button
                      key={p.id}
                      onClick={() => { setSelectedProduct(p); setYieldUom(p.stock_uom || ''); }}
                      className="w-full text-left px-3 py-2 rounded-lg hover:bg-muted/50 transition-colors flex items-center justify-between"
                    >
                      <div>
                        <p className="text-sm font-medium">{p.name}</p>
                        <p className="text-xs text-muted-foreground font-mono">{p.sku}</p>
                      </div>
                      <Badge variant="outline" className="text-[10px]">{p.type}</Badge>
                    </button>
                  ))}
                  {filtered.length === 0 && <p className="text-sm text-muted-foreground text-center py-3">No products found</p>}
                </div>
              </>
            )}
          </div>

          {/* Yield */}
          <div>
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block mb-2">Yield</label>
            <div className="flex gap-2">
              <Input
                type="number"
                step="any"
                min="0"
                placeholder="Quantity"
                value={yieldQty}
                onChange={e => setYieldQty(e.target.value)}
                className="w-24"
              />
              <Input
                placeholder="UoM (e.g. kg, pcs)"
                value={yieldUom}
                onChange={e => setYieldUom(e.target.value)}
                className="w-28"
              />
            </div>
          </div>

          {/* Notes */}
          <div>
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block mb-2">Notes (optional)</label>
            <Input
              placeholder="Any notes about this recipe..."
              value={notes}
              onChange={e => setNotes(e.target.value)}
            />
          </div>
        </div>

        <div className="px-6 py-4 border-t border-border shrink-0 flex gap-3">
          <Button variant="outline" className="flex-1" onClick={onCancel}>Cancel</Button>
          <Button
            className="flex-1 gap-2"
            onClick={handleCreate}
            disabled={creating || !selectedProduct}
          >
            {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
            Create BOM
          </Button>
        </div>
      </div>
    </div>
  );
}