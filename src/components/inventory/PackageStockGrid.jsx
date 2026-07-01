import React, { useMemo, useState } from 'react';
import { cn } from '@/lib/utils';
import { groupMealsForProduction, VARIANT_INFO } from '@/lib/productionGrouping';

// The four standard packages, in the same column order as the production plan
// and the ops spreadsheet: MWL (blue) → MLM (green) → WLM (orange) → WWL (pink).
const PACKAGE_COLS = ['MWL', 'MLM', 'WLM', 'WWL'];

// The three views this grid can show. Every cell is filled with the SAME value
// the Production Plan uses (production_stock_levels RPC via useStockLevels):
//   • on_hand   — qty physically on hand
//   • available — on hand − committed  (what the plan calls "Available")
//   • committed — reserved by paid-unfulfilled orders (live pack-BOM decomposition)
const METRICS = [
  { key: 'on_hand', label: 'On Hand' },
  { key: 'available', label: 'Available' },
  { key: 'committed', label: 'Committed' },
];

const fmt = (n) =>
  (Number(n) || 0).toLocaleString('en-ZA', { maximumFractionDigits: 2 });

/**
 * Excel-style Meals × Package matrix (MWL / MLM / WLM / WWL) for the four standard
 * packages that share the same 15 repetitive meals. One value per cell, switchable
 * between On Hand / Available / Committed via the metric toggle. Values are pulled
 * from the exact same source as the Production Plan (stockByProduct), so the numbers
 * always agree with what the plan shows for each meal.
 *
 * @param products        active products (parent's inv-overview list); filtered to finished_meal here
 * @param stockByProduct  { [product_id]: { on_hand, committed, available } } from useStockLevels
 * @param search          optional search string (filters meal rows by name/number)
 */
export default function PackageStockGrid({ products = [], stockByProduct = {}, search = '' }) {
  const [metric, setMetric] = useState('on_hand');

  // Build the meal rows exactly like the production table: one row per meal number
  // with a product per package column (variants: { MWL, MLM, WLM, WWL }).
  const rows = useMemo(() => {
    const finishedMeals = products.filter(p => p.type === 'finished_meal' && p.status === 'active');
    const { goalRows } = groupMealsForProduction(finishedMeals);
    return goalRows; // [{ mealNumber, baseName, variants }]
  }, [products]);

  const filteredRows = useMemo(() => {
    const s = search.trim().toLowerCase();
    if (!s) return rows;
    return rows.filter(r =>
      (r.baseName || '').toLowerCase().includes(s) ||
      String(r.mealNumber).includes(s)
    );
  }, [rows, search]);

  // Pull the selected metric for one package cell.
  const cellValue = (product) => {
    if (!product) return null;
    const stock = stockByProduct[product.id];
    if (!stock) return 0;
    if (metric === 'available') return (stock.on_hand || 0) - (stock.committed || 0);
    return stock[metric] || 0;
  };

  // Column totals + grand total over the visible rows.
  const { colTotals, grandTotal } = useMemo(() => {
    const totals = Object.fromEntries(PACKAGE_COLS.map(c => [c, 0]));
    let grand = 0;
    filteredRows.forEach(row => {
      PACKAGE_COLS.forEach(code => {
        const v = cellValue(row.variants[code]) || 0;
        totals[code] += v;
        grand += v;
      });
    });
    return { colTotals: totals, grandTotal: grand };
  }, [filteredRows, metric, stockByProduct]);

  return (
    <div className="space-y-3">
      {/* Metric toggle */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Show</span>
        <div className="inline-flex rounded-lg border border-border bg-card p-0.5">
          {METRICS.map(m => (
            <button
              key={m.key}
              onClick={() => setMetric(m.key)}
              className={cn(
                'px-4 py-1.5 text-sm font-medium rounded-md transition-all',
                metric === m.key
                  ? 'bg-primary text-primary-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              {m.label}
            </button>
          ))}
        </div>
        <span className="text-xs text-muted-foreground ml-1">
          Same values as the Production Plan · 4 standard packages
        </span>
      </div>

      {/* Matrix */}
      <div className="bg-card border border-border rounded-xl overflow-x-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b border-border">
              <th className="w-10 px-2 py-3 text-xs font-semibold text-muted-foreground bg-muted/50 border-r border-border" />
              <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase bg-muted/50 border-r border-border">
                Meals
              </th>
              {PACKAGE_COLS.map(code => {
                const info = VARIANT_INFO[code];
                return (
                  <th
                    key={code}
                    className={cn('text-center px-4 py-3 text-sm font-bold text-white', info.bg)}
                    title={info.fullLabel}
                  >
                    {code}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {filteredRows.map((row, idx) => (
              <tr key={row.mealNumber} className="hover:bg-muted/30 transition-colors">
                <td className="px-2 py-2.5 text-center text-xs font-semibold text-muted-foreground bg-muted/30 border-r border-border tabular-nums">
                  {idx + 1}
                </td>
                <td className="px-4 py-2.5 text-sm font-medium border-r border-border">
                  {row.baseName}
                </td>
                {PACKAGE_COLS.map(code => {
                  const v = cellValue(row.variants[code]);
                  const missing = !row.variants[code];
                  const negative = typeof v === 'number' && v < 0;
                  return (
                    <td
                      key={code}
                      className={cn(
                        'px-4 py-2.5 text-sm text-center tabular-nums',
                        missing ? 'text-muted-foreground/40' : negative ? 'text-red-600 font-medium' : 'text-foreground'
                      )}
                    >
                      {missing ? '—' : fmt(v)}
                    </td>
                  );
                })}
              </tr>
            ))}
            {filteredRows.length === 0 && (
              <tr>
                <td colSpan={2 + PACKAGE_COLS.length} className="px-4 py-8 text-center text-sm text-muted-foreground">
                  No meals match your search.
                </td>
              </tr>
            )}
          </tbody>
          <tfoot>
            {/* Per-package totals */}
            <tr className="border-t-2 border-border bg-muted/50 font-semibold">
              <td className="px-2 py-3 border-r border-border" />
              <td className="px-4 py-3 text-sm border-r border-border">Totals</td>
              {PACKAGE_COLS.map(code => (
                <td key={code} className="px-4 py-3 text-sm text-center tabular-nums">
                  {fmt(colTotals[code])}
                </td>
              ))}
            </tr>
            {/* Grand total */}
            <tr className="bg-muted font-bold">
              <td className="px-2 py-3 border-r border-border" />
              <td className="px-4 py-3 text-sm border-r border-border">GRANDTOTAL</td>
              <td colSpan={PACKAGE_COLS.length} className="px-4 py-3 text-sm text-right tabular-nums">
                {fmt(grandTotal)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}