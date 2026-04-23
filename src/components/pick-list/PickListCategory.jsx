import React from 'react';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { cn } from '@/lib/utils';

export default function PickListCategory({ category, items, pickedState, onTogglePicked, onQtyChange }) {
  const allPicked = items.every(i => pickedState[i.product.id]?.picked);

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden print:break-inside-avoid print:rounded-none print:border-black">
      <div className={cn(
        "px-4 py-3 border-b border-border bg-muted/50 flex items-center gap-2",
        allPicked && "bg-green-50 dark:bg-green-900/20"
      )}>
        <h3 className="text-sm font-bold">{category}</h3>
        <Badge variant="secondary" className="text-[10px]">{items.length} items</Badge>
        {allPicked && <Badge className="bg-green-100 text-green-700 text-[10px] ml-auto">✓ All picked</Badge>}
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border">
            <th className="text-left px-4 py-2 font-medium text-muted-foreground w-12 print:w-8">Pick</th>
            <th className="text-left px-4 py-2 font-medium text-muted-foreground">SKU</th>
            <th className="text-left px-4 py-2 font-medium text-muted-foreground">Ingredient</th>
            <th className="text-right px-4 py-2 font-medium text-muted-foreground">Needed</th>
            <th className="text-center px-4 py-2 font-medium text-muted-foreground w-28 print:hidden">Picked</th>
            <th className="text-left px-4 py-2 font-medium text-muted-foreground w-14">UoM</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {items.map(item => {
            const pid = item.product.id;
            const state = pickedState[pid] || { picked: false, qty: '' };
            return (
              <tr
                key={pid}
                className={cn(
                  "transition-colors print:leading-8",
                  state.picked && "bg-green-50/60 dark:bg-green-900/10"
                )}
              >
                <td className="px-4 py-2">
                  <Checkbox
                    checked={state.picked}
                    onCheckedChange={() => onTogglePicked(pid, item.totalQty)}
                    className="w-6 h-6 print:hidden"
                  />
                  <div className="hidden print:block w-5 h-5 border-2 border-black rounded" />
                </td>
                <td className="px-4 py-2 font-mono text-xs text-muted-foreground">{item.product.sku}</td>
                <td className={cn("px-4 py-2 font-medium", state.picked && "line-through text-muted-foreground")}>
                  {item.product.name}
                </td>
                <td className="px-4 py-2 text-right font-bold tabular-nums">{item.totalQty.toLocaleString()}</td>
                <td className="px-4 py-2 text-center print:hidden">
                  <Input
                    type="number"
                    min="0"
                    value={state.qty}
                    placeholder={String(item.totalQty)}
                    onChange={e => onQtyChange(pid, e.target.value)}
                    className="w-24 h-9 text-right text-sm mx-auto"
                  />
                </td>
                <td className="px-4 py-2 text-muted-foreground">{item.uom}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}