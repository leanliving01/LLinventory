import React, { useMemo, useState } from 'react';
import { cn } from '@/lib/utils';
import { groupMealsForProduction, VARIANT_INFO } from '@/lib/productionGrouping';
import { resolveSubcategory, makeSubcategorySorter } from '@/lib/productClassification';

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

// Pull the selected metric off a product's stock row. Available is derived the same
// way the plan derives it (on hand − committed) so every surface agrees.
function metricValue(product, metric, stockByProduct) {
  if (!product) return null;
  const stock = stockByProduct[product.id];
  if (!stock) return 0;
  if (metric === 'available') return (stock.on_hand || 0) - (stock.committed || 0);
  return stock[metric] || 0;
}

/**
 * Excel-style stock views for the Inventory Overview, matching the ops spreadsheets:
 *   1. Meals × Package matrix (MWL / MLM / WLM / WWL) — the 15 repeating meals.
 *   2. Low Carb — single-column SKU / Meals / value table.
 *   3. Winter Range — single-column SKU / Meals / value table.
 * One metric toggle (On Hand / Available / Committed) drives all three. Values come
 * from the same source as the Production Plan (stockByProduct), so the numbers always
 * agree with what the plan shows for each meal.
 *
 * @param products        active products (parent's inv-overview list); filtered to finished_meal here
 * @param stockByProduct  { [product_id]: { on_hand, committed, available } } from useStockLevels
 * @param search          optional search string (filters rows by name/SKU/number)
 */
export default function PackageStockGrid({ products = [], stockByProduct = {}, search = '' }) {
  const [metric, setMetric] = useState('on_hand');
  const s = search.trim().toLowerCase();

  const finishedMeals = useMemo(
    () => products.filter(p => p.type === 'finished_meal' && p.status === 'active'),
    [products]
  );

  // Matrix rows: one row per meal number with a product per package column.
  const matrixRows = useMemo(() => {
    const { goalRows } = groupMealsForProduction(finishedMeals);
    return goalRows; // [{ mealNumber, baseName, variants }]
  }, [finishedMeals]);

  const filteredMatrixRows = useMemo(() => {
    if (!s) return matrixRows;
    return matrixRows.filter(r =>
      (r.baseName || '').toLowerCase().includes(s) || String(r.mealNumber).includes(s)
    );
  }, [matrixRows, s]);

  // Product ids already shown in the 15×4 matrix — excluded from the range tables
  // below so a goal meal never appears twice.
  const matrixIds = useMemo(() => {
    const set = new Set();
    matrixRows.forEach(r => PACKAGE_COLS.forEach(c => { if (r.variants[c]) set.add(r.variants[c].id); }));
    return set;
  }, [matrixRows]);

  // Every OTHER meal range gets its own single-column SKU/Meals/value table,
  // data-driven off the resolved subcategory (the app-wide source of truth). Low
  // Carb + Winter Warmer today; any new range added in the catalog appears here
  // automatically. Ordered by the canonical subcategory order (Other pushed last).
  const rangeTables = useMemo(() => {
    const buckets = {};
    for (const p of finishedMeals) {
      if (matrixIds.has(p.id)) continue; // already in the standard matrix
      const sub = resolveSubcategory(p) || 'Other Meals';
      (buckets[sub] ||= []).push(p);
    }
    const sorter = makeSubcategorySorter('finished_meal');
    return Object.keys(buckets).sort(sorter).map(name => ({
      subcat: name,
      title: name,
      rows: buckets[name]
        .slice()
        .sort((a, b) => (a.sku || '').localeCompare(b.sku || '', undefined, { numeric: true })),
    }));
  }, [finishedMeals, matrixIds]);

  // Column totals + grand total for the matrix, over the visible rows.
  const { colTotals, grandTotal } = useMemo(() => {
    const totals = Object.fromEntries(PACKAGE_COLS.map(c => [c, 0]));
    let grand = 0;
    filteredMatrixRows.forEach(row => {
      PACKAGE_COLS.forEach(code => {
        const v = metricValue(row.variants[code], metric, stockByProduct) || 0;
        totals[code] += v;
        grand += v;
      });
    });
    return { colTotals: totals, grandTotal: grand };
  }, [filteredMatrixRows, metric, stockByProduct]);

  const metricLabel = METRICS.find(m => m.key === metric)?.label || '';

  return (
    <div className="space-y-6">
      {/* Metric toggle — shared across all three tables */}
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
          Same values as the Production Plan
        </span>
      </div>

      {/* 1 — Standard packages matrix (15 meals × 4 packages) */}
      <div>
        <h3 className="text-sm font-semibold text-foreground mb-2">Standard Packages</h3>
        <div className="bg-card border border-border rounded-xl overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b border-border">
                <th className="w-10 px-2 py-3 bg-muted/50 border-r border-border" />
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
              {filteredMatrixRows.map((row, idx) => (
                <tr key={row.mealNumber} className="hover:bg-muted/30 transition-colors">
                  <td className="px-2 py-2.5 text-center text-xs font-semibold text-muted-foreground bg-muted/30 border-r border-border tabular-nums">
                    {idx + 1}
                  </td>
                  <td className="px-4 py-2.5 text-sm font-medium border-r border-border">
                    {row.baseName}
                  </td>
                  {PACKAGE_COLS.map(code => {
                    const v = metricValue(row.variants[code], metric, stockByProduct);
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
              {filteredMatrixRows.length === 0 && (
                <tr>
                  <td colSpan={2 + PACKAGE_COLS.length} className="px-4 py-8 text-center text-sm text-muted-foreground">
                    No meals match your search.
                  </td>
                </tr>
              )}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-border bg-muted/50 font-semibold">
                <td className="px-2 py-3 border-r border-border" />
                <td className="px-4 py-3 text-sm border-r border-border">Totals</td>
                {PACKAGE_COLS.map(code => (
                  <td key={code} className="px-4 py-3 text-sm text-center tabular-nums">
                    {fmt(colTotals[code])}
                  </td>
                ))}
              </tr>
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

      {/* Every other meal range — one table each, data-driven (Low Carb, Winter
          Warmer, and anything added in the catalog later). */}
      {rangeTables.map(({ subcat, title, rows }) => (
        <RangeTable
          key={subcat}
          title={title}
          rows={rows}
          metric={metric}
          metricLabel={metricLabel}
          stockByProduct={stockByProduct}
          search={s}
        />
      ))}
    </div>
  );
}

/** Single-package range table: SKU | Meals | <metric> with a GRANDTOTAL row. */
function RangeTable({ title, rows, metric, metricLabel, stockByProduct, search }) {
  const visible = useMemo(() => {
    if (!search) return rows;
    return rows.filter(p =>
      (p.sku || '').toLowerCase().includes(search) || (p.name || '').toLowerCase().includes(search)
    );
  }, [rows, search]);

  const grandTotal = useMemo(
    () => visible.reduce((sum, p) => sum + (metricValue(p, metric, stockByProduct) || 0), 0),
    [visible, metric, stockByProduct]
  );

  return (
    <div>
      <h3 className="text-sm font-semibold text-foreground mb-2">{title}</h3>
      <div className="bg-card border border-border rounded-xl overflow-x-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b border-border">
              <th className="text-center px-4 py-3 text-xs font-semibold text-muted-foreground uppercase bg-muted/50 border-r border-border w-32">
                SKU
              </th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase bg-muted/50 border-r border-border">
                Meals
              </th>
              <th className="text-center px-4 py-3 text-xs font-semibold text-muted-foreground uppercase bg-amber-400 text-amber-950 w-40">
                {metricLabel}
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {visible.map(p => {
              const v = metricValue(p, metric, stockByProduct);
              const negative = typeof v === 'number' && v < 0;
              return (
                <tr key={p.id} className="hover:bg-muted/30 transition-colors">
                  <td className="px-4 py-2.5 text-sm font-mono font-medium text-center border-r border-border">{p.sku}</td>
                  <td className="px-4 py-2.5 text-sm border-r border-border">{p.name}</td>
                  <td className={cn('px-4 py-2.5 text-sm text-center tabular-nums', negative ? 'text-red-600 font-medium' : 'text-foreground')}>
                    {fmt(v)}
                  </td>
                </tr>
              );
            })}
            {visible.length === 0 && (
              <tr>
                <td colSpan={3} className="px-4 py-8 text-center text-sm text-muted-foreground">
                  No meals match your search.
                </td>
              </tr>
            )}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-border bg-muted font-bold">
              <td className="px-4 py-3 border-r border-border" />
              <td className="px-4 py-3 text-sm text-right border-r border-border">GRANDTOTAL</td>
              <td className="px-4 py-3 text-sm text-center tabular-nums">{fmt(grandTotal)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
