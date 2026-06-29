import React, { useMemo } from 'react';
import { formatZAR } from '@/lib/utils';
import { cn } from '@/lib/utils';
import TruncatedCell from '@/components/ui/TruncatedCell';
import { CATEGORY_LABELS, CATEGORY_ORDER, CATEGORY_HEADER_BG, getSubcategoryColor, resolveSubcategory, hexToRgba, makeSubcategorySorter } from '@/lib/productClassification';
import { compareNatural } from '@/lib/naturalSort';
import { useSubcategories } from '@/lib/useSubcategories';

const fmtQty = (n) => {
  const v = Number(n) || 0;
  return Number.isInteger(v) ? String(v) : v.toFixed(2).replace(/\.?0+$/, '');
};

export default function StockCountVarianceTable({
  rows,
  products = [],
  selectable = false, selected, onToggle, onToggleAll,
  showPrev = false, showConversion = false, showLocation = false,
}) {
  // Hooks must be called unconditionally — before any early returns.
  const { getSubcategoryHex } = useSubcategories();
  const productById = useMemo(
    () => Object.fromEntries(products.map(p => [p.id, p])),
    [products]
  );

  // Group rows: category → subcategory → rows[]
  const grouped = useMemo(() => {
    const cats = {};
    for (const row of rows) {
      const product = productById[row.product_id];
      const cat = product?.type || '__unknown__';
      const sub = product ? resolveSubcategory(product) : 'Unknown';
      if (!cats[cat]) cats[cat] = {};
      if (!cats[cat][sub]) cats[cat][sub] = [];
      cats[cat][sub].push(row);
    }
    const order = [...CATEGORY_ORDER.filter(c => cats[c]), ...(cats['__unknown__'] ? ['__unknown__'] : [])];
    return { order, cats };
  }, [rows, productById]);

  const colCount =
    9 +
    (selectable ? 1 : 0) +
    (showLocation ? 1 : 0) +
    (showPrev ? 1 : 0) +
    (showConversion ? 1 : 0);

  if (!rows.length) {
    return <p className="text-sm text-muted-foreground py-8 text-center">No lines in this count — there was no stock at the selected location/category when it was created.</p>;
  }

  const allSelected = selectable && rows.every(r => selected?.has(r.id));

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
          {grouped.order.map(cat => {
            const subMap = grouped.cats[cat];
            const catLabel = CATEGORY_LABELS[cat] || cat;
            return Object.entries(subMap)
              .sort(([a], [b]) => makeSubcategorySorter(cat)(a, b))
              .map(([sub, subRows], subIdx) => [
                /* Category header — only on the first subcategory of each category */
                subIdx === 0 && (
                  <tr key={`cat-${cat}`}>
                    <td
                      colSpan={colCount}
                      className={cn(
                        'px-4 py-2 text-xs font-bold uppercase tracking-wider text-gray-900 border-t-2 border-black/10',
                        CATEGORY_HEADER_BG[cat] || 'bg-gray-300'
                      )}
                    >
                      {catLabel}
                    </td>
                  </tr>
                ),
                /* Subcategory header */
                (() => {
                  const subHex = getSubcategoryHex(sub);
                  return (
                    <tr key={`sub-${cat}-${sub}`}>
                      <td
                        colSpan={colCount}
                        className={cn(
                          'px-5 py-1.5 text-xs font-semibold text-gray-900 border-b border-black/10',
                          !subHex && (getSubcategoryColor(sub) || 'bg-gray-100')
                        )}
                        style={subHex ? { backgroundColor: hexToRgba(subHex, 0.18) } : undefined}
                      >
                        {sub}
                      </td>
                    </tr>
                  );
                })(),
                /* Product rows — natural SKU order (MLM1, MLM2 … MLM10, MLM15) */
                ...[...subRows].sort((a, b) => compareNatural(a.product_sku, b.product_sku)).map(r => {
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
                }),
              ]);
          })}
        </tbody>
      </table>
    </div>
  );
}
