import React from 'react';
import { Badge } from '@/components/ui/badge';
import { TrendingDown, TrendingUp, ChefHat } from 'lucide-react';
import { cn } from '@/lib/utils';

export default function CompletionYieldTable({ lines, actuals }) {
  if (lines.length === 0) return null;

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      <div className="flex items-center gap-2 px-5 py-3 bg-muted/30 border-b border-border">
        <ChefHat className="w-4 h-4 text-muted-foreground" />
        <h3 className="text-sm font-bold">Yield Variance — Meals Produced</h3>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/20">
            <tr>
              <th className="text-left px-4 py-2.5 font-semibold text-xs uppercase text-muted-foreground">Meal</th>
              <th className="text-left px-3 py-2.5 font-semibold text-xs uppercase text-muted-foreground w-20">SKU</th>
              <th className="text-right px-3 py-2.5 font-semibold text-xs uppercase text-muted-foreground w-20">Planned</th>
              <th className="text-right px-3 py-2.5 font-semibold text-xs uppercase text-muted-foreground w-20">Actual</th>
              <th className="text-right px-3 py-2.5 font-semibold text-xs uppercase text-muted-foreground w-20">+/-</th>
              <th className="text-left px-3 py-2.5 font-semibold text-xs uppercase text-muted-foreground">Reason</th>
            </tr>
          </thead>
          <tbody>
            {lines.map(l => {
              const actual = Number(actuals[l.id]) || 0;
              const variance = actual - l.planned_qty;
              return (
                <tr key={l.id} className="border-t border-border">
                  <td className="px-4 py-2.5 font-medium">{l.product_name}</td>
                  <td className="px-3 py-2.5 text-xs text-muted-foreground font-mono">{l.product_sku}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{l.planned_qty}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums font-semibold">{actual}</td>
                  <td className="px-3 py-2.5 text-right">
                    {variance !== 0 ? (
                      <span className={cn("inline-flex items-center gap-1 font-semibold",
                        variance > 0 ? "text-blue-600" : "text-amber-600"
                      )}>
                        {variance > 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                        {variance > 0 ? '+' : ''}{variance}
                      </span>
                    ) : (
                      <span className="text-green-600">✓</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5">
                    {l.variance_reason && l.variance_reason !== 'as_planned' ? (
                      <Badge variant="outline" className="text-[10px]">
                        {l.variance_reason.replace(/_/g, ' ')}
                      </Badge>
                    ) : variance !== 0 ? (
                      <span className="text-[10px] text-amber-600">No reason set</span>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-border bg-muted/30">
              <td colSpan={2} className="px-4 py-2.5 font-bold">Totals</td>
              <td className="px-3 py-2.5 text-right font-bold tabular-nums">
                {lines.reduce((s, l) => s + l.planned_qty, 0)}
              </td>
              <td className="px-3 py-2.5 text-right font-bold tabular-nums">
                {lines.reduce((s, l) => s + (Number(actuals[l.id]) || 0), 0)}
              </td>
              <td className="px-3 py-2.5 text-right font-bold tabular-nums">
                {(() => {
                  const v = lines.reduce((s, l) => s + ((Number(actuals[l.id]) || 0) - l.planned_qty), 0);
                  return <span className={cn(v > 0 && "text-blue-600", v < 0 && "text-amber-600")}>{v > 0 ? '+' : ''}{v}</span>;
                })()}
              </td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}