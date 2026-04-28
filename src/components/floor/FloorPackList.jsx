import React from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { CheckCircle2, Circle, ScanBarcode } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Shows the list of meal items for an order, with scan-to-pack status.
 */
export default function FloorPackList({ items, scannedMap }) {
  return (
    <div className="space-y-2">
      {items.map(item => {
        const scannedQty = scannedMap[item.meal_sku?.toLowerCase()] || scannedMap[item.meal_sku] || 0;
        const neededQty = item.qty;
        const isDone = scannedQty >= neededQty;

        return (
          <div
            key={item.id}
            className={cn(
              "flex items-center gap-3 px-4 py-3 rounded-2xl border-2 transition-colors",
              isDone
                ? "bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800"
                : "bg-card border-border",
            )}
          >
            {isDone ? (
              <CheckCircle2 className="w-7 h-7 text-green-600 shrink-0" />
            ) : (
              <Circle className="w-7 h-7 text-muted-foreground shrink-0" />
            )}
            <div className="flex-1 min-w-0">
              <p className={cn("font-semibold text-sm truncate", isDone && "line-through text-muted-foreground")}>
                {item.meal_name || item.meal_sku}
              </p>
              <p className="text-[11px] font-mono text-muted-foreground">{item.meal_sku}</p>
            </div>
            <div className="text-right shrink-0">
              <p className="text-lg font-bold tabular-nums">
                <span className={isDone ? "text-green-600" : "text-foreground"}>{scannedQty}</span>
                <span className="text-muted-foreground">/{neededQty}</span>
              </p>
            </div>
          </div>
        );
      })}
    </div>
  );
}