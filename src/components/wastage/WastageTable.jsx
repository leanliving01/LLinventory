import React from 'react';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

export default function WastageTable({ products, entries, onEntryChange }) {
  if (products.length === 0) {
    return <div className="text-center py-12 text-sm text-muted-foreground bg-card border border-border rounded-xl">No products found</div>;
  }

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr className="bg-muted/30 border-b border-border">
              <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase min-w-[200px]">Product</th>
              <th className="text-left px-3 py-3 text-xs font-semibold text-muted-foreground uppercase w-24">SKU</th>
              <th className="text-left px-3 py-3 text-xs font-semibold text-muted-foreground uppercase w-16">UoM</th>
              <th className="text-center px-3 py-3 text-xs font-semibold text-muted-foreground uppercase w-36">Type</th>
              <th className="text-center px-3 py-3 text-xs font-semibold text-muted-foreground uppercase w-24">Qty</th>
              <th className="text-left px-3 py-3 text-xs font-semibold text-muted-foreground uppercase">Notes</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {products.map(product => {
              const entry = entries[product.id] || {};
              return (
                <tr key={product.id} className="hover:bg-muted/30 transition-colors">
                  <td className="px-4 py-2.5 text-sm font-medium">{product.name}</td>
                  <td className="px-3 py-2.5 text-xs text-muted-foreground font-mono">{product.sku}</td>
                  <td className="px-3 py-2.5 text-xs text-muted-foreground">{product.stock_uom || 'pcs'}</td>
                  <td className="px-3 py-2.5">
                    <Select
                      value={entry.type || 'unusable'}
                      onValueChange={v => onEntryChange(product.id, 'type', v)}
                    >
                      <SelectTrigger className="h-8 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="unusable">Unusable</SelectItem>
                        <SelectItem value="usable">Usable (repack)</SelectItem>
                      </SelectContent>
                    </Select>
                  </td>
                  <td className="px-3 py-2.5">
                    <Input
                      type="number"
                      min="0"
                      value={entry.qty || ''}
                      placeholder="0"
                      onChange={e => onEntryChange(product.id, 'qty', e.target.value)}
                      className="w-20 text-right h-8 text-sm mx-auto"
                    />
                  </td>
                  <td className="px-3 py-2.5">
                    <Input
                      value={entry.notes || ''}
                      placeholder="Optional note"
                      onChange={e => onEntryChange(product.id, 'notes', e.target.value)}
                      className="h-8 text-xs"
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}