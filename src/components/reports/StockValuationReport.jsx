import React, { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { downloadCSV } from '@/lib/csvExport';
import { formatZAR } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Download, Printer } from 'lucide-react';

export default function StockValuationReport() {
  const { data: soh = [] } = useQuery({
    queryKey: ['report-soh-valuation'],
    queryFn: () => base44.entities.StockOnHand.list('product_id', 5000),
  });
  const { data: products = [] } = useQuery({
    queryKey: ['active-products'],
    queryFn: () => base44.entities.Product.filter({ status: 'active' }, 'name', 500),
  });

  const rows = useMemo(() => {
    const productMap = Object.fromEntries(products.map(p => [p.id, p]));
    const byProduct = {};
    for (const s of soh) {
      if (!byProduct[s.product_id]) byProduct[s.product_id] = { qty: 0, product: productMap[s.product_id] };
      byProduct[s.product_id].qty += s.qty_on_hand || 0;
    }
    return Object.values(byProduct)
      .filter(r => r.qty > 0 && r.product)
      .map(r => ({
        name: r.product.name,
        sku: r.product.sku,
        type: r.product.product_type || 'Other',
        qty: r.qty,
        uom: r.product.stock_uom || 'pcs',
        cost_avg: r.product.cost_avg || 0,
        value: r.qty * (r.product.cost_avg || 0),
      }))
      .sort((a, b) => b.value - a.value);
  }, [soh, products]);

  const byType = useMemo(() => {
    const groups = {};
    for (const r of rows) {
      if (!groups[r.type]) groups[r.type] = 0;
      groups[r.type] += r.value;
    }
    return Object.entries(groups).sort((a, b) => b[1] - a[1]);
  }, [rows]);

  const grandTotal = rows.reduce((s, r) => s + r.value, 0);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold">Total Stock Value: {formatZAR(grandTotal)}</p>
          <p className="text-xs text-muted-foreground">{rows.length} products with stock</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => downloadCSV('stock_valuation.csv', rows.map(r => ({
            sku: r.sku, name: r.name, type: r.type, qty: r.qty, uom: r.uom, cost_avg: r.cost_avg, value: r.value.toFixed(2),
          })))} className="gap-1.5 h-8 text-xs"><Download className="w-3.5 h-3.5" /> CSV</Button>
          <Button variant="outline" size="sm" onClick={() => window.print()} className="gap-1.5 h-8 text-xs"><Printer className="w-3.5 h-3.5" /> Print</Button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {byType.map(([type, val]) => (
          <div key={type} className="bg-card rounded-lg border border-border p-3">
            <p className="text-xs text-muted-foreground">{type}</p>
            <p className="text-sm font-bold mt-0.5">{formatZAR(val)}</p>
          </div>
        ))}
      </div>

      <div className="bg-card rounded-xl border border-border overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-muted/50 border-b border-border">
              <th className="text-left px-4 py-2.5 text-[10px] font-semibold text-muted-foreground uppercase">Product</th>
              <th className="text-left px-4 py-2.5 text-[10px] font-semibold text-muted-foreground uppercase w-20">Type</th>
              <th className="text-right px-4 py-2.5 text-[10px] font-semibold text-muted-foreground uppercase w-24">Qty</th>
              <th className="text-right px-4 py-2.5 text-[10px] font-semibold text-muted-foreground uppercase w-24">Cost Avg</th>
              <th className="text-right px-4 py-2.5 text-[10px] font-semibold text-muted-foreground uppercase w-28">Value</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((r, i) => (
              <tr key={i}>
                <td className="px-4 py-2.5">
                  <p className="text-xs font-medium">{r.name}</p>
                  <p className="text-[10px] font-mono text-muted-foreground">{r.sku}</p>
                </td>
                <td className="px-4 py-2.5 text-xs text-muted-foreground">{r.type}</td>
                <td className="px-4 py-2.5 text-right text-xs">{r.qty.toFixed(3)} {r.uom}</td>
                <td className="px-4 py-2.5 text-right text-xs">{formatZAR(r.cost_avg)}</td>
                <td className="px-4 py-2.5 text-right text-xs font-semibold">{formatZAR(r.value)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && <p className="px-4 py-6 text-sm text-muted-foreground text-center">No stock on hand</p>}
      </div>
    </div>
  );
}
