import React from 'react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { VARIANT_INFO } from '@/lib/productionGrouping';

/**
 * Simplified production table for ad-hoc runs.
 * Shows only meal name + qty input per variant — no SOH/COM/AVL/PAR/REC.
 */
export default function AdHocRunTable({ title, rows, variantCodes, quantities, onQtyChange }) {
  if (rows.length === 0) return null;

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      {title && (
        <div className="px-6 py-3 border-b border-border bg-muted/30">
          <h3 className="text-sm font-bold text-foreground uppercase tracking-wide">{title}</h3>
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b border-border">
              <th className="text-left px-3 py-2 text-xs font-semibold text-muted-foreground uppercase sticky left-0 bg-card z-10 min-w-[200px]">
                Meal
              </th>
              {variantCodes.map(code => {
                const info = VARIANT_INFO[code];
                return (
                  <th key={code} className={cn("text-center px-3 py-2 text-xs font-bold uppercase border-l border-border min-w-[80px]", info.bg, info.text)}>
                    {info.label}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map(row => (
              <tr key={row.mealNumber} className="hover:bg-muted/30 transition-colors">
                <td className="px-3 py-2 text-sm font-medium sticky left-0 bg-card z-10">
                  {row.baseName}
                </td>
                {variantCodes.map(code => {
                  const product = row.variants[code];
                  if (!product) {
                    return (
                      <td key={code} className="px-3 py-2 text-center text-muted-foreground text-[10px] border-l border-border">—</td>
                    );
                  }
                  return (
                    <td key={code} className="px-3 py-2 text-center border-l border-border">
                      <Input
                        type="number"
                        min="0"
                        value={quantities[product.id] ?? ''}
                        onChange={e => onQtyChange(product.id, e.target.value)}
                        placeholder="0"
                        className="w-20 text-right h-8 text-xs mx-auto"
                      />
                    </td>
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