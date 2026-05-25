import React, { useState, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Trash2, Search } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Single material line within a PackingRuleForm.
 * Shows product picker, deduction mode, qty fields, and a summary.
 */
export default function MaterialLineEditor({ material, index, products, trigger, canRemove, onChange, onRemove }) {
  const [productSearch, setProductSearch] = useState('');

  const selectedProduct = products.find(p => p.id === material.product_id);

  const filteredProducts = useMemo(() => {
    if (!productSearch) return products;
    const s = productSearch.toLowerCase();
    return products.filter(p => p.name?.toLowerCase().includes(s) || p.sku?.toLowerCase().includes(s));
  }, [products, productSearch]);

  const selectProduct = (p) => {
    onChange({ product_id: p.id, sku: p.sku || '', name: p.name || '' });
    setProductSearch('');
  };

  const triggerLabel = trigger === 'has_supplements' ? 'supplements' : trigger === 'has_meals' ? 'meals' : 'items';

  const summaryText = material.deduction_mode === 'fixed_per_order'
    ? `${material.qty_per_deduction} × ${material.name || '?'} per order`
    : `${material.qty_per_deduction} × ${material.name || '?'} per ${material.per_x_items} ${triggerLabel}`;

  return (
    <div className="border border-border rounded-lg bg-muted/20 overflow-hidden">
      {/* Header with index + remove */}
      <div className="px-4 py-2 bg-muted/30 flex items-center justify-between border-b border-border">
        <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
          Material {index + 1}
        </span>
        {canRemove && (
          <button
            onClick={onRemove}
            className="p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
          >
            <Trash2 className="w-3.5 h-3.5" strokeWidth={1.5} />
          </button>
        )}
      </div>

      <div className="p-4 space-y-3">
        {/* Product selector */}
        {selectedProduct ? (
          <div className="flex items-center gap-2 p-2.5 bg-card rounded-lg border border-border">
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">{selectedProduct.name}</p>
              <p className="text-[11px] font-mono text-muted-foreground">{selectedProduct.sku}</p>
            </div>
            <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => onChange({ product_id: '', sku: '', name: '' })}>
              Change
            </Button>
          </div>
        ) : (
          <div className="space-y-1.5">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
              <Input
                placeholder="Search packaging products..."
                value={productSearch}
                onChange={e => setProductSearch(e.target.value)}
                className="pl-9 h-8 text-sm"
              />
            </div>
            <div className="max-h-32 overflow-y-auto border border-border rounded-lg divide-y divide-border">
              {filteredProducts.length === 0 ? (
                <p className="text-xs text-muted-foreground p-2.5 text-center">No products found</p>
              ) : (
                filteredProducts.slice(0, 15).map(p => (
                  <button
                    key={p.id}
                    onClick={() => selectProduct(p)}
                    className="w-full text-left px-3 py-1.5 hover:bg-muted/50 transition-colors"
                  >
                    <p className="text-sm font-medium truncate">{p.name}</p>
                    <p className="text-[10px] font-mono text-muted-foreground">{p.sku}</p>
                  </button>
                ))
              )}
            </div>
          </div>
        )}

        {/* Deduction mode */}
        <Select value={material.deduction_mode} onValueChange={v => onChange({ deduction_mode: v })}>
          <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="fixed_per_order">Fixed per order</SelectItem>
            <SelectItem value="per_x_items">Per X items</SelectItem>
          </SelectContent>
        </Select>

        {/* Qty fields */}
        <div className={cn("grid gap-3", material.deduction_mode === 'per_x_items' ? 'grid-cols-2' : 'grid-cols-1')}>
          <div className="space-y-1">
            <Label className="text-[10px] text-muted-foreground">Qty to deduct</Label>
            <Input
              type="number"
              min={1}
              value={material.qty_per_deduction}
              onChange={e => onChange({ qty_per_deduction: Number(e.target.value) || 1 })}
              className="h-8 text-sm tabular-nums"
            />
          </div>
          {material.deduction_mode === 'per_x_items' && (
            <div className="space-y-1">
              <Label className="text-[10px] text-muted-foreground">Per every X {triggerLabel}</Label>
              <Input
                type="number"
                min={1}
                value={material.per_x_items}
                onChange={e => onChange({ per_x_items: Number(e.target.value) || 1 })}
                className="h-8 text-sm tabular-nums"
              />
            </div>
          )}
        </div>

        {/* Inline summary */}
        {material.product_id && (
          <p className="text-[11px] text-muted-foreground">
            → {summaryText}
          </p>
        )}
      </div>
    </div>
  );
}