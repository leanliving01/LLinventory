import React from 'react';

export default function SkuDemandTable({ demandBySku }) {
  if (!demandBySku || demandBySku.length === 0) return null;

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      <div className="px-6 py-3 border-b border-border bg-muted/30">
        <h3 className="text-sm font-bold uppercase tracking-wide">Demand by SKU (Aggregated)</h3>
      </div>
      <div className="overflow-x-auto max-h-96 overflow-y-auto">
        <table className="w-full border-collapse text-sm">
          <thead className="sticky top-0 bg-card">
            <tr className="border-b border-border">
              <th className="text-left px-4 py-2 text-xs font-semibold text-muted-foreground">SKU</th>
              <th className="text-right px-4 py-2 text-xs font-semibold text-muted-foreground">Total Demand</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {demandBySku.map(d => (
              <tr key={d.sku_id} className="hover:bg-muted/30">
                <td className="px-4 py-2 text-sm">{d.sku_display_name}</td>
                <td className="px-4 py-2 text-sm text-right font-mono font-bold">{d.total}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}