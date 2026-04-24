import React from 'react';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { cn } from '@/lib/utils';

export default function PickListCategory({ category, items, pickedState, onTogglePicked, onQtyChange, disabled = false }) {
  const allPicked = items.every(i => {
    const s = pickedState[i.product.id];
    return s?.picked && s?.qty && Number(s.qty) > 0;
  });

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
      <div className="overflow-x-auto">
        <table className="w-full text-sm table-fixed">
          <colgroup>
            <col className="w-14" />
            <col className="w-24" />
            <col />
            <col className="w-28" />
            <col className="w-28 print:hidden" />
            <col className="w-16" />
          </colgroup>
          <thead>
            <tr className="border-b border-border">
              <th className="text-left px-4 py-2 font-medium text-muted-foreground">Pick</th>
              <th className="text-left px-4 py-2 font-medium text-muted-foreground">SKU</th>
              <th className="text-left px-4 py-2 font-medium text-muted-foreground">Ingredient</th>
              <th className="text-right px-4 py-2 font-medium text-muted-foreground">Needed</th>
              <th className="text-center px-4 py-2 font-medium text-muted-foreground print:hidden">Picked Qty</th>
              <th className="text-left px-4 py-2 font-medium text-muted-foreground">UoM</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {items.map(item => {
              const pid = item.product.id;
              const state = pickedState[pid] || { picked: false, qty: '' };
              const isComplete = state.picked && state.qty && Number(state.qty) > 0;
              return (
                <tr
                  key={pid}
                  className={cn(
                    "transition-colors print:leading-8",
                    isComplete && "bg-green-50/60 dark:bg-green-900/10",
                    state.picked && !state.qty && "bg-amber-50/60 dark:bg-amber-900/10"
                  )}
                >
                  <td className="px-4 py-2">
                    <Checkbox
                      checked={state.picked}
                      onCheckedChange={() => onTogglePicked(pid)}
                      disabled={disabled}
                      className="w-6 h-6 print:hidden"
                    />
                    <div className="hidden print:block w-5 h-5 border-2 border-black rounded" />
                  </td>
                  <td className="px-4 py-2 font-mono text-xs text-muted-foreground truncate">{item.product.sku}</td>
                  <td className={cn("px-4 py-2 font-medium truncate", isComplete && "line-through text-muted-foreground")}>
                    {item.product.name}
                  </td>
                  <td className="px-4 py-2 text-right font-bold tabular-nums">{item.totalQty.toLocaleString()}</td>
                  <td className="px-4 py-2 text-center print:hidden">
                    {state.picked && !disabled ? (
                      <Input
                        type="number"
                        min="0"
                        step="any"
                        value={state.qty}
                        placeholder="Enter qty..."
                        onChange={e => onQtyChange(pid, e.target.value)}
                        className={cn(
                          "w-24 h-9 text-right text-sm mx-auto",
                          state.picked && !state.qty && "border-amber-400 ring-1 ring-amber-300"
                        )}
                        autoFocus={state.picked && !state.qty}
                      />
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-muted-foreground">{item.uom}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}