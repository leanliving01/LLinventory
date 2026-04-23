import React from 'react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

export default function RunLineTable({ lines, actuals, onActualChange, isEditable }) {
  if (lines.length === 0) {
    return <div className="text-center py-8 text-sm text-muted-foreground">No lines in this run</div>;
  }

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr className="bg-muted/30 border-b border-border">
              <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase">Meal</th>
              <th className="text-left px-3 py-3 text-xs font-semibold text-muted-foreground uppercase w-24">SKU</th>
              <th className="text-right px-3 py-3 text-xs font-semibold text-muted-foreground uppercase w-20">SOH</th>
              <th className="text-right px-3 py-3 text-xs font-semibold text-muted-foreground uppercase w-20">COM</th>
              <th className="text-right px-3 py-3 text-xs font-semibold text-muted-foreground uppercase w-20">PAR</th>
              <th className="text-right px-3 py-3 text-xs font-semibold text-muted-foreground uppercase w-24">Planned</th>
              <th className="text-center px-3 py-3 text-xs font-semibold text-muted-foreground uppercase w-28">Actual</th>
              <th className="text-right px-3 py-3 text-xs font-semibold text-muted-foreground uppercase w-20">Variance</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {lines.map(line => {
              const actual = actuals[line.id];
              const actualNum = actual !== undefined && actual !== '' ? Number(actual) : null;
              const variance = actualNum !== null ? actualNum - line.planned_qty : null;

              return (
                <tr key={line.id} className="hover:bg-muted/30 transition-colors">
                  <td className="px-4 py-3 text-sm font-medium">{line.product_name}</td>
                  <td className="px-3 py-3 text-xs text-muted-foreground font-mono">{line.product_sku}</td>
                  <td className="px-3 py-3 text-right text-xs tabular-nums">{line.soh_at_plan}</td>
                  <td className="px-3 py-3 text-right text-xs tabular-nums text-amber-600">{line.committed_at_plan || '—'}</td>
                  <td className="px-3 py-3 text-right text-xs tabular-nums">{line.par_at_plan || '—'}</td>
                  <td className="px-3 py-3 text-right text-sm font-semibold tabular-nums">{line.planned_qty}</td>
                  <td className="px-3 py-3 text-center">
                    {isEditable ? (
                      <Input
                        type="number"
                        min="0"
                        value={actual ?? ''}
                        placeholder={String(line.planned_qty)}
                        onChange={e => onActualChange(line.id, e.target.value)}
                        className="w-20 text-right h-8 text-sm mx-auto"
                      />
                    ) : (
                      <span className="text-sm font-semibold tabular-nums">{line.actual_qty}</span>
                    )}
                  </td>
                  <td className="px-3 py-3 text-right text-xs tabular-nums">
                    {variance !== null ? (
                      <span className={cn(
                        "font-medium",
                        variance > 0 && "text-green-600",
                        variance < 0 && "text-red-600",
                        variance === 0 && "text-muted-foreground"
                      )}>
                        {variance > 0 ? '+' : ''}{variance}
                      </span>
                    ) : '—'}
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="bg-muted/30 border-t border-border">
              <td colSpan={5} className="px-4 py-3 text-sm font-bold">Totals</td>
              <td className="px-3 py-3 text-right text-sm font-bold tabular-nums">
                {lines.reduce((s, l) => s + l.planned_qty, 0)}
              </td>
              <td className="px-3 py-3 text-center text-sm font-bold tabular-nums">
                {lines.reduce((s, l) => s + (Number(actuals[l.id]) || 0), 0)}
              </td>
              <td className="px-3 py-3 text-right text-sm font-bold tabular-nums">
                {(() => {
                  const totalVariance = lines.reduce((s, l) => {
                    const a = actuals[l.id];
                    if (a === undefined || a === '') return s;
                    return s + (Number(a) - l.planned_qty);
                  }, 0);
                  return (
                    <span className={cn(
                      totalVariance > 0 && "text-green-600",
                      totalVariance < 0 && "text-red-600"
                    )}>
                      {totalVariance > 0 ? '+' : ''}{totalVariance}
                    </span>
                  );
                })()}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}