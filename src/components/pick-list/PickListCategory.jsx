import React, { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { CheckCheck, Pencil, Send } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Renders a pick category group, reading from PickLine entities.
 * Statuses: not_picked → picked → released.
 */
export default function PickListCategory({
  category, pickLines, stockMap, onMarkPicked, onUnpick, onMarkAll,
  disabled = false, isCompleted = false, onEditLine = null,
}) {
  // Local qty edits for lines being picked (not yet saved)
  const [localQty, setLocalQty] = useState({});

  const allDone = pickLines.every(pl => pl.status === 'picked' || pl.status === 'released');
  const releasedAll = pickLines.every(pl => pl.status === 'released');
  const checkedCount = pickLines.filter(pl => pl.status !== 'not_picked').length;

  const handleCheckboxToggle = (pl) => {
    if (pl.status === 'not_picked') {
      const qty = localQty[pl.id] || pl.required_qty;
      onMarkPicked(pl.id, qty);
    } else if (pl.status === 'picked') {
      onUnpick(pl.id);
    }
  };

  const handleQtyBlur = (pl) => {
    const qty = localQty[pl.id];
    if (qty !== undefined && pl.status === 'picked') {
      onMarkPicked(pl.id, Number(qty));
    }
  };

  const handleMarkAllUnpicked = () => {
    const unpicked = pickLines.filter(pl => pl.status === 'not_picked');
    if (unpicked.length === 0) return;
    // Build batch array and send to parent for single optimistic update
    const batch = unpicked.map(pl => ({ id: pl.id, qty: localQty[pl.id] || pl.required_qty }));
    if (onMarkAll) {
      onMarkAll(batch);
    } else {
      // Fallback: individual calls
      batch.forEach(({ id, qty }) => onMarkPicked(id, qty));
    }
  };

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden print:break-inside-avoid">
      <div className={cn(
        "px-4 py-3 border-b border-border bg-muted/50 flex items-center gap-2",
        releasedAll && "bg-green-50 dark:bg-green-900/20",
        allDone && !releasedAll && "bg-amber-50 dark:bg-amber-900/20"
      )}>
        <h3 className="text-sm font-bold">{category}</h3>
        <Badge variant="secondary" className="text-[10px]">{pickLines.length} items</Badge>
        {releasedAll && <Badge className="bg-green-100 text-green-700 text-[10px]">✓ All released</Badge>}
        {allDone && !releasedAll && <Badge className="bg-amber-100 text-amber-700 text-[10px]">All picked</Badge>}
        {!allDone && !disabled && (
          <Button
            variant="outline" size="sm"
            onClick={handleMarkAllUnpicked}
            className="ml-auto gap-1.5 h-7 text-xs print:hidden"
          >
            <CheckCheck className="w-3.5 h-3.5" />
            Mark All ({checkedCount}/{pickLines.length})
          </Button>
        )}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm table-fixed">
          <colgroup>
            <col className="w-14" />
            <col className="w-24" />
            <col />
            <col className="w-20" />
            <col className="w-28" />
            <col className="w-24 print:hidden" />
            <col className="w-28 print:hidden" />
            <col className="w-16" />
            <col className="w-20" />
            {onEditLine && <col className="w-12" />}
          </colgroup>
          <thead>
            <tr className="border-b border-border">
              <th className="text-left px-4 py-2 font-medium text-muted-foreground">Pick</th>
              <th className="text-left px-4 py-2 font-medium text-muted-foreground">SKU</th>
              <th className="text-left px-4 py-2 font-medium text-muted-foreground">Ingredient</th>
              <th className="text-left px-4 py-2 font-medium text-muted-foreground">Location</th>
              <th className="text-right px-4 py-2 font-medium text-muted-foreground">Needed</th>
              <th className="text-right px-4 py-2 font-medium text-muted-foreground print:hidden">In Stock</th>
              <th className="text-center px-4 py-2 font-medium text-muted-foreground print:hidden">Picked Qty</th>
              <th className="text-left px-4 py-2 font-medium text-muted-foreground">UoM</th>
              <th className="text-center px-4 py-2 font-medium text-muted-foreground">Status</th>
              {onEditLine && <th className="px-2 py-2 print:hidden"></th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {pickLines.map(pl => {
              const isReleased = pl.status === 'released';
              const isPicked = pl.status === 'picked';
              const isNotPicked = pl.status === 'not_picked';
              const displayQty = localQty[pl.id] !== undefined ? localQty[pl.id] : (pl.actual_qty_picked || '');
              const pickedQty = Number(displayQty) || 0;
              const isBelowNeeded = isPicked && pickedQty > 0 && pickedQty < pl.required_qty;
              const isOverPicked = isPicked && pickedQty > pl.required_qty;
              const inStock = stockMap?.[pl.product_id] ?? null;

              return (
                <tr
                  key={pl.id}
                  className={cn(
                    "transition-colors",
                    isReleased && "bg-green-50/60 dark:bg-green-900/10",
                    isPicked && !isBelowNeeded && !isOverPicked && "bg-amber-50/40 dark:bg-amber-900/10",
                    isOverPicked && "bg-blue-50/60 dark:bg-blue-950/10",
                    isBelowNeeded && "bg-red-50/60 dark:bg-red-900/10",
                  )}
                >
                  <td className="px-4 py-2">
                    <Checkbox
                      checked={!isNotPicked}
                      onCheckedChange={() => handleCheckboxToggle(pl)}
                      disabled={disabled || isReleased}
                      className="w-6 h-6 print:hidden"
                    />
                    <div className="hidden print:block w-5 h-5 border-2 border-black rounded" />
                  </td>
                  <td className="px-4 py-2 font-mono text-xs text-muted-foreground truncate">{pl.product_sku}</td>
                  <td className={cn("px-4 py-2 font-medium truncate", isReleased && "line-through text-muted-foreground")}>
                    {pl.product_name}
                  </td>
                  <td className="px-4 py-2 text-xs text-muted-foreground truncate">
                    {pl.from_location_name || '—'}
                  </td>
                  <td className="px-4 py-2 text-right font-bold tabular-nums">{pl.required_qty.toLocaleString()}</td>
                  <td className="px-4 py-2 text-right tabular-nums text-muted-foreground print:hidden">
                    {inStock !== null ? inStock.toLocaleString() : '—'}
                  </td>
                  <td className="px-4 py-2 text-center print:hidden">
                    {isReleased ? (
                      <span className="font-bold tabular-nums text-green-700">{pl.actual_qty_picked || pl.required_qty}</span>
                    ) : isPicked && !disabled ? (
                      <div className="space-y-1">
                        <Input
                          type="number" min="0" step="any"
                          value={displayQty}
                          onChange={e => setLocalQty(prev => ({ ...prev, [pl.id]: e.target.value }))}
                          onBlur={() => handleQtyBlur(pl)}
                          className={cn(
                            "w-24 h-9 text-right text-sm mx-auto",
                            isBelowNeeded && "border-red-400 ring-1 ring-red-300",
                            isOverPicked && "border-blue-400 ring-1 ring-blue-300"
                          )}
                        />
                        {isBelowNeeded && <p className="text-[10px] text-red-600 font-medium">Below needed</p>}
                        {isOverPicked && <p className="text-[10px] text-blue-600 font-medium">Over-pick: +{(pickedQty - pl.required_qty).toFixed(2)}</p>}
                      </div>
                    ) : isNotPicked && !disabled ? (
                      <Input
                        type="number" min="0" step="any"
                        value={localQty[pl.id] || ''}
                        placeholder={String(pl.required_qty)}
                        onChange={e => setLocalQty(prev => ({ ...prev, [pl.id]: e.target.value }))}
                        className="w-24 h-9 text-right text-sm mx-auto"
                      />
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-muted-foreground">{pl.required_uom}</td>
                  <td className="px-4 py-2 text-center">
                    {isReleased && <Badge className="bg-green-100 text-green-700 text-[10px]">Released</Badge>}
                    {isPicked && <Badge className="bg-amber-100 text-amber-700 text-[10px]">Picked</Badge>}
                    {isNotPicked && <Badge variant="secondary" className="text-[10px]">Pending</Badge>}
                  </td>
                  {onEditLine && (
                    <td className="px-2 py-2 print:hidden">
                      {isReleased && (
                        <Button
                          variant="ghost" size="icon"
                          className="w-7 h-7 text-muted-foreground hover:text-primary"
                          onClick={() => onEditLine(pl)}
                          title="Edit released quantity"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </Button>
                      )}
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