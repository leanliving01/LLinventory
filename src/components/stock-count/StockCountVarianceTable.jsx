import React from 'react';
import { formatZAR } from '@/lib/utils';
import TruncatedCell from '@/components/ui/TruncatedCell';

const fmtQty = (n) => {
  const v = Number(n) || 0;
  return Number.isInteger(v) ? String(v) : v.toFixed(3).replace(/\.?0+$/, '');
};

/**
 * Web variance report for a stock count. `rows` come from buildVarianceRows().
 */
export default function StockCountVarianceTable({ rows, selectable = false, selected, onToggle, onToggleAll, showPrev = false, showConversion = false, showLocation = false }) {
  if (!rows.length) {
    return <p className="text-sm text-muted-foreground py-8 text-center">No lines in this count — there was no stock at the selected location/category when it was created.</p>;
  }
  const allSelected = selectable && rows.length > 0 && rows.every(r => selected?.has(r.id));

  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-muted/50 border-b border-border text-[10px] uppercase text-muted-foreground">
            {selectable && (
              <th className="px-3 py-2 w-8">
                <input type="checkbox" checked={allSelected} onChange={onToggleAll} className="rounded" />
              </th>
            )}
            <th className="text-left px-3 py-2 font-semibold min-w-[200px]">Product</th>
            <th className="text-left px-3 py-2 font-semibold min-w-[110px]">SKU</th>
            {showLocation && <th className="text-left px-3 py-2 font-semibold min-w-[120px]">Location</th>}
            <th className="text-right px-3 py-2 font-semibold">System</th>
            {showPrev && <th className="text-right px-3 py-2 font-semibold">Prev Count</th>}
            <th className="text-right px-3 py-2 font-semibold">Counted</th>
            <th className="text-left px-3 py-2 font-semibold">UOM</th>
            {showConversion && <th className="text-right px-3 py-2 font-semibold">Conv. Factor</th>}
            <th className="text-right px-3 py-2 font-semibold">Converted</th>
            <th className="text-right px-3 py-2 font-semibold">Variance</th>
            <th className="text-right px-3 py-2 font-semibold">Unit Cost</th>
            <th className="text-right px-3 py-2 font-semibold">Variance Value</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map(r => {
            const pending = r._variance == null;
            const negative = !pending && r._variance < 0;
            const positive = !pending && r._variance > 0;
            const isSel = selected?.has(r.id);
            const varClass = negative ? 'text-red-600' : positive ? 'text-green-600' : 'text-muted-foreground';
            return (
              <tr key={r.id} className={`hover:bg-muted/20 ${isSel ? 'bg-primary/5' : ''} ${pending ? 'opacity-70' : ''}`}>
                {selectable && (
                  <td className="px-3 py-2">
                    <input type="checkbox" checked={!!isSel} onChange={() => onToggle(r.id)} className="rounded" />
                  </td>
                )}
                <td className="px-3 py-2"><TruncatedCell text={r.product_name} className="font-medium max-w-[260px]" /></td>
                <td className="px-3 py-2"><TruncatedCell text={r.product_sku} className="text-xs font-mono text-muted-foreground max-w-[140px]" /></td>
                {showLocation && <td className="px-3 py-2 text-xs text-muted-foreground">{r.location_name || '—'}</td>}
                <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{fmtQty(r._system)}</td>
                {showPrev && (
                  <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                    {r.previous_counted_qty != null ? fmtQty(r.previous_counted_qty) : '—'}
                    {r.count_attempt > 1 && <span className="text-[10px] ml-1">(#{r.count_attempt})</span>}
                  </td>
                )}
                <td className="px-3 py-2 text-right tabular-nums">
                  {r.counted_qty != null ? fmtQty(r.counted_qty) : <span className="text-muted-foreground italic text-xs">not counted</span>}
                </td>
                <td className="px-3 py-2 text-xs">{r.count_uom || r.stock_uom || '—'}</td>
                {showConversion && (
                  <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                    ×{fmtQty(Number(r.conversion_factor) || 1)}
                  </td>
                )}
                <td className="px-3 py-2 text-right tabular-nums">{r._converted != null ? `${fmtQty(r._converted)} ${r.stock_uom || ''}` : '—'}</td>
                <td className={`px-3 py-2 text-right tabular-nums font-medium ${varClass}`}>
                  {pending ? '—' : `${positive ? '+' : ''}${fmtQty(r._variance)}`}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{formatZAR(r._unitCost)}</td>
                <td className={`px-3 py-2 text-right tabular-nums font-medium ${varClass}`}>
                  {r._varianceValue != null ? formatZAR(r._varianceValue) : '—'}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
