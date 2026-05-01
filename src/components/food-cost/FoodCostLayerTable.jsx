import React from 'react';
import { Badge } from '@/components/ui/badge';

function MarginBadge({ margin }) {
  if (margin === null || margin === undefined) return <span className="text-xs text-muted-foreground">—</span>;
  const color = margin >= 50 ? 'bg-green-100 text-green-700'
    : margin >= 30 ? 'bg-blue-100 text-blue-700'
    : margin >= 15 ? 'bg-amber-100 text-amber-700'
    : 'bg-red-100 text-red-700';
  return <Badge className={`text-[10px] ${color}`}>{margin.toFixed(1)}%</Badge>;
}

export default function FoodCostLayerTable({ title, subtitle, items, showMargin }) {
  const sorted = [...items].sort((a, b) => (b.costAvg || 0) - (a.costAvg || 0));

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      <div className="px-4 py-3 border-b border-border bg-muted/30">
        <h3 className="text-sm font-semibold">{title}</h3>
        {subtitle && <p className="text-[10px] text-muted-foreground mt-0.5">{subtitle}</p>}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-border">
              <th className="text-left px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase">Product</th>
              <th className="text-right px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase">Inputs</th>
              <th className="text-right px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase">Calc. Cost</th>
              <th className="text-right px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase">Current Cost</th>
              {showMargin && (
                <>
                  <th className="text-right px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase">Sell Price</th>
                  <th className="text-center px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase">Margin</th>
                </>
              )}
              <th className="text-left px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase">UoM</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {sorted.slice(0, 50).map(item => {
              const costMatch = Math.abs(item.costAvg - item.calculatedCost) < 0.02;
              return (
                <tr key={item.bomId} className="hover:bg-muted/20">
                  <td className="px-3 py-2">
                    <div className="text-sm font-medium">{item.name}</div>
                    <div className="text-[11px] font-mono text-muted-foreground">{item.sku}</div>
                  </td>
                  <td className="px-3 py-2 text-sm text-right tabular-nums text-muted-foreground">{item.inputCount}</td>
                  <td className="px-3 py-2 text-sm text-right tabular-nums">
                    R {item.calculatedCost.toFixed(2)}
                  </td>
                  <td className={`px-3 py-2 text-sm text-right tabular-nums font-medium ${!costMatch ? 'text-amber-600' : ''}`}>
                    R {item.costAvg.toFixed(2)}
                    {!costMatch && <span className="text-[10px] ml-1">⚠</span>}
                  </td>
                  {showMargin && (
                    <>
                      <td className="px-3 py-2 text-sm text-right tabular-nums">
                        {item.sellable && item.price > 0 ? `R ${item.price.toFixed(2)}` : '—'}
                      </td>
                      <td className="px-3 py-2 text-center">
                        {item.sellable ? <MarginBadge margin={item.margin} /> : <span className="text-[10px] text-muted-foreground">n/a</span>}
                      </td>
                    </>
                  )}
                  <td className="px-3 py-2 text-xs text-muted-foreground">{item.uom || '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {sorted.length > 50 && (
          <div className="px-3 py-2 text-xs text-muted-foreground text-center border-t border-border">
            Showing 50 of {sorted.length} — use search to narrow
          </div>
        )}
        {sorted.length === 0 && (
          <div className="px-3 py-8 text-xs text-muted-foreground text-center">No items in this layer</div>
        )}
      </div>
    </div>
  );
}