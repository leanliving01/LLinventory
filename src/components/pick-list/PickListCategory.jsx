import React from 'react';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { CheckCheck, Pencil } from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

export default function PickListCategory({ category, items, pickedState, stockMap, onTogglePicked, onQtyChange, onMarkAll, disabled = false, isConfirmed = false, onEditItem = null }) {
  const allPicked = items.every(i => {
    const s = pickedState[i.product.id];
    return s?.picked && s?.qty && Number(s.qty) > 0;
  });

  const checkedCount = items.filter(i => pickedState[i.product.id]?.picked).length;

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden print:break-inside-avoid print:rounded-none print:border-black">
      <div className={cn(
        "px-4 py-3 border-b border-border bg-muted/50 flex items-center gap-2",
        allPicked && "bg-green-50 dark:bg-green-900/20"
      )}>
        <h3 className="text-sm font-bold">{category}</h3>
        <Badge variant="secondary" className="text-[10px]">{items.length} items</Badge>
        {allPicked && <Badge className="bg-green-100 text-green-700 text-[10px]">✓ All picked</Badge>}
        {!allPicked && !disabled && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => onMarkAll(items)}
            className="ml-auto gap-1.5 h-7 text-xs print:hidden"
          >
            <CheckCheck className="w-3.5 h-3.5" />
            Mark All ({checkedCount}/{items.length})
          </Button>
        )}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm table-fixed">
          <colgroup>
            <col className="w-14" />
            <col className="w-24" />
            <col />
            <col className="w-28" />
            <col className="w-24" />
            <col className="w-28 print:hidden" />
            <col className="w-16" />
            {onEditItem && <col className="w-12" />}
          </colgroup>
          <thead>
            <tr className="border-b border-border">
              <th className="text-left px-4 py-2 font-medium text-muted-foreground">Pick</th>
              <th className="text-left px-4 py-2 font-medium text-muted-foreground">SKU</th>
              <th className="text-left px-4 py-2 font-medium text-muted-foreground">Ingredient</th>
              <th className="text-right px-4 py-2 font-medium text-muted-foreground">Needed</th>
              <th className="text-right px-4 py-2 font-medium text-muted-foreground print:hidden">In Stock</th>
              <th className="text-center px-4 py-2 font-medium text-muted-foreground print:hidden">Picked Qty</th>
              <th className="text-left px-4 py-2 font-medium text-muted-foreground">UoM</th>
              {onEditItem && <th className="px-2 py-2 print:hidden"></th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {items.map(item => {
              const pid = item.product.id;
              const state = pickedState[pid] || { picked: false, qty: '' };
              const isComplete = state.picked && state.qty && Number(state.qty) > 0;
              const pickedQty = state.qty ? Number(state.qty) : null;
              const inStock = stockMap?.[pid] ?? null;
              const isBelowNeeded = pickedQty !== null && pickedQty < item.totalQty;
              const isOverPicked = pickedQty !== null && pickedQty > item.totalQty;

              return (
                <tr
                  key={pid}
                  className={cn(
                    "transition-colors print:leading-8",
                    isComplete && !isBelowNeeded && !isOverPicked && "bg-green-50/60 dark:bg-green-900/10",
                    isOverPicked && "bg-blue-50/60 dark:bg-blue-950/10",
                    isBelowNeeded && "bg-red-50/60 dark:bg-red-900/10",
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
                  <td className={cn("px-4 py-2 font-medium truncate", isComplete && !isBelowNeeded && "line-through text-muted-foreground")}>
                    {item.product.name}
                  </td>
                  <td className="px-4 py-2 text-right font-bold tabular-nums">{item.totalQty.toLocaleString()}</td>
                  <td className="px-4 py-2 text-right tabular-nums text-muted-foreground print:hidden">
                    {inStock !== null ? inStock.toLocaleString() : '—'}
                  </td>
                  <td className="px-4 py-2 text-center print:hidden">
                    {isConfirmed && state.picked ? (
                      <div className="text-center">
                        <span className="font-bold tabular-nums text-green-700">{state.qty || item.totalQty}</span>
                        {Number(state.qty) > item.totalQty && (
                          <p className="text-[10px] text-blue-600">
                            +{(Number(state.qty) - item.totalQty).toFixed(2)} over
                          </p>
                        )}
                      </div>
                    ) : state.picked && !disabled ? (
                      <div className="space-y-1">
                        <Input
                          type="number"
                          min="0"
                          step="any"
                          value={state.qty}
                          placeholder="Enter qty..."
                          onChange={e => {
                            const val = e.target.value;
                            onQtyChange(pid, val);
                          }}
                          className={cn(
                            "w-24 h-9 text-right text-sm mx-auto",
                            state.picked && !state.qty && "border-amber-400 ring-1 ring-amber-300",
                            isBelowNeeded && "border-red-400 ring-1 ring-red-300",
                            isOverPicked && "border-blue-400 ring-1 ring-blue-300"
                          )}
                          autoFocus={state.picked && !state.qty}
                        />
                        {isBelowNeeded && (
                          <p className="text-[10px] text-red-600 font-medium">Below needed — go buy more?</p>
                        )}
                        {isOverPicked && (
                          <p className="text-[10px] text-blue-600 font-medium">
                            Over-pick: +{(pickedQty - item.totalQty).toFixed(2)} {item.uom} surplus
                          </p>
                        )}
                      </div>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-muted-foreground">{item.uom}</td>
                  {onEditItem && (
                    <td className="px-2 py-2 print:hidden">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="w-7 h-7 text-muted-foreground hover:text-primary"
                        onClick={() => onEditItem(item)}
                        title="Edit picked quantity"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </Button>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}