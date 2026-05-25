import React, { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { differenceInCalendarDays } from 'date-fns';
import { downloadCSV } from '@/lib/csvExport';
import { formatZAR } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Download, Printer } from 'lucide-react';

const NO_MOVEMENT_DAYS = 30;

export default function DeadStockReport() {
  const { data: soh = [] } = useQuery({
    queryKey: ['report-dead-stock-soh'],
    queryFn: () => base44.entities.StockOnHand.list('product_id', 5000),
  });
  const { data: products = [] } = useQuery({
    queryKey: ['active-products'],
    queryFn: () => base44.entities.Product.filter({ status: 'active' }, 'name', 500),
  });
  const { data: movements = [] } = useQuery({
    queryKey: ['report-dead-movements'],
    queryFn: () => base44.entities.StockMovement.list('-created_date', 5000),
  });

  const rows = useMemo(() => {
    const today = new Date();
    const productMap = Object.fromEntries(products.map(p => [p.id, p]));

    // Last movement date per product
    const lastMovement = {};
    for (const m of movements) {
      const d = m.created_date || m.movement_date;
      if (!d) continue;
      if (!lastMovement[m.product_id] || d > lastMovement[m.product_id]) {
        lastMovement[m.product_id] = d;
      }
    }

    // Aggregate SOH by product
    const byProduct = {};
    for (const s of soh) {
      if (!byProduct[s.product_id]) byProduct[s.product_id] = 0;
      byProduct[s.product_id] += s.qty_on_hand || 0;
    }

    return Object.entries(byProduct)
      .filter(([pid, qty]) => qty > 0)
      .map(([pid, qty]) => {
        const p = productMap[pid];
        const lastDate = lastMovement[pid];
        const daysIdle = lastDate ? differenceInCalendarDays(today, new Date(lastDate)) : 999;
        return {
          product_id: pid,
          name: p?.name || pid,
          sku: p?.sku || '',
          type: p?.product_type || '',
          qty,
          uom: p?.stock_uom || 'pcs',
          cost_avg: p?.cost_avg || 0,
          value: qty * (p?.cost_avg || 0),
          daysIdle,
          lastMovement: lastDate ? lastDate.slice(0, 10) : 'Never',
        };
      })
      .filter(r => r.daysIdle >= NO_MOVEMENT_DAYS)
      .sort((a, b) => b.daysIdle - a.daysIdle);
  }, [soh, products, movements]);

  const totalValue = rows.reduce((s, r) => s + r.value, 0);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold">{rows.length} dead stock product{rows.length !== 1 ? 's' : ''}</p>
          <p className="text-xs text-muted-foreground">No movement in {NO_MOVEMENT_DAYS}+ days · Total value: {formatZAR(totalValue)}</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => downloadCSV('dead_stock.csv', rows.map(r => ({
            sku: r.sku, name: r.name, qty: r.qty, uom: r.uom, days_idle: r.daysIdle, last_movement: r.lastMovement, value: r.value.toFixed(2),
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
              <th className="text-right px-4 py-2.5 text-[10px] font-semibold text-muted-foreground uppercase w-24">Days Idle</th>
              <th className="text-right px-4 py-2.5 text-[10px] font-semibold text-muted-foreground uppercase w-28">Last Movement</th>
              <th className="text-right px-4 py-2.5 text-[10px] font-semibold text-muted-foreground uppercase w-28">Value</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((r, i) => (
              <tr key={i} className={r.daysIdle > 60 ? 'bg-red-50/40 dark:bg-red-950/20' : ''}>
                <td className="px-4 py-2.5">
                  <p className="text-xs font-medium">{r.name}</p>
                  <p className="text-[10px] font-mono text-muted-foreground">{r.sku}</p>
                </td>
                <td className="px-4 py-2.5 text-right text-xs">{r.qty.toFixed(2)} {r.uom}</td>
                <td className={`px-4 py-2.5 text-right text-xs font-semibold ${r.daysIdle > 60 ? 'text-red-600' : 'text-amber-600'}`}>{r.daysIdle}d</td>
                <td className="px-4 py-2.5 text-right text-xs text-muted-foreground">{r.lastMovement}</td>
                <td className="px-4 py-2.5 text-right text-xs font-semibold">{formatZAR(r.value)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && <p className="px-4 py-6 text-sm text-muted-foreground text-center">No dead stock — all products have recent movement</p>}
      </div>
    </div>
  );
}
