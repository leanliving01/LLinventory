import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Printer, X, Check } from 'lucide-react';
import { formatZAR } from '@/lib/utils';
import { buildFifoCostMap, fifoUnitCost } from '@/lib/fifoValuation';
import { CATEGORY_LABELS, CATEGORY_ORDER } from '@/lib/productClassification';

const BRAND = '#12B76E'; // Lean Living green (hsl(153 82% 40%)) — explicit hex prints reliably
const exact = { WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact' };
// Match formatZAR's locale (af-ZA: space thousands, comma decimal) so qty and money
// read consistently on the same printed report.
const fmtQty = (n) => Number(n || 0).toLocaleString('af-ZA', { minimumFractionDigits: 0, maximumFractionDigits: 2 });

// Columns in display order. `label` kind = left-aligned identity column; `num` kind
// = right-aligned number. `always` columns can't be toggled off (product identity).
const ALL_COLUMNS = [
  { key: 'sku', label: 'SKU', kind: 'label', always: true },
  { key: 'name', label: 'Product', kind: 'label', always: true },
  { key: 'category', label: 'Category', kind: 'label' },
  { key: 'qty', label: 'Qty on Hand', kind: 'num' },
  { key: 'unitCost', label: 'Unit Cost', kind: 'num' },
  { key: 'costValue', label: 'Cost Value', kind: 'num' },
  { key: 'sellPrice', label: 'Selling Price', kind: 'num' },
  { key: 'sellValue', label: 'Selling Value', kind: 'num' },
];
const OPTIONAL_COLUMNS = ALL_COLUMNS.filter(c => !c.always);

/**
 * Professional inventory report, launched from Inventory Overview.
 *
 * Scope is chosen via multi-select category chips (any combination, or All).
 * Per product: FIFO unit cost, selling price, qty on hand, and the resulting
 * cost-value and selling-value. Totals for inventory (cost) value and retail
 * (selling) value. Bank-ready Print/PDF with branded header + footer
 * (print isolation in src/index.css).
 *
 * Props:
 *  - open, onClose
 *  - products: active + inventory_tracked Product rows (passed from the page)
 *  - stockByProduct: { [productId]: { on_hand, committed, available } }
 */
export default function InventoryReportModal({ open, onClose, products = [], stockByProduct = {} }) {
  const [selected, setSelected] = useState([]); // [] = All; else array of product.type
  const [hideZero, setHideZero] = useState(false); // include zero-stock products by default (full listing)
  const [logoOk, setLogoOk] = useState(true); // falls back to the LL badge if the logo asset is missing
  const [cols, setCols] = useState({ category: true, qty: true, unitCost: true, costValue: true, sellPrice: true, sellValue: true });
  const isAll = selected.length === 0;
  const toggleCat = (t) => setSelected(prev => prev.includes(t) ? prev.filter(x => x !== t) : [...prev, t]);
  const toggleCol = (k) => setCols(prev => ({ ...prev, [k]: !prev[k] }));

  // FIFO layers are the authoritative cost basis (cost_avg is a legacy fallback).
  const { data: layers = [], isLoading } = useQuery({
    queryKey: ['inv-report-layers'],
    queryFn: () => base44.entities.CostLayer.filter({ is_depleted: false }, 'received_date', 20000),
    enabled: open,
  });

  // Per-category product counts across ALL tracked products (not just in-stock), so
  // the chip counts match the Inventory Overview (e.g. Finished Meal (74)).
  const { presentCats, countByType } = useMemo(() => {
    const counts = {};
    for (const p of products) {
      if (!p.type) continue;
      counts[p.type] = (counts[p.type] || 0) + 1;
    }
    // Known categories first (business order), then any unmapped type so new enum
    // values are still selectable rather than silently appearing only under "All".
    const known = CATEGORY_ORDER.filter(t => counts[t]);
    const extra = Object.keys(counts).filter(t => !CATEGORY_ORDER.includes(t));
    return { presentCats: [...known, ...extra], countByType: counts };
  }, [products]);

  const rows = useMemo(() => {
    const fifoMap = buildFifoCostMap(layers);
    return products
      .filter(p => isAll || selected.includes(p.type))
      .map(p => {
        const qty = stockByProduct[p.id]?.on_hand || 0;
        const unitCost = fifoUnitCost(fifoMap, p.id, p.cost_avg || 0);
        const sellPrice = p.selling_price ?? p.price ?? 0;
        return {
          id: p.id,
          sku: p.sku,
          name: p.name,
          type: p.type,
          uom: p.stock_uom || 'pcs',
          qty,
          unitCost,
          sellPrice,
          costValue: qty * unitCost,
          sellValue: qty * sellPrice,
        };
      })
      .filter(r => !hideZero || r.qty > 0) // full listing by default; optionally hide zero-stock
      .sort((a, b) => b.costValue - a.costValue);
  }, [products, layers, stockByProduct, selected, isAll, hideZero]);

  const totals = useMemo(() => rows.reduce((t, r) => {
    t.qty += r.qty;
    t.cost += r.costValue;
    t.sell += r.sellValue;
    return t;
  }, { qty: 0, cost: 0, sell: 0 }), [rows]);

  // Per-category breakdown strip (shown whenever the result spans >1 category).
  const byType = useMemo(() => {
    const g = {};
    for (const r of rows) {
      const a = g[r.type] || (g[r.type] = { cost: 0, sell: 0 });
      a.cost += r.costValue;
      a.sell += r.sellValue;
    }
    return CATEGORY_ORDER.filter(t => g[t]).map(t => [t, g[t]]);
  }, [rows]);

  const margin = totals.sell - totals.cost;
  const catLabel = isAll
    ? 'All Categories'
    : selected.map(t => CATEGORY_LABELS[t] || t).join(', ');
  const now = new Date();
  const generatedDate = now.toLocaleDateString('en-ZA', { day: '2-digit', month: 'long', year: 'numeric' });
  const generatedStamp = now.toLocaleString('en-ZA', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

  // Which columns are visible (identity columns always on), and which value totals to show.
  const visibleColumns = ALL_COLUMNS.filter(c => c.always || cols[c.key]);
  const labelColCount = visibleColumns.filter(c => c.kind === 'label').length;
  const numCols = visibleColumns.filter(c => c.kind === 'num');
  const showCost = cols.costValue;
  const showSell = cols.sellValue;
  const showMargin = cols.costValue && cols.sellValue;

  const cellValue = (col, r) => {
    switch (col.key) {
      case 'sku': return r.sku;
      case 'name': return r.name;
      case 'category': return CATEGORY_LABELS[r.type] || r.type;
      case 'qty': return `${fmtQty(r.qty)} ${r.uom}`;
      case 'unitCost': return formatZAR(r.unitCost);
      case 'costValue': return formatZAR(r.costValue);
      case 'sellPrice': return r.sellPrice > 0 ? formatZAR(r.sellPrice) : '—';
      case 'sellValue': return r.sellValue > 0 ? formatZAR(r.sellValue) : '—';
      default: return '';
    }
  };
  const tdClass = (col) => {
    const base = 'px-3 py-2 border-b border-gray-100';
    if (col.key === 'sku') return `${base} text-[10px] font-mono text-gray-400`;
    if (col.key === 'name') return `${base} text-xs font-medium text-gray-900`;
    if (col.key === 'category') return `${base} text-xs text-gray-500`;
    const emphasis = (col.key === 'costValue' || col.key === 'sellValue') ? 'font-semibold text-gray-900' : 'text-gray-700';
    return `${base} text-right text-xs tabular-nums ${emphasis}`;
  };
  const footerTotal = (col) => {
    switch (col.key) {
      case 'qty': return fmtQty(totals.qty);
      case 'costValue': return formatZAR(totals.cost);
      case 'sellValue': return formatZAR(totals.sell);
      default: return '';
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-[95vw] w-[1100px] max-h-[92vh] overflow-y-auto p-0 bg-white">
        {/* ── Controls (not printed) ── */}
        <div className="no-print sticky top-0 z-10 bg-white border-b border-gray-200 px-6 py-3">
          <div className="flex items-center justify-between gap-4">
            <p className="text-xs font-semibold text-gray-700">
              Choose categories to pull — click to include / exclude
            </p>
            <div className="flex items-center gap-3 shrink-0">
              <label className="flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={hideZero}
                  onChange={(e) => setHideZero(e.target.checked)}
                  className="w-3.5 h-3.5 accent-[#12B76E]"
                />
                Hide zero-stock
              </label>
              <Button variant="outline" size="sm" onClick={() => window.print()} className="gap-1.5 h-8 text-xs">
                <Printer className="w-3.5 h-3.5" /> Print / PDF
              </Button>
              <Button variant="ghost" size="sm" onClick={onClose} className="gap-1.5 h-8 text-xs">
                <X className="w-3.5 h-3.5" /> Close
              </Button>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-1.5 mt-2.5">
            <button
              onClick={() => setSelected([])}
              className={`inline-flex items-center gap-1 text-xs px-3 py-1.5 rounded-full font-medium border transition-all ${isAll ? 'text-white border-transparent' : 'bg-white text-gray-600 border-gray-300 hover:border-gray-400'}`}
              style={isAll ? { backgroundColor: BRAND } : undefined}
            >
              {isAll && <Check className="w-3 h-3" />} All Categories
            </button>
            {presentCats.map(t => {
              const on = selected.includes(t);
              return (
                <button
                  key={t}
                  onClick={() => toggleCat(t)}
                  className={`inline-flex items-center gap-1 text-xs px-3 py-1.5 rounded-full font-medium border transition-all ${on ? 'text-white border-transparent' : 'bg-white text-gray-600 border-gray-300 hover:border-gray-400'}`}
                  style={on ? { backgroundColor: BRAND } : undefined}
                >
                  {on && <Check className="w-3 h-3" />} {CATEGORY_LABELS[t] || t} ({countByType[t]})
                </button>
              );
            })}
          </div>
          {/* Column toggles — choose which fields appear on the sheet */}
          <div className="flex flex-wrap items-center gap-1.5 mt-2.5">
            <span className="text-[11px] font-medium text-gray-500 mr-1">Columns:</span>
            {OPTIONAL_COLUMNS.map(c => {
              const on = cols[c.key];
              return (
                <button
                  key={c.key}
                  onClick={() => toggleCol(c.key)}
                  className={`inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-full font-medium border transition-all ${on ? 'text-white border-transparent' : 'bg-white text-gray-500 border-gray-300 hover:border-gray-400'}`}
                  style={on ? { backgroundColor: BRAND } : undefined}
                >
                  {on && <Check className="w-3 h-3" />} {c.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* ── The report itself (printable) ── */}
        <div id="inventory-report-print" className="px-8 py-6 text-gray-900">
          {/* Branded header */}
          <div className="flex items-start justify-between">
            {logoOk ? (
              <div>
                <img
                  src="/lean-living-logo.png"
                  alt="Lean Living"
                  className="h-16 w-auto object-contain"
                  style={exact}
                  onError={() => setLogoOk(false)}
                />
                <p className="text-[11px] uppercase tracking-[0.18em] text-gray-500 mt-2 ml-1">
                  Inventory Valuation Report
                </p>
              </div>
            ) : (
              <div className="flex items-center gap-3.5">
                <div
                  className="w-14 h-14 rounded-xl flex items-center justify-center text-white font-extrabold text-2xl shrink-0"
                  style={{ backgroundColor: BRAND, ...exact }}
                >
                  LL
                </div>
                <div>
                  <h1 className="text-2xl font-extrabold tracking-tight leading-none" style={{ color: BRAND, ...exact }}>
                    Lean Living
                  </h1>
                  <p className="text-[11px] uppercase tracking-[0.18em] text-gray-500 mt-1.5">
                    Inventory Valuation Report
                  </p>
                </div>
              </div>
            )}
            <div className="text-right text-[11px] text-gray-600 leading-5">
              <p><span className="text-gray-400">Generated</span> {generatedDate}</p>
              <p><span className="text-gray-400">Scope</span> {catLabel}</p>
              <p><span className="text-gray-400">Lines</span> {rows.length} product{rows.length === 1 ? '' : 's'}{hideZero ? ' with stock' : ''}</p>
            </div>
          </div>

          {/* Brand divider */}
          <div className="h-[3px] rounded-full mt-4 mb-5" style={{ backgroundColor: BRAND, ...exact }} />

          {/* Totals summary — only the value totals whose columns are shown */}
          {(showCost || showSell) && (
            <>
              <div className="flex flex-wrap gap-3">
                {showCost && (
                  <div className="flex-1 min-w-[200px] rounded-lg border border-gray-200 p-3.5" style={{ backgroundColor: '#f8fafc', ...exact }}>
                    <p className="text-[11px] text-gray-500">Total Inventory (Cost) Value</p>
                    <p className="text-xl font-bold mt-0.5 text-gray-900">{formatZAR(totals.cost)}</p>
                  </div>
                )}
                {showSell && (
                  <div className="flex-1 min-w-[200px] rounded-lg border border-gray-200 p-3.5" style={{ backgroundColor: '#f8fafc', ...exact }}>
                    <p className="text-[11px] text-gray-500">Total Retail (Selling) Value</p>
                    <p className="text-xl font-bold mt-0.5 text-gray-900">{formatZAR(totals.sell)}</p>
                  </div>
                )}
                {showMargin && (
                  <div className="flex-1 min-w-[200px] rounded-lg border p-3.5" style={{ backgroundColor: '#ecfdf5', borderColor: '#a7f3d0', ...exact }}>
                    <p className="text-[11px] text-gray-500">Gross Margin (Retail − Cost)</p>
                    <p className="text-xl font-bold mt-0.5" style={{ color: BRAND, ...exact }}>{formatZAR(margin)}</p>
                  </div>
                )}
              </div>
              <p className="text-[10px] text-gray-400 text-right mt-1.5">All values in ZAR, excluding VAT.</p>
            </>
          )}

          {/* Per-category breakdown (when result spans >1 category and a value column is shown) */}
          {byType.length > 1 && (showCost || showSell) && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-3">
              {byType.map(([t, v]) => (
                <div key={t} className="rounded-lg border border-gray-200 p-2.5" style={{ backgroundColor: '#fbfdfc', ...exact }}>
                  <p className="text-[11px] font-semibold text-gray-800">{CATEGORY_LABELS[t] || t}</p>
                  {showCost && <p className="text-[11px] text-gray-500 mt-0.5">Cost {formatZAR(v.cost)}</p>}
                  {showSell && <p className="text-[11px] text-gray-500">Retail {formatZAR(v.sell)}</p>}
                </div>
              ))}
            </div>
          )}

          {/* Detail table */}
          <div className="rounded-xl border border-gray-200 overflow-hidden mt-4">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="text-[10px] font-semibold text-gray-600 uppercase" style={{ backgroundColor: '#f1f5f9', ...exact }}>
                  {visibleColumns.map(c => (
                    <th key={c.key} className={`px-3 py-2.5 ${c.kind === 'num' ? 'text-right' : 'text-left'}`}>{c.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={r.id} style={i % 2 ? { backgroundColor: '#f8fafc', ...exact } : undefined}>
                    {visibleColumns.map(c => (
                      <td key={c.key} className={tdClass(c)}>{cellValue(c, r)}</td>
                    ))}
                  </tr>
                ))}
                {/* Grand total as the final body row (NOT <tfoot>, which browsers
                    repeat at the bottom of every printed page). */}
                {rows.length > 0 && (
                  <tr className="font-bold text-gray-900" style={{ backgroundColor: '#f1f5f9', ...exact }}>
                    <td className="px-3 py-2.5 text-xs" colSpan={labelColCount}>Total — {catLabel}</td>
                    {numCols.map(c => (
                      <td key={c.key} className="px-3 py-2.5 text-right text-xs tabular-nums">{footerTotal(c)}</td>
                    ))}
                  </tr>
                )}
              </tbody>
            </table>
            {!isLoading && rows.length === 0 && (
              <p className="px-4 py-6 text-sm text-gray-500 text-center">No products in the selected categories</p>
            )}
            {isLoading && (
              <p className="px-4 py-6 text-sm text-gray-500 text-center">Loading cost layers…</p>
            )}
          </div>

          {/* Methodology note — adapts to the shown value columns */}
          <p className="text-[10px] text-gray-400 mt-3 leading-4">
            Figures reflect stock physically on hand at the time of generation.
            {showCost ? ' Inventory is valued at FIFO (first-in, first-out) cost; where a current cost layer is unavailable the latest average cost is used.' : ''}
            {showSell ? ' Retail value uses the current selling price (excl. VAT).' : ''}
            {hideZero ? ' Products with no stock on hand are excluded.' : ' All products in the selected categories are listed, including those with no stock on hand.'}
          </p>

          {/* Branded footer (repeats on each printed page) */}
          <div className="report-print-footer flex items-center justify-between text-[10px] text-gray-500 mt-6 pt-2 border-t border-gray-200">
            <span className="flex items-center gap-1.5">
              <span className="w-4 h-4 rounded flex items-center justify-center text-white font-bold text-[8px]" style={{ backgroundColor: BRAND, ...exact }}>LL</span>
              Lean Living · Inventory Valuation Report
            </span>
            <span>Generated {generatedStamp} · Confidential</span>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
