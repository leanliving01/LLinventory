import React, { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { differenceInCalendarDays } from 'date-fns';
import { downloadCSV } from '@/lib/csvExport';
import { formatZAR } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Download, Printer, AlertTriangle } from 'lucide-react';

// Age thresholds by product type (days before flagging).
// Keyed by the real products.type enum (lowercase snake_case).
const AGE_THRESHOLDS = {
  finished_meal: 14,
  wip_bulk: 14,
  sauce: 21,
  default: 60,
};

const TYPE_LABELS = {
  raw: 'Raw', packaging: 'Packaging', wip_bulk: 'WIP Bulk', finished_meal: 'Finished Meal',
  supplement: 'Supplement', package: 'Package', sauce: 'Sauce', solo_serve: 'Solo Serve',
  bundle: 'Bundle', service: 'Service',
};

function getThreshold(type) {
  return AGE_THRESHOLDS[type] ?? AGE_THRESHOLDS.default;
}

export default function StockAgeReport() {
  const { data: layers = [] } = useQuery({
    queryKey: ['report-cost-layers'],
    queryFn: () => base44.entities.CostLayer.filter({ is_depleted: false }, 'received_date', 2000),
  });
  const { data: products = [] } = useQuery({
    queryKey: ['active-products'],
    queryFn: () => base44.entities.Product.filter({ status: 'active' }, 'name', 500),
  });

  const rows = useMemo(() => {
    const today = new Date();
    const productMap = Object.fromEntries(products.map(p => [p.id, p]));
    return layers
      .filter(l => l.qty_remaining > 0 && l.received_date)
      .map(l => {
        const p = productMap[l.product_id];
        const age = differenceInCalendarDays(today, new Date(l.received_date));
        const threshold = getThreshold(p?.type);
        return {
          product_id: l.product_id,
          name: p?.name || l.product_id,
          sku: p?.sku || '',
          type: p?.type ? (TYPE_LABELS[p.type] || p.type.replace(/_/g, ' ')) : '',
          qty: l.qty_remaining,
          uom: p?.stock_uom || 'pcs',
          cost: l.cost_per_stock_uom || 0,
          value: l.qty_remaining * (l.cost_per_stock_uom || 0),
          received_date: l.received_date,
          age,
          threshold,
          flagged: age > threshold,
        };
      })
      .sort((a, b) => b.age - a.age);
  }, [layers, products]);

  const flaggedCount = rows.filter(r => r.flagged).length;
  const flaggedValue = rows.filter(r => r.flagged).reduce((s, r) => s + r.value, 0);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold">{rows.length} FIFO layer{rows.length !== 1 ? 's' : ''} on hand</p>
          {flaggedCount > 0 && <p className="text-xs text-amber-600 font-medium">{flaggedCount} aged beyond threshold · {formatZAR(flaggedValue)} at risk</p>}
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => downloadCSV('stock_age.csv', rows.map(r => ({
            sku: r.sku, name: r.name, type: r.type, qty: r.qty, uom: r.uom,
            received: r.received_date, age_days: r.age, threshold: r.threshold, value: r.value.toFixed(2), flagged: r.flagged,
          })))} className="gap-1.5 h-8 text-xs"><Download className="w-3.5 h-3.5" /> CSV</Button>
          <Button variant="outline" size="sm" onClick={() => window.print()} className="gap-1.5 h-8 text-xs"><Printer className="w-3.5 h-3.5" /> Print</Button>
        </div>
      </div>
      <div className="bg-card rounded-xl border border-border overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-muted/50 border-b border-border">
              <th className="text-left px-4 py-2.5 text-[10px] font-semibold text-muted-foreground uppercase">Product</th>
              <th className="text-right px-4 py-2.5 text-[10px] font-semibold text-muted-foreground uppercase w-24">Qty</th>
              <th className="text-right px-4 py-2.5 text-[10px] font-semibold text-muted-foreground uppercase w-28">Received</th>
              <th className="text-right px-4 py-2.5 text-[10px] font-semibold text-muted-foreground uppercase w-20">Age</th>
              <th className="text-right px-4 py-2.5 text-[10px] font-semibold text-muted-foreground uppercase w-28">Value</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((r, i) => (
              <tr key={i} className={r.flagged ? 'bg-amber-50/60 dark:bg-amber-950/20' : ''}>
                <td className="px-4 py-2.5">
                  <div className="flex items-center gap-1.5">
                    {r.flagged && <AlertTriangle className="w-3.5 h-3.5 text-amber-500 shrink-0" />}
                    <div>
                      <p className="text-xs font-medium">{r.name}</p>
                      <p className="text-[10px] font-mono text-muted-foreground">{r.sku} · {r.type}</p>
                    </div>
                  </div>
                </td>
                <td className="px-4 py-2.5 text-right text-xs">{r.qty.toFixed(3)} {r.uom}</td>
                <td className="px-4 py-2.5 text-right text-xs text-muted-foreground">{r.received_date}</td>
                <td className={`px-4 py-2.5 text-right text-xs font-semibold ${r.flagged ? 'text-amber-600' : ''}`}>{r.age}d</td>
                <td className="px-4 py-2.5 text-right text-xs font-semibold">{formatZAR(r.value)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && <p className="px-4 py-6 text-sm text-muted-foreground text-center">No FIFO cost layers found. Ensure costing_method is set to FIFO.</p>}
      </div>
    </div>
  );
}
