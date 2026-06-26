import React from 'react';
import { cn } from '@/lib/utils';
import { formatDurationFromSeconds } from '@/lib/taskDuration';

export function perfColor(p) {
  if (p == null) return 'text-muted-foreground';
  if (p >= 100) return 'text-green-600';
  if (p >= 90) return 'text-amber-600';
  return 'text-red-500';
}

export default function PackerPerformanceTable({ rows = [], onSelect }) {
  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      <div className="px-6 py-4 border-b border-border">
        <h3 className="text-sm font-semibold">Packer Performance</h3>
        <p className="text-xs text-muted-foreground mt-0.5">
          Performance % = throughput per active hour vs the team average (100% = average). Click a row for detail.
        </p>
      </div>
      {rows.length === 0 ? (
        <div className="px-6 py-12 text-center text-sm text-muted-foreground">No packed orders in this period</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Packer</th>
                <th className="text-center px-4 py-2.5 font-medium text-muted-foreground">Orders</th>
                <th className="text-center px-4 py-2.5 font-medium text-muted-foreground">Line Items</th>
                <th className="text-center px-4 py-2.5 font-medium text-muted-foreground">Meals</th>
                <th className="text-center px-4 py-2.5 font-medium text-muted-foreground">Supplements</th>
                <th className="text-center px-4 py-2.5 font-medium text-muted-foreground">Avg / Order</th>
                <th className="text-center px-4 py-2.5 font-medium text-muted-foreground">Items / hr</th>
                <th className="text-center px-4 py-2.5 font-medium text-muted-foreground">Performance</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map(r => (
                <tr key={r.member_id} className="hover:bg-muted/30 cursor-pointer" onClick={() => onSelect(r)}>
                  <td className="px-4 py-3 font-medium">{r.name}</td>
                  <td className="px-4 py-3 text-center font-semibold">{r.orders}</td>
                  <td className="px-4 py-3 text-center">{r.items.toLocaleString()}</td>
                  <td className="px-4 py-3 text-center">
                    {r.meals.toLocaleString()}
                    {(r.packageMeals > 0 || r.byoMeals > 0) && (
                      <span className="block text-[10px] text-muted-foreground">{r.packageMeals} pkg · {r.byoMeals} byo</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-center">{r.supplements.toLocaleString()}</td>
                  <td className="px-4 py-3 text-center font-mono text-xs">{formatDurationFromSeconds(r.avgSecPerOrder)}</td>
                  <td className="px-4 py-3 text-center font-mono text-xs">{r.itemsPerHour}</td>
                  <td className="px-4 py-3 text-center">
                    {r.insufficient ? (
                      <span className="text-[11px] text-muted-foreground italic">insufficient data</span>
                    ) : r.perfPct == null ? (
                      <span className="text-muted-foreground">—</span>
                    ) : (
                      <span className={cn('font-bold', perfColor(r.perfPct))}>{r.perfPct}%</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
