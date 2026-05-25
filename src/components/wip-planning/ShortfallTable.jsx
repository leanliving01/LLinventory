import React from 'react';
import { Badge } from '@/components/ui/badge';
import { AlertTriangle, CheckCircle2 } from 'lucide-react';

/**
 * Displays the WIP requirement vs available analysis with shortfalls highlighted.
 */
export default function ShortfallTable({ rows }) {
  if (rows.length === 0) return null;

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      <div className="bg-muted/50 px-4 py-2.5 border-b border-border">
        <h3 className="text-xs font-semibold uppercase text-muted-foreground">
          Bulk Product Requirements — Post QC
        </h3>
      </div>
      <table className="w-full">
        <thead>
          <tr className="border-b border-border">
            <th className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase">Bulk Product</th>
            <th className="text-right px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase">Available</th>
            <th className="text-right px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase">Required</th>
            <th className="text-right px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase">Net</th>
            <th className="text-center px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase">Status</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map(r => (
            <tr key={r.id} className={r.needsCooking ? 'bg-red-50/50 dark:bg-red-950/10' : ''}>
              <td className="px-4 py-2.5">
                <p className="text-sm font-medium">{r.name}</p>
                <p className="text-[10px] font-mono text-muted-foreground">{r.sku}</p>
              </td>
              <td className="px-4 py-2.5 text-sm text-right tabular-nums font-medium">{r.availableKg.toFixed(1)} kg</td>
              <td className="px-4 py-2.5 text-sm text-right tabular-nums">{r.requiredKg.toFixed(1)} kg</td>
              <td className={`px-4 py-2.5 text-sm text-right tabular-nums font-bold ${r.netKg < 0 ? 'text-red-600' : 'text-green-600'}`}>
                {r.netKg >= 0 ? '+' : ''}{r.netKg.toFixed(1)}
              </td>
              <td className="px-4 py-2.5 text-center">
                {r.needsCooking ? (
                  <Badge className="bg-red-100 text-red-700 text-[10px] gap-1">
                    <AlertTriangle className="w-3 h-3" /> Cook {r.cookingNeededKg.toFixed(1)} kg
                  </Badge>
                ) : (
                  <Badge className="bg-green-100 text-green-700 text-[10px] gap-1">
                    <CheckCircle2 className="w-3 h-3" /> OK
                  </Badge>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}