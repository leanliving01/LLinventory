import React, { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { X, Search, Plus, Star } from 'lucide-react';

/**
 * Modal to pick from SupplierProduct catalog and add lines to a GRN.
 * Filters to selected supplier, shows UoM info and last price.
 */
export default function AddGRNLineModal({ supplierId, existingProductIds, onAdd, onClose }) {
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState([]);

  const { data: supplierProducts = [] } = useQuery({
    queryKey: ['sp-for-grn', supplierId],
    queryFn: () => base44.entities.SupplierProduct.filter(
      { supplier_id: supplierId, active: true }, 'product_name', 200
    ),
  });

  const available = useMemo(() => {
    const existing = new Set(existingProductIds || []);
    let list = supplierProducts.filter(sp => !existing.has(sp.product_id));
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(sp =>
        (sp.product_name || '').toLowerCase().includes(q) ||
        (sp.product_sku || '').toLowerCase().includes(q) ||
        (sp.supplier_sku || '').toLowerCase().includes(q)
      );
    }
    return list.slice(0, 15);
  }, [supplierProducts, existingProductIds, search]);

  const toggle = (sp) => {
    setSelected(prev =>
      prev.find(s => s.id === sp.id)
        ? prev.filter(s => s.id !== sp.id)
        : [...prev, sp]
    );
  };

  const handleAdd = () => {
    const lines = selected.map(sp => ({
      supplier_product_id: sp.id,
      product_id: sp.product_id,
      product_name: sp.product_name,
      product_sku: sp.product_sku,
      purchase_uom: sp.purchase_uom,
      conversion_factor: sp.conversion_factor || 1,
      conversion_uom: sp.conversion_uom || '',
      yield_factor: sp.yield_factor || 1,
      unit_cost: sp.last_purchase_price || 0,
      received_qty: '',
      expected_qty: null,
      condition: 'accepted',
      item_type: 'stock',
    }));
    onAdd(lines);
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-[60] flex items-center justify-center p-4">
      <div className="bg-card rounded-2xl border border-border w-full max-w-lg shadow-xl max-h-[80vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <h3 className="text-lg font-bold">Add Products</h3>
          <Button variant="ghost" size="icon" onClick={onClose}><X className="w-5 h-5" /></Button>
        </div>

        <div className="px-6 py-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input placeholder="Search products..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9" autoFocus />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-6 space-y-1 pb-4">
          {available.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">
              {supplierProducts.length === 0
                ? 'No products linked to this supplier yet.'
                : 'All products already added or no match.'}
            </p>
          ) : (
            available.map(sp => {
              const isSelected = selected.some(s => s.id === sp.id);
              return (
                <button
                  key={sp.id}
                  onClick={() => toggle(sp)}
                  className={`w-full text-left px-3 py-2.5 rounded-lg border transition-all ${
                    isSelected ? 'border-primary bg-primary/5 ring-2 ring-primary/20' : 'border-border hover:bg-muted/30'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="flex items-center gap-1.5">
                        <span className="text-sm font-medium">{sp.product_name}</span>
                        {sp.is_default_supplier && <Star className="w-3 h-3 text-amber-500 fill-amber-500" />}
                      </div>
                      <div className="text-[11px] text-muted-foreground">
                        {sp.product_sku} · {sp.purchase_uom_label || sp.purchase_uom} · R {(sp.last_purchase_price || 0).toFixed(2)}
                      </div>
                    </div>
                    {isSelected && (
                      <div className="w-5 h-5 rounded-full bg-primary flex items-center justify-center">
                        <Plus className="w-3 h-3 text-primary-foreground rotate-45" />
                      </div>
                    )}
                  </div>
                </button>
              );
            })
          )}
        </div>

        <div className="px-6 py-4 border-t border-border flex gap-3">
          <Button variant="outline" className="flex-1" onClick={onClose}>Cancel</Button>
          <Button className="flex-1 gap-2" onClick={handleAdd} disabled={selected.length === 0}>
            <Plus className="w-4 h-4" /> Add {selected.length} Product{selected.length !== 1 ? 's' : ''}
          </Button>
        </div>
      </div>
    </div>
  );
}