import React, { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { X, Search, Plus, Loader2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';

export default function AddComponentModal({ bomId, existingProductIds, onAdded, onCancel }) {
  const [search, setSearch] = useState('');
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [qty, setQty] = useState('');
  const [uom, setUom] = useState('');
  const [adding, setAdding] = useState(false);

  const { data: products = [] } = useQuery({
    queryKey: ['products-for-bom-add'],
    queryFn: () => base44.entities.Product.filter({ status: 'active' }, 'name', 500),
  });

  const filtered = useMemo(() => {
    const available = products.filter(p => !existingProductIds.includes(p.id));
    if (!search.trim()) return available.slice(0, 50);
    const q = search.toLowerCase();
    return available
      .filter(p =>
        (p.name || '').toLowerCase().includes(q) ||
        (p.sku || '').toLowerCase().includes(q)
      )
      .slice(0, 50);
  }, [products, search, existingProductIds]);

  const handleAdd = async () => {
    if (!selectedProduct || !qty) return;
    setAdding(true);
    await base44.entities.BomComponent.create({
      bom_id: bomId,
      input_product_id: selectedProduct.id,
      input_product_name: selectedProduct.name,
      input_product_sku: selectedProduct.sku,
      qty: Number(qty),
      uom: uom || selectedProduct.stock_uom || 'pcs',
      is_consumable: selectedProduct.type === 'packaging',
    });
    setAdding(false);
    onAdded();
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-[60] flex items-center justify-center p-4">
      <div className="bg-card rounded-2xl border border-border w-full max-w-md shadow-xl flex flex-col max-h-[80vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border shrink-0">
          <h3 className="text-lg font-bold">Add Ingredient</h3>
          <Button variant="ghost" size="icon" onClick={onCancel}>
            <X className="w-5 h-5" />
          </Button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {!selectedProduct ? (
            <>
              {/* Search products */}
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  placeholder="Search products by name or SKU..."
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  className="pl-9"
                  autoFocus
                />
              </div>

              <div className="space-y-1 max-h-[40vh] overflow-y-auto">
                {filtered.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-4">No products found</p>
                ) : (
                  filtered.map(p => (
                    <button
                      key={p.id}
                      onClick={() => {
                        setSelectedProduct(p);
                        setUom(p.stock_uom || '');
                      }}
                      className="w-full text-left px-3 py-2.5 rounded-lg hover:bg-muted/50 transition-colors flex items-center justify-between"
                    >
                      <div>
                        <p className="text-sm font-medium">{p.name}</p>
                        <p className="text-xs text-muted-foreground font-mono">{p.sku}</p>
                      </div>
                      <Badge variant="outline" className="text-[10px]">{p.type}</Badge>
                    </button>
                  ))
                )}
                {!search.trim() && filtered.length > 0 && (
                  <p className="text-[10px] text-muted-foreground text-center py-1">Showing first 50 — search to narrow down</p>
                )}
              </div>
            </>
          ) : (
            <>
              {/* Selected product — enter qty */}
              <div className="bg-muted/50 rounded-lg p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-semibold">{selectedProduct.name}</p>
                    <p className="text-xs text-muted-foreground font-mono">{selectedProduct.sku}</p>
                  </div>
                  <Button variant="ghost" size="sm" onClick={() => setSelectedProduct(null)} className="text-xs">
                    Change
                  </Button>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-muted-foreground block mb-1">Quantity</label>
                  <Input
                    type="number"
                    step="any"
                    min="0"
                    value={qty}
                    onChange={e => setQty(e.target.value)}
                    placeholder="e.g. 500"
                    autoFocus
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground block mb-1">Unit of Measure</label>
                  <Input
                    value={uom}
                    onChange={e => setUom(e.target.value)}
                    placeholder="e.g. g, kg, pcs"
                  />
                </div>
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        {selectedProduct && (
          <div className="px-6 py-4 border-t border-border shrink-0 flex gap-3">
            <Button variant="outline" className="flex-1" onClick={onCancel}>Cancel</Button>
            <Button
              className="flex-1 gap-2"
              onClick={handleAdd}
              disabled={adding || !qty || Number(qty) <= 0}
            >
              {adding ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
              Add Ingredient
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}