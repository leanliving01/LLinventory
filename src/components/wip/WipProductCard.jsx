import React from 'react';
import { Badge } from '@/components/ui/badge';

/**
 * Summary card for a single bulk product showing total, consumed, and available kg.
 */
export default function WipProductCard({ name, sku, totalKg, originalKg, batchCount, totalValue }) {
  const consumed = Math.max(0, Math.round((originalKg - totalKg) * 10) / 10);
  const pctUsed = originalKg > 0 ? Math.round((consumed / originalKg) * 100) : 0;

  return (
    <div className="bg-card border border-border rounded-lg p-3 space-y-2">
      <div>
        <p className="text-xs font-mono text-muted-foreground">{sku}</p>
        <p className="text-sm font-semibold truncate">{name}</p>
      </div>
      {/* Progress bar: green = available, amber = consumed */}
      <div className="w-full bg-muted rounded-full h-2 overflow-hidden">
        <div
          className="h-full bg-amber-500 rounded-full transition-all"
          style={{ width: `${pctUsed}%` }}
        />
      </div>
      <div className="grid grid-cols-3 gap-1 text-center">
        <div>
          <p className="text-[10px] text-muted-foreground uppercase">Original</p>
          <p className="text-sm font-bold tabular-nums">{originalKg.toFixed(1)}</p>
        </div>
        <div>
          <p className="text-[10px] text-amber-600 uppercase font-semibold">Used</p>
          <p className="text-sm font-bold tabular-nums text-amber-600">{consumed.toFixed(1)}</p>
        </div>
        <div>
          <p className="text-[10px] text-green-600 uppercase font-semibold">Available</p>
          <p className="text-sm font-bold tabular-nums text-green-600">{totalKg.toFixed(1)}</p>
        </div>
      </div>
      <p className="text-[10px] text-muted-foreground text-center">
        {batchCount} batch{batchCount !== 1 ? 'es' : ''} · R {totalValue.toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
      </p>
    </div>
  );
}