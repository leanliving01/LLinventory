import React, { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';
import { ChevronDown, ChevronUp, CheckCheck, XCircle, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

/**
 * Mobile-optimised pick list category — card-based rows instead of a table.
 */
export default function FloorPickCategory({
  category, items, pickedState, stockMap,
  onTogglePicked, onQtyChange, onMarkAll, disabled, confirmed,
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [showUnmarkConfirm, setShowUnmarkConfirm] = useState(false);
  const checkedCount = confirmed ? items.length : items.filter(i => pickedState[i.product.id]?.picked).length;
  const allChecked = !confirmed && items.length > 0 && items.every(i => pickedState[i.product.id]?.picked);
  const allDone = confirmed || items.every(i => {
    const s = pickedState[i.product.id];
    return s?.picked && s?.qty && Number(s.qty) > 0;
  });

  return (
    <div className="bg-card border border-border rounded-2xl overflow-hidden">
      {/* Header */}
      <button
        onClick={() => setCollapsed(c => !c)}
        className={cn(
          "w-full flex items-center gap-2 px-4 py-3 border-b border-border text-left",
          allDone ? "bg-green-50 dark:bg-green-900/20" : "bg-muted/50",
        )}
      >
        <span className="font-bold text-sm flex-1">{category}</span>
        <Badge variant="secondary" className="text-[10px]">{checkedCount}/{items.length}</Badge>
        {allDone && <Badge className="bg-green-100 text-green-700 text-[10px]">✓ Done</Badge>}
        {collapsed ? <ChevronDown className="w-4 h-4 text-muted-foreground" /> : <ChevronUp className="w-4 h-4 text-muted-foreground" />}
      </button>

      {!collapsed && (
        <div className="divide-y divide-border">
          {/* Mark / Unmark all button */}
          {!disabled && !confirmed && (
            <button
              onClick={() => {
                if (allChecked) {
                  const hasQtyData = items.some(i => pickedState[i.product.id]?.qty);
                  if (hasQtyData) {
                    setShowUnmarkConfirm(true);
                    return;
                  }
                }
                onMarkAll(items, allChecked);
              }}
              className={cn(
                "w-full flex items-center gap-2 px-4 py-2.5 text-sm hover:bg-muted/30",
                allChecked ? "text-orange-600" : "text-primary",
              )}
            >
              {allChecked ? <XCircle className="w-4 h-4" /> : <CheckCheck className="w-4 h-4" />}
              <span>{allChecked ? 'Unmark All' : 'Mark All Checked'}</span>
            </button>
          )}

          {/* Unmark confirmation dialog */}
          {showUnmarkConfirm && (
            <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-6">
              <div className="bg-card rounded-2xl shadow-xl p-6 max-w-sm w-full space-y-4">
                <div className="flex items-center gap-3">
                  <AlertTriangle className="w-6 h-6 text-orange-500 shrink-0" />
                  <h2 className="text-lg font-bold">Are you sure?</h2>
                </div>
                <p className="text-sm text-muted-foreground">
                  This will uncheck all items and clear all picked quantities in this category.
                </p>
                <div className="flex gap-3">
                  <Button
                    variant="outline"
                    className="flex-1 h-12"
                    onClick={() => setShowUnmarkConfirm(false)}
                  >
                    No
                  </Button>
                  <Button
                    className="flex-1 h-12 bg-orange-600 hover:bg-orange-700 text-white"
                    onClick={() => {
                      onMarkAll(items, true);
                      setShowUnmarkConfirm(false);
                    }}
                  >
                    Yes, Unmark All
                  </Button>
                </div>
              </div>
            </div>
          )}

          {items.map(item => {
            const pid = item.product.id;
            const state = confirmed
              ? { picked: true, qty: String(item.totalQty) }
              : (pickedState[pid] || { picked: false, qty: '' });
            const isComplete = confirmed || (state.picked && state.qty && Number(state.qty) > 0);
            const pickedQty = state.qty ? Number(state.qty) : null;
            const isBelowNeeded = pickedQty !== null && pickedQty < item.totalQty;
            const inStock = stockMap?.[pid] ?? null;

            return (
              <div
                key={pid}
                className={cn(
                  "px-4 py-3 space-y-2",
                  isComplete && !isBelowNeeded && "bg-green-50/60 dark:bg-green-900/10",
                  isBelowNeeded && "bg-red-50/60 dark:bg-red-900/10",
                  state.picked && !state.qty && "bg-amber-50/60 dark:bg-amber-900/10",
                )}
              >
                {/* Row 1: checkbox + name + needed */}
                <div className="flex items-center gap-3">
                  <Checkbox
                    checked={state.picked}
                    onCheckedChange={() => onTogglePicked(pid)}
                    disabled={disabled}
                    className="w-7 h-7 shrink-0"
                  />
                  <div className="flex-1 min-w-0">
                    <p className={cn(
                      "font-semibold text-sm truncate",
                      isComplete && !isBelowNeeded && "line-through text-muted-foreground",
                    )}>
                      {item.product.name}
                    </p>
                    <p className="text-[11px] font-mono text-muted-foreground">{item.product.sku}</p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="font-bold tabular-nums text-sm">{item.totalQty.toLocaleString()}</p>
                    <p className="text-[10px] text-muted-foreground">{item.uom}</p>
                  </div>
                </div>

                {/* Row 2: qty input (only when checked) */}
                {state.picked && !disabled && (
                  <div className="flex items-center gap-3 pl-10">
                    <span className="text-xs text-muted-foreground shrink-0">Picked:</span>
                    <Input
                      type="number"
                      min="0"
                      step="any"
                      value={state.qty}
                      placeholder="Enter qty..."
                      onChange={e => onQtyChange(pid, e.target.value)}
                      onBlur={() => {
                        if (pickedQty !== null && pickedQty < item.totalQty) {
                          toast.warning(`Picked ${pickedQty} but need ${item.totalQty} ${item.uom}`);
                        }
                      }}
                      className={cn(
                        "h-12 text-base text-right flex-1 max-w-[140px]",
                        state.picked && !state.qty && "border-amber-400 ring-1 ring-amber-300",
                        isBelowNeeded && "border-red-400 ring-1 ring-red-300",
                      )}
                    />
                    <span className="text-xs text-muted-foreground">{item.uom}</span>
                    {inStock !== null && (
                      <span className="text-[10px] text-muted-foreground ml-auto">
                        Stock: {inStock.toLocaleString()}
                      </span>
                    )}
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