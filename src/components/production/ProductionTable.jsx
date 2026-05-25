import React from 'react';
import { Input } from '@/components/ui/input';
import { AlertTriangle, CheckCircle2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { PACKAGE_LABELS, PACKAGE_COLORS } from '@/lib/mealGrouping';

function CellValue({ value, className }) {
  return <span className={cn("text-xs tabular-nums", className)}>{value}</span>;
}

export default function ProductionTable({ title, mealRows, packageTypes, overrides, setOverrides }) {
  if (mealRows.length === 0) return null;

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
              <th rowSpan={2} className="text-left px-3 py-2 text-xs font-semibold text-muted-foreground uppercase sticky left-0 bg-card z-10 min-w-[180px]">
                Meal
              </th>
              <th rowSpan={2} className="text-center px-1 py-2 w-8 bg-card" />
              {packageTypes.map(pt => {
                const colors = PACKAGE_COLORS[pt];
                return (
                  <th key={pt} colSpan={6} className={cn("text-center px-1 py-2 text-xs font-bold uppercase border-l border-border", colors.bg, colors.text)}>
                    {PACKAGE_LABELS[pt]}
                  </th>
                );
              })}
            </tr>
            <tr className="bg-muted/30 border-b border-border">
              {packageTypes.map(pt => (
                <React.Fragment key={pt}>
                  <th className="text-right px-1 py-1.5 text-[10px] text-muted-foreground border-l border-border">SOH</th>
                  <th className="text-right px-1 py-1.5 text-[10px] text-muted-foreground">COM</th>
                  <th className="text-right px-1 py-1.5 text-[10px] text-muted-foreground">AVL</th>
                  <th className="text-right px-1 py-1.5 text-[10px] text-muted-foreground">PAR</th>
                  <th className="text-right px-1 py-1.5 text-[10px] text-muted-foreground">REC</th>
                  <th className="text-right px-1 py-1.5 text-[10px] text-muted-foreground">FINAL</th>
                </React.Fragment>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {mealRows.map(row => {
              const hasAnyBelowPar = packageTypes.some(pt => row.dataByType[pt]?.belowPar);
              return (
                <tr key={row.mealName} className={cn("hover:bg-muted/30 transition-colors", hasAnyBelowPar && "bg-red-50/30")}>
                  <td className="px-3 py-2 text-sm font-medium sticky left-0 bg-card z-10">
                    {row.mealName}
                  </td>
                  <td className="px-1 py-2 text-center">
                    {hasAnyBelowPar ? (
                      <AlertTriangle className="w-3.5 h-3.5 text-red-500 mx-auto" />
                    ) : (
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 mx-auto" />
                    )}
                  </td>
                  {packageTypes.map(pt => {
                    const d = row.dataByType[pt];
                    if (!d) {
                      return <td key={pt} colSpan={6} className="px-1 py-2 text-center text-muted-foreground text-[10px] border-l border-border">—</td>;
                    }
                    return (
                      <React.Fragment key={pt}>
                        <td className="px-1 py-2 text-right border-l border-border"><CellValue value={d.soh} /></td>
                        <td className="px-1 py-2 text-right"><CellValue value={d.committed} className="text-amber-600" /></td>
                        <td className="px-1 py-2 text-right">
                          <CellValue value={d.available} className={cn("font-medium", d.available < 0 && "text-red-600")} />
                        </td>
                        <td className="px-1 py-2 text-right"><CellValue value={d.par} /></td>
                        <td className="px-1 py-2 text-right">
                          <CellValue value={d.recommended > 0 ? d.recommended : '—'} className="font-semibold" />
                        </td>
                        <td className="px-1 py-2 text-right">
                          <Input
                            type="number"
                            min="0"
                            value={overrides[d.skuId] ?? d.recommended}
                            onChange={e => setOverrides(prev => ({ ...prev, [d.skuId]: e.target.value }))}
                            className="w-14 text-right h-6 text-[11px] px-1"
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