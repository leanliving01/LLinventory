import React, { useMemo } from 'react';
import { AlertTriangle, Shield } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';

/**
 * Shows SOH vs reorder point with "days of cover" estimate.
 * Days of cover = SOH / avg daily consumption (rough: reorder_qty / lead_time_days).
 */
export default function StockCoverTable({ products, stockRecords }) {
  const items = useMemo(() => {
    const list = [];
    products.forEach(p => {
      if (p.min_before_reorder > 0 && ['raw', 'packaging'].includes(p.type)) {
        const soh = stockRecords
          .filter(s => s.product_id === p.id)
          .reduce((sum, s) => sum + (s.qty_on_hand || 0), 0);
        // Estimate daily usage from reorder_qty / lead_time
        const dailyUse = (p.lead_time_days > 0 && p.reorder_qty > 0)
          ? p.reorder_qty / p.lead_time_days
          : 0;
        const daysCover = dailyUse > 0 ? Math.round(soh / dailyUse) : soh > 0 ? 999 : 0;
        const coverStatus = daysCover <= 1 ? 'bad' : daysCover <= 3 ? 'warn' : 'good';
        list.push({
          name: p.name,
          sku: p.sku,
          type: p.type,
          soh,
          reorderPoint: p.min_before_reorder,
          uom: p.stock_uom || 'pcs',
          daysCover,
          coverStatus,
          deficit: Math.max(0, p.min_before_reorder - soh),
        });
      }
    });
    return list.sort((a, b) => a.daysCover - b.daysCover);
  }, [products, stockRecords]);

  if (items.length === 0) {
    return (
      <div className="bg-card border border-border rounded-lg shadow-sm p-5">
        <h3 className="text-sm font-semibold text-foreground mb-4">Ingredient Stock Cover</h3>
        <div className="text-center py-8 text-muted-foreground text-sm">
          <div className="w-10 h-10 rounded-md bg-status-good-subtle flex items-center justify-center mx-auto mb-2">
            <Shield className="w-5 h-5 text-status-good" strokeWidth={1.5} />
          </div>
          All stock levels healthy
        </div>
      </div>
    );
  }

  const statusColor = {
    bad: 'bg-status-bad-subtle text-status-bad',
    warn: 'bg-status-warn-subtle text-status-warn',
    good: 'bg-status-good-subtle text-status-good',
  };

  return (
    <div className="bg-card border border-border rounded-lg shadow-sm p-5">
      <h3 className="text-sm font-semibold text-foreground mb-4">Ingredient Stock Cover</h3>
      <div className="space-y-1">
        {items.slice(0, 10).map((item, i) => (
          <div key={i} className="flex items-center justify-between py-2.5 px-2 rounded-md hover:bg-muted/50 transition-colors">
            <div className="flex items-center gap-3 min-w-0">
              <div className={cn("w-8 h-8 rounded-md flex items-center justify-center shrink-0",
                item.deficit > 0 ? 'bg-status-bad-subtle' : 'bg-status-good-subtle')}>
                <AlertTriangle className={cn("w-4 h-4",
                  item.deficit > 0 ? 'text-status-bad' : 'text-status-good'
                )} strokeWidth={1.5} />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-medium truncate">{item.name}</p>
                <p className="text-[11px] font-mono text-muted-foreground">{item.sku}</p>
              </div>
            </div>
            <div className="text-right shrink-0 ml-2 flex items-center gap-3">
              <div>
                <p className="text-sm font-semibold tabular-nums">
                  {item.soh.toLocaleString()} {item.uom}
                </p>
                <p className="text-[10px] text-muted-foreground">
                  ROP: {item.reorderPoint.toLocaleString()}
                </p>
              </div>
              <Badge className={cn("text-[10px] tabular-nums", statusColor[item.coverStatus])}>
                {item.daysCover >= 999 ? '∞' : `${item.daysCover}d`}
              </Badge>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}