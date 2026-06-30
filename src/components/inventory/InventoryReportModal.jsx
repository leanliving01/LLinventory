import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Printer, X } from 'lucide-react';
import { formatZAR } from '@/lib/utils';
import { buildFifoCostMap, fifoUnitCost } from '@/lib/fifoValuation';
import { CATEGORY_LABELS, CATEGORY_ORDER, getCategoryColor } from '@/lib/productClassification';

const fmtQty = (n) => Number(n || 0).toLocaleString('en-ZA', { minimumFractionDigits: 0, maximumFractionDigits: 2 });

/**
 * Professional inventory report, launched from Inventory Overview.
 *
 * Scope is chosen via a category radio (one product type at a time, or "All").
 * Per product: FIFO unit cost, selling price, qty on hand, and the resulting
 * cost-value and selling-value. Totals for inventory (cost) value and retail
 * (selling) value. On-screen + clean Print/PDF (print isolation in src/index.css).
 *
 * Props:
 *  - open, onClose
 *  - products: active + inventory_tracked Product rows (passed from the page)
 *  - stockByProduct: { [productId]: { on_hand, committed, available } }
 */
export default function InventoryReportModal({ open, onClose, products = [], stockByProduct = {} }) {
  const [cat, setCat] = useState('all'); // 'all' | product.type

  // FIFO layers are the authoritative cost basis (cost_avg is a legacy fallback).
  const { data: layers = [], isLoading } = useQuery({
    queryKey: ['inv-report-layers'],
    queryFn: () => base44.entities.CostLayer.filter({ is_depleted: false }, 'received_date', 20000),
    enabled: open,
  });

  // Categories actually present in the loaded products, in business order.
  const presentCats = useMemo(() => {
    const set = new Set(products.map(p => p.type).filter(Boolean));
    return CATEGORY_ORDER.filter(t => set.has(t));
  }, [products]);

  const rows = useMemo(() => {
    const fifoMap = buildFifoCostMap(layers);
    return products
      .filter(p => cat === 'all' || p.type === cat)
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
      .filter(r => r.qty > 0) // stock-value report: only what's on hand
      .sort((a, b) => b.costValue - a.costValue);
  }, [products, layers, stockByProduct, cat]);

  const totals = useMemo(() => rows.reduce((t, r) => {
    t.qty += r.qty;
    t.cost += r.costValue;
    t.sell += r.sellValue;
    return t;
  }, { qty: 0, cost: 0, sell: 0 }), [rows]);

  // Per-category breakdown strip (only meaningful on "All").
  const byType = useMemo(() => {
    if (cat !== 'all') return [];
    const g = {};
    for (const r of rows) {
      const a = g[r.type] || (g[r.type] = { cost: 0, sell: 0 });
      a.cost += r.costValue;
      a.sell += r.sellValue;
    }
    return CATEGORY_ORDER.filter(t => g[t]).map(t => [t, g[t]]);
  }, [rows, cat]);

  const margin = totals.sell - totals.cost;
  const catLabel = cat === 'all' ? 'All Categories' : (CATEGORY_LABELS[cat] || cat);
  const generated = new Date().toLocaleDateString('en-ZA', { day: '2-digit', month: 'long', year: 'numeric' });

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-[95vw] w-[1100px] max-h-[92vh] overflow-y-auto p-0">
        {/* ── Controls (not printed) ── */}
        <div className="no-print sticky top-0 z-10 bg-background border-b border-border px-6 py-3 flex items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              onClick={() => setCat('all')}
              className={`text-xs px-2.5 py-1 rounded-full font-medium transition-all ${cat === 'all' ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:opacity-100 opacity-80'}`}
            >
              All Categories
            </button>
            {presentCats.map(t => (
              <button
                key={t}
                onClick={() => setCat(t)}
                className={`text-xs px-2.5 py-1 rounded-full font-medium transition-all ${getCategoryColor(t)} ${cat === t ? 'ring-2 ring-primary/40' : 'opacity-70 hover:opacity-100'}`}
              >
                {CATEGORY_LABELS[t] || t}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Button variant="outline" size="sm" onClick={() => window.print()} className="gap-1.5 h-8 text-xs">
              <Printer className="w-3.5 h-3.5" /> Print / PDF
            </Button>
            <Button variant="ghost" size="sm" onClick={onClose} className="gap-1.5 h-8 text-xs">
              <X className="w-3.5 h-3.5" /> Close
            </Button>
          </div>
        </div>

        {/* ── The report itself (printable) ── */}
        <div id="inventory-report-print" className="px-6 py-5 space-y-4">
          {/* Header */}
          <div className="flex items-start justify-between border-b border-border pb-3">
            <div>
              <h1 className="text-xl font-bold text-foreground">Lean Living — Inventory Report</h1>
              <p className="text-sm text-muted-foreground mt-0.5">{catLabel}</p>
            </div>
            <div className="text-right text-xs text-muted-foreground">
              <p>Generated {generated}</p>
              <p>{rows.length} product{rows.length === 1 ? '' : 's'} with stock</p>
            </div>
          </div>

          {/* Totals summary */}
          <div className="grid grid-cols-3 gap-3">
            <div className="bg-card rounded-lg border border-border p-3">
              <p className="text-[11px] text-muted-foreground">Total Inventory (Cost) Value</p>
              <p className="text-lg font-bold mt-0.5">{formatZAR(totals.cost)}</p>
            </div>
            <div className="bg-card rounded-lg border border-border p-3">
              <p className="text-[11px] text-muted-foreground">Total Retail (Selling) Value</p>
              <p className="text-lg font-bold mt-0.5">{formatZAR(totals.sell)}</p>
            </div>
            <div className="bg-card rounded-lg border border-border p-3">
              <p className="text-[11px] text-muted-foreground">Gross Margin (Retail − Cost)</p>
              <p className="text-lg font-bold mt-0.5">{formatZAR(margin)}</p>
            </div>
          </div>

          {/* Per-category breakdown (All only) */}
          {byType.length > 1 && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              {byType.map(([t, v]) => (
                <div key={t} className="bg-muted/40 rounded-lg border border-border p-2.5">
                  <p className="text-[11px] font-medium text-foreground">{CATEGORY_LABELS[t] || t}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">Cost {formatZAR(v.cost)}</p>
                  <p className="text-xs text-muted-foreground">Retail {formatZAR(v.sell)}</p>
                </div>
              ))}
            </div>
          )}

          {/* Detail table */}
          <div className="bg-card rounded-xl border border-border overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-muted/50 border-b border-border text-[10px] font-semibold text-muted-foreground uppercase">
                  <th className="text-left px-3 py-2">SKU</th>
                  <th className="text-left px-3 py-2">Product</th>
                  <th className="text-left px-3 py-2 w-28">Category</th>
                  <th className="text-right px-3 py-2 w-24">Qty on Hand</th>
                  <th className="text-right px-3 py-2 w-24">Unit Cost</th>
                  <th className="text-right px-3 py-2 w-28">Cost Value</th>
                  <th className="text-right px-3 py-2 w-24">Selling Price</th>
                  <th className="text-right px-3 py-2 w-28">Selling Value</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map(r => (
                  <tr key={r.id}>
                    <td className="px-3 py-2 text-[10px] font-mono text-muted-foreground">{r.sku}</td>
                    <td className="px-3 py-2 text-xs font-medium">{r.name}</td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">{CATEGORY_LABELS[r.type] || r.type}</td>
                    <td className="px-3 py-2 text-right text-xs">{fmtQty(r.qty)} {r.uom}</td>
                    <td className="px-3 py-2 text-right text-xs">{formatZAR(r.unitCost)}</td>
                    <td className="px-3 py-2 text-right text-xs font-semibold">{formatZAR(r.costValue)}</td>
                    <td className="px-3 py-2 text-right text-xs">{r.sellPrice > 0 ? formatZAR(r.sellPrice) : '—'}</td>
                    <td className="px-3 py-2 text-right text-xs font-semibold">{r.sellValue > 0 ? formatZAR(r.sellValue) : '—'}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-muted/50 border-t-2 border-border font-bold">
                  <td className="px-3 py-2.5 text-xs" colSpan={3}>Total — {catLabel}</td>
                  <td className="px-3 py-2.5 text-right text-xs">{fmtQty(totals.qty)}</td>
                  <td className="px-3 py-2.5" />
                  <td className="px-3 py-2.5 text-right text-xs">{formatZAR(totals.cost)}</td>
                  <td className="px-3 py-2.5" />
                  <td className="px-3 py-2.5 text-right text-xs">{formatZAR(totals.sell)}</td>
                </tr>
              </tfoot>
            </table>
            {!isLoading && rows.length === 0 && (
              <p className="px-4 py-6 text-sm text-muted-foreground text-center">No stock on hand for this category</p>
            )}
            {isLoading && (
              <p className="px-4 py-6 text-sm text-muted-foreground text-center">Loading cost layers…</p>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
