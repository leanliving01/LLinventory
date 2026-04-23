import React from 'react';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

export default function StockTakeCountTable({ products, stockMap, counts, onCountChange }) {
  if (products.length === 0) {
    return (
      <div className="bg-card border border-border rounded-xl px-6 py-12 text-center text-sm text-muted-foreground">
        No products found matching your filters.
      </div>
    );
  }

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/50">
              <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">SKU</th>
              <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Product</th>
              <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">UoM</th>
              <th className="text-right px-4 py-2.5 font-medium text-muted-foreground">System Qty</th>
              <th className="text-center px-4 py-2.5 font-medium text-muted-foreground w-32">Counted</th>
              <th className="text-right px-4 py-2.5 font-medium text-muted-foreground w-24">Variance</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {products.map(product => {
              const systemQty = stockMap[product.id]?.qty_on_hand || 0;
              const counted = counts[product.id];
              const hasCounted = counted !== undefined && counted !== '';
              const variance = hasCounted ? Number(counted) - systemQty : null;

              return (
                <tr key={product.id} className={cn(hasCounted && "bg-green-50/50 dark:bg-green-950/20")}>
                  <td className="px-4 py-2 font-mono text-xs text-muted-foreground">{product.sku}</td>
                  <td className="px-4 py-2 font-medium">{product.name}</td>
                  <td className="px-4 py-2 text-muted-foreground">{product.stock_uom}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{systemQty}</td>
                  <td className="px-4 py-1.5 text-center">
                    <Input
                      type="number"
                      className="h-9 w-28 mx-auto text-center text-base font-medium"
                      placeholder="—"
                      value={counted ?? ''}
                      onChange={e => onCountChange(product.id, e.target.value)}
                      min="0"
                    />
                  </td>
                  <td className="px-4 py-2 text-right">
                    {variance !== null && (
                      <Badge className={cn(
                        "font-mono",
                        variance === 0 && "bg-muted text-muted-foreground",
                        variance > 0 && "bg-green-100 text-green-700",
                        variance < 0 && "bg-red-100 text-red-700",
                      )}>
                        {variance > 0 ? '+' : ''}{variance}
                      </Badge>
                    )}
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