import React from 'react';
import { Input } from '@/components/ui/input';
import { AlertTriangle, CheckCircle2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { VARIANT_INFO } from '@/lib/productionGrouping';

function Cell({ value, className }) {
  return <span className={cn("text-xs tabular-nums", className)}>{value}</span>;
}

/**
 * Renders a production recommendation table for one family (Goal or Low Carb).
 * Props:
 *   title: section heading
 *   rows: array of { mealNumber, baseName, variants: { MLM: product, MWL: ... } }
 *   variantCodes: ['MLM','MWL','WLM','WWL'] or ['LC']
 *   stockMap: { productId: { qty_on_hand, qty_committed, qty_available } }
 *   overrides: { productId: number }
 *   onOverride: (productId, value) => void
 */
export default function RecommendationTable({ title, rows, variantCodes, stockMap, overrides, onOverride }) {
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
              <th rowSpan={2} className="text-left px-3 py-2 text-xs font-semibold text-muted-foreground uppercase sticky left-0 bg-card z-10 min-w-[200px]">
                Meal
              </th>
              <th rowSpan={2} className="px-1 py-2 w-8 bg-card" />
              {variantCodes.map(code => {
                const info = VARIANT_INFO[code];
                return (
                  <th key={code} colSpan={6} className={cn("text-center px-1 py-2 text-xs font-bold uppercase border-l border-border", info.bg, info.text)}>
                    {info.label}
                  </th>
                );
              })}
            </tr>
            <tr className="bg-muted/30 border-b border-border">
              {variantCodes.map(code => (
                <React.Fragment key={code}>
                  <th className="text-right px-1.5 py-1.5 text-[10px] text-muted-foreground border-l border-border">SOH</th>
                  <th className="text-right px-1.5 py-1.5 text-[10px] text-muted-foreground">COM</th>
                  <th className="text-right px-1.5 py-1.5 text-[10px] text-muted-foreground">AVL</th>
                  <th className="text-right px-1.5 py-1.5 text-[10px] text-muted-foreground">PAR</th>
                  <th className="text-right px-1.5 py-1.5 text-[10px] text-muted-foreground">REC</th>
                  <th className="text-center px-1.5 py-1.5 text-[10px] text-muted-foreground">FINAL</th>
                </React.Fragment>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map(row => {
              const hasAnyBelowPar = variantCodes.some(code => {
                const p = row.variants[code];
                if (!p) return false;
                const par = p.par_level || 0;
                const soh = stockMap[p.id]?.qty_on_hand || 0;
                const committed = stockMap[p.id]?.qty_committed || 0;
                return par > 0 && (soh - committed) < par;
              });

              return (
                <tr key={row.mealNumber} className={cn("hover:bg-muted/30 transition-colors", hasAnyBelowPar && "bg-red-50/30")}>
                  <td className="px-3 py-2 text-sm font-medium sticky left-0 bg-card z-10">
                    {row.baseName}
                  </td>
                  <td className="px-1 py-2 text-center">
                    {hasAnyBelowPar ? (
                      <AlertTriangle className="w-3.5 h-3.5 text-red-500 mx-auto" />
                    ) : (
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 mx-auto" />
                    )}
                  </td>
                  {variantCodes.map(code => {
                    const product = row.variants[code];
                    if (!product) {
                      return <td key={code} colSpan={6} className="px-1 py-2 text-center text-muted-foreground text-[10px] border-l border-border">—</td>;
                    }
                    const soh = stockMap[product.id]?.qty_on_hand || 0;
                    const committed = stockMap[product.id]?.qty_committed || 0;
                    const available = soh - committed;
                    const par = product.par_level || 0;
                    const recommended = Math.max(0, par - available);
                    const finalQty = overrides[product.id] !== undefined ? Number(overrides[product.id]) : recommended;

                    return (
                      <React.Fragment key={code}>
                        <td className="px-1.5 py-2 text-right border-l border-border"><Cell value={soh} /></td>
                        <td className="px-1.5 py-2 text-right">
                          <Cell value={committed || '—'} className={cn(committed > 0 && "text-amber-600 font-medium")} />
                        </td>
                        <td className="px-1.5 py-2 text-right">
                          <Cell value={available} className={cn("font-medium", available < 0 && "text-red-600")} />
                        </td>
                        <td className="px-1.5 py-2 text-right"><Cell value={par || '—'} /></td>
                        <td className="px-1.5 py-2 text-right">
                          <Cell value={recommended > 0 ? recommended : '—'} className="font-semibold" />
                        </td>
                        <td className="px-1.5 py-2 text-center">
                          <Input
                            type="number"
                            min="0"
                            value={overrides[product.id] ?? recommended}
                            onChange={e => onOverride(product.id, e.target.value)}
                            className="w-16 text-right h-7 text-[11px] px-1"
                          />
                        </td>
                      </React.Fragment>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}