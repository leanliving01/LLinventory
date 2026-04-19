import React from 'react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { PACKAGE_TYPES, PACKAGE_LABELS } from '@/lib/mealGrouping';

function ChangeIndicator({ current, newVal }) {
  if (newVal === '' || newVal === undefined) return null;
  const diff = Number(newVal) - (current || 0);
  if (diff === 0) return <span className="text-[10px] text-muted-foreground ml-1">±0</span>;
  return (
    <span className={cn("text-[10px] font-medium ml-1", diff > 0 ? "text-emerald-600" : "text-red-600")}>
      {diff > 0 ? `+${diff}` : diff}
    </span>
  );
}

export default function StockEntryTable({ mealRows, stockValues, onStockChange }) {
  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr className="bg-muted/50 border-b border-border">
              <th rowSpan={2} className="text-left px-3 py-2 text-xs font-semibold text-muted-foreground uppercase sticky left-0 bg-muted/50 z-10 min-w-[180px]">
                Meal
              </th>
              {PACKAGE_TYPES.map(pt => (
                <th key={pt} colSpan={2} className="text-center px-1 py-2 text-xs font-semibold text-foreground uppercase border-l border-border">
                  {PACKAGE_LABELS[pt]}
                </th>
              ))}
            </tr>
            <tr className="bg-muted/30 border-b border-border">
              {PACKAGE_TYPES.map(pt => (
                <React.Fragment key={pt}>
                  <th className="text-right px-1 py-1.5 text-[10px] text-muted-foreground border-l border-border">Current</th>
                  <th className="text-right px-1 py-1.5 text-[10px] text-muted-foreground">New</th>
                </React.Fragment>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {mealRows.map(row => (
              <tr key={row.mealName} className="hover:bg-muted/30 transition-colors">
                <td className="px-3 py-2 text-sm font-medium sticky left-0 bg-card z-10">
                  {row.mealName}
                </td>
                {PACKAGE_TYPES.map(pt => {
                  const sku = row.skusByType[pt];
                  if (!sku) {
                    return <td key={pt} colSpan={2} className="px-1 py-2 text-center text-muted-foreground text-[10px] border-l border-border">—</td>;
                  }
                  const currentStock = row.stockByType[pt];
                  const newVal = stockValues[sku.id] ?? '';
                  return (
                    <React.Fragment key={pt}>
                      <td className="px-1 py-2 text-right border-l border-border">
                        <span className="text-xs tabular-nums">{currentStock !== undefined ? currentStock : '—'}</span>
                      </td>
                      <td className="px-1 py-2 text-right">
                        <div className="flex items-center justify-end gap-0.5">
                          <Input
                            type="number"
                            min="0"
                            placeholder="..."
                            value={newVal}
                            onChange={e => onStockChange(sku.id, e.target.value)}
                            className="w-14 text-right h-6 text-[11px] px-1"
                          />
                          <ChangeIndicator current={currentStock} newVal={newVal} />
                        </div>
                      </td>
                    </React.Fragment>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}