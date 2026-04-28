import React, { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Search, TrendingUp, TrendingDown, Minus } from 'lucide-react';

/**
 * Shows per-SKU demand stats: avg weekly, trend direction, recommended par.
 */
export default function SkuDemandTable({ skuStats }) {
  const [search, setSearch] = useState('');

  const filtered = skuStats.filter(s => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return s.sku.toLowerCase().includes(q) || s.name.toLowerCase().includes(q);
  });

  return (
    <div className="bg-card border rounded-xl overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b">
        <h3 className="text-sm font-semibold">SKU Demand Analysis</h3>
        <div className="relative w-56">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <Input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search SKU..."
            className="pl-8 h-8 text-xs"
          />
        </div>
      </div>
      <div className="overflow-auto max-h-[500px]">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-muted/50 z-10">
            <tr className="border-b">
              <th className="text-left px-4 py-2 text-[10px] font-semibold text-muted-foreground uppercase">SKU</th>
              <th className="text-left px-4 py-2 text-[10px] font-semibold text-muted-foreground uppercase">Product</th>
              <th className="text-right px-4 py-2 text-[10px] font-semibold text-muted-foreground uppercase">Total (period)</th>
              <th className="text-right px-4 py-2 text-[10px] font-semibold text-muted-foreground uppercase">Avg / Week</th>
              <th className="text-center px-4 py-2 text-[10px] font-semibold text-muted-foreground uppercase">Trend</th>
              <th className="text-right px-4 py-2 text-[10px] font-semibold text-muted-foreground uppercase">Current Par</th>
              <th className="text-right px-4 py-2 text-[10px] font-semibold text-muted-foreground uppercase">Suggested Par</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {filtered.length === 0 ? (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-muted-foreground text-xs">No SKUs found</td></tr>
            ) : filtered.slice(0, 50).map(s => (
              <tr key={s.sku} className="hover:bg-muted/30">
                <td className="px-4 py-2 font-mono text-xs">{s.sku}</td>
                <td className="px-4 py-2 text-xs truncate max-w-[200px]">{s.name}</td>
                <td className="px-4 py-2 text-right font-medium">{s.totalDemand}</td>
                <td className="px-4 py-2 text-right">{s.avgPerWeek}</td>
                <td className="px-4 py-2 text-center">
                  <TrendBadge trend={s.trend} pct={s.trendPct} />
                </td>
                <td className="px-4 py-2 text-right text-muted-foreground">{s.currentPar || '—'}</td>
                <td className="px-4 py-2 text-right">
                  <span className={s.suggestedPar > (s.currentPar || 0) ? 'text-orange-600 font-semibold' : ''}>
                    {s.suggestedPar}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length > 50 && (
          <p className="text-xs text-muted-foreground text-center py-2">Showing top 50 of {filtered.length}</p>
        )}
      </div>
    </div>
  );
}

function TrendBadge({ trend, pct }) {
  if (trend === 'up') {
    return (
      <Badge className="bg-green-100 text-green-700 text-[10px] gap-0.5">
        <TrendingUp className="w-3 h-3" /> +{pct}%
      </Badge>
    );
  }
  if (trend === 'down') {
    return (
      <Badge className="bg-red-100 text-red-700 text-[10px] gap-0.5">
        <TrendingDown className="w-3 h-3" /> {pct}%
      </Badge>
    );
  }
  return (
    <Badge className="bg-slate-100 text-slate-600 text-[10px] gap-0.5">
      <Minus className="w-3 h-3" /> Stable
    </Badge>
  );
}