import React, { useMemo } from 'react';
import { Box, CheckCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';

/**
 * Shows packaging materials stock levels — often overlooked until they cause a crisis.
 */
export default function PackagingStockTable({ products, stockRecords }) {
  const packagingItems = useMemo(() => {
    return products
      .filter(p => p.type === 'packaging')
      .map(p => {
        const soh = stockRecords
          .filter(s => s.product_id === p.id)
          .reduce((sum, s) => sum + (s.qty_on_hand || 0), 0);
        const belowReorder = p.min_before_reorder > 0 && soh < p.min_before_reorder;
        return {
          name: p.name,
          sku: p.sku,
          soh,
          uom: p.stock_uom || 'pcs',
          reorderPoint: p.min_before_reorder || 0,
          belowReorder,
        };
      })
      .sort((a, b) => {
        // Show below-reorder first, then by SOH ascending
        if (a.belowReorder !== b.belowReorder) return a.belowReorder ? -1 : 1;
        return a.soh - b.soh;
      });
  }, [products, stockRecords]);

  if (packagingItems.length === 0) {
    return (
      <div className="bg-card border border-border rounded-lg shadow-sm p-5">
        <h3 className="text-sm font-semibold text-foreground mb-4">Packaging Materials</h3>
        <div className="text-center py-8 text-muted-foreground text-sm">
          <div className="w-10 h-10 rounded-md bg-muted flex items-center justify-center mx-auto mb-2">
            <Box className="w-5 h-5 text-muted-foreground" strokeWidth={1.5} />
          </div>
          No packaging products found
        </div>
      </div>
    );
  }

  const lowCount = packagingItems.filter(p => p.belowReorder).length;

  return (
    <div className="bg-card border border-border rounded-lg shadow-sm p-5">
      <h3 className="text-sm font-semibold text-foreground mb-1 flex items-center gap-2">
        <Box className="w-4 h-4 text-muted-foreground" />
        Packaging Materials
      </h3>
      {lowCount > 0 && (
        <p className="text-xs text-status-bad mb-3">{lowCount} item{lowCount > 1 ? 's' : ''} below reorder point</p>
      )}
      {lowCount === 0 && (
        <p className="text-xs text-status-good mb-3 flex items-center gap-1">
          <CheckCircle className="w-3 h-3" /> All stocked
        </p>
      )}
      <div className="space-y-1">
        {packagingItems.slice(0, 8).map((item, i) => (
          <div key={i} className="flex items-center justify-between py-2 px-2 rounded-md hover:bg-muted/50 transition-colors">
            <div className="min-w-0">
              <p className="text-sm font-medium truncate">{item.name}</p>
              <p className="text-[11px] font-mono text-muted-foreground">{item.sku}</p>
            </div>
            <div className="text-right shrink-0 ml-2 flex items-center gap-2">
              <p className={cn(
                "text-sm font-semibold tabular-nums",
                item.belowReorder ? 'text-status-bad' : 'text-foreground'
              )}>
                {item.soh.toLocaleString()} {item.uom}
              </p>
              {item.belowReorder && (
                <Badge className="text-[10px] bg-status-bad-subtle text-status-bad">Low</Badge>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}