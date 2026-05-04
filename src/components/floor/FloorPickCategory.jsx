import React, { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';
import { ChevronDown, ChevronUp, CheckCheck } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Mobile-optimised pick list category — reads from PickLine entities.
 * Statuses: not_picked → picked → released.
 */
export default function FloorPickCategory({
  category, pickLines, stockMap,
  onMarkPicked, onUnpick, disabled, confirmed,
}) {
  const [collapsed, setCollapsed] = useState(false);
  // Local qty edits for lines being picked
  const [localQty, setLocalQty] = useState({});

  const releasedAll = pickLines.every(pl => pl.status === 'released');
  const allDone = confirmed || releasedAll;
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
    pickLines.filter(pl => pl.status === 'not_picked').forEach(pl => {
      onMarkPicked(pl.id, localQty[pl.id] || pl.required_qty);
    });
  };

  return (
    <div className="bg-card border border-border rounded-2xl overflow-hidden">
      <button
        onClick={() => setCollapsed(c => !c)}
        className={cn(
          "w-full flex items-center gap-2 px-4 py-3 border-b border-border text-left",
          allDone ? "bg-green-50 dark:bg-green-900/20" : "bg-muted/50",
        )}
      >
        <span className="font-bold text-sm flex-1">{category}</span>
        <Badge variant="secondary" className="text-[10px]">{checkedCount}/{pickLines.length}</Badge>
        {allDone && <Badge className="bg-green-100 text-green-700 text-[10px]">✓ Done</Badge>}
        {collapsed ? <ChevronDown className="w-4 h-4 text-muted-foreground" /> : <ChevronUp className="w-4 h-4 text-muted-foreground" />}
      </button>

      {!collapsed && (
        <div className="divide-y divide-border">
          {/* Mark all button */}
          {!disabled && !confirmed && (
            <button
              onClick={handleMarkAllUnpicked}
              className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-primary hover:bg-muted/30"
            >
              <CheckCheck className="w-4 h-4" />
              <span>Mark All ({checkedCount}/{pickLines.length})</span>
            </button>
          )}

          {pickLines.map(pl => {
            const isReleased = pl.status === 'released';
            const isPicked = pl.status === 'picked';
            const isNotPicked = pl.status === 'not_picked';
            const displayQty = localQty[pl.id] !== undefined ? localQty[pl.id] : (pl.actual_qty_picked || '');
            const pickedQty = Number(displayQty) || 0;
            const isBelowNeeded = isPicked && pickedQty > 0 && pickedQty < pl.required_qty;
            const inStock = stockMap?.[pl.product_id] ?? null;

            return (
              <div
                key={pl.id}
                className={cn(
                  "px-4 py-3 space-y-2",
                  isReleased && "bg-green-50/60 dark:bg-green-900/10",
                  isPicked && !isBelowNeeded && "bg-amber-50/40 dark:bg-amber-900/10",
                  isBelowNeeded && "bg-red-50/60 dark:bg-red-900/10",
                )}
              >
                {/* Row 1: checkbox + name + needed */}
                <div className="flex items-center gap-3">
                  <Checkbox
                    checked={!isNotPicked}
                    onCheckedChange={() => handleCheckboxToggle(pl)}
                    disabled={disabled || isReleased}
                    className="w-7 h-7 shrink-0"
                  />
                  <div className="flex-1 min-w-0">
                    <p className={cn(
                      "font-semibold text-sm truncate",
                      isReleased && "line-through text-muted-foreground",
                    )}>
                      {pl.product_name}
                    </p>
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] font-mono text-muted-foreground">{pl.product_sku}</span>
                      {isReleased && <Badge className="bg-green-100 text-green-700 text-[9px] px-1.5 py-0">Released</Badge>}
                      {isPicked && <Badge className="bg-amber-100 text-amber-700 text-[9px] px-1.5 py-0">Picked</Badge>}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="font-bold tabular-nums text-sm">{pl.required_qty.toLocaleString()}</p>
                    <p className="text-[10px] text-muted-foreground">{pl.required_uom}</p>
                  </div>
                </div>

                {/* Row 2: qty input */}
                {(isPicked || isNotPicked) && !disabled && !isReleased && (
                  <div className="flex items-center gap-3 pl-10">
                    <span className="text-xs text-muted-foreground shrink-0">Picked:</span>
                    <Input
                      type="number" min="0" step="any"
                      value={displayQty}
                      placeholder={String(pl.required_qty)}
                      onChange={e => setLocalQty(prev => ({ ...prev, [pl.id]: e.target.value }))}
                      onBlur={() => handleQtyBlur(pl)}
                      className={cn(
                        "h-12 text-base text-right flex-1 max-w-[140px]",
                        isBelowNeeded && "border-red-400 ring-1 ring-red-300",
                      )}
                    />
                    <span className="text-xs text-muted-foreground">{pl.required_uom}</span>
                    {inStock !== null && (
                      <span className="text-[10px] text-muted-foreground ml-auto">
                        Stock: {inStock.toLocaleString()}
                      </span>
                    )}
                  </div>
                )}

                {/* Released qty display */}
                {isReleased && (
                  <div className="flex items-center gap-3 pl-10">
                    <span className="text-xs text-muted-foreground">Released:</span>
                    <span className="font-bold tabular-nums text-green-700">{pl.actual_qty_picked || pl.required_qty} {pl.required_uom}</span>
                  </div>
                )}

                {isBelowNeeded && (
                  <p className="text-[11px] text-red-600 font-medium pl-10">Below needed — go buy more!</p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}