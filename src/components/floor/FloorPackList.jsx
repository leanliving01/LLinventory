import React from 'react';
import { Badge } from '@/components/ui/badge';
import { CheckCircle2, Circle, Package } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Grouped pack list — items grouped by parent package with heading.
 * Props:
 *  - groups: [{ groupKey, label, subtitle, items: [{key, sku, skuLower, name, qty, ...}] }]
 *  - scannedMap: { skuLower: count }
 */
export default function FloorPackList({ groups, scannedMap }) {
  return (
    <div className="space-y-4">
      {groups.map(group => {
        const groupScanned = group.items.reduce((s, i) => s + (scannedMap[i.skuLower] || 0), 0);
        const groupTotal = group.items.reduce((s, i) => s + (i.qty || 0), 0);
        const groupDone = groupScanned >= groupTotal && groupTotal > 0;

        return (
          <div key={group.groupKey} className="space-y-2">
            {/* Group heading */}
            <div className={cn(
              "flex items-center gap-3 px-3 py-2.5 rounded-xl border-2",
              groupDone
                ? "bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800"
                : "bg-muted/50 border-border"
            )}>
              <Package className={cn("w-5 h-5 shrink-0", groupDone ? "text-green-600" : "text-primary")} />
              <div className="flex-1 min-w-0">
                <p className="font-bold text-sm truncate">{group.label}</p>
                {group.subtitle && (
                  <p className="text-[11px] text-muted-foreground">{group.subtitle}</p>
                )}
              </div>
              <Badge className={cn(
                "tabular-nums text-xs shrink-0",
                groupDone ? "bg-green-100 text-green-700" : "bg-blue-100 text-blue-700"
              )}>
                {groupScanned}/{groupTotal}
              </Badge>
            </div>

            {/* Items in this group */}
            {group.items.map(item => {
              const scannedQty = scannedMap[item.skuLower] || 0;
              const isDone = scannedQty >= item.qty;
              return (
                <div
                  key={item.key}
                  className={cn(
                    "flex items-center gap-3 px-4 py-3 rounded-2xl border-2 ml-3 transition-colors",
                    isDone
                      ? "bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800"
                      : "bg-card border-border",
                  )}
                >
                  {isDone ? (
                    <CheckCircle2 className="w-6 h-6 text-green-600 shrink-0" />
                  ) : (
                    <Circle className="w-6 h-6 text-muted-foreground shrink-0" />
                  )}
                  <div className="flex-1 min-w-0">
                    <p className={cn("font-semibold text-sm truncate", isDone && "line-through text-muted-foreground")}>
                      {item.name}
                    </p>
                    <p className="text-[11px] font-mono text-muted-foreground">{item.sku}</p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-lg font-bold tabular-nums">
                      <span className={isDone ? "text-green-600" : "text-foreground"}>{scannedQty}</span>
                      <span className="text-muted-foreground">/{item.qty}</span>
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}