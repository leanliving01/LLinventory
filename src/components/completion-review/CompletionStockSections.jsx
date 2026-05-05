import React, { useMemo } from 'react';
import { Badge } from '@/components/ui/badge';
import { Beef, Warehouse, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';

function netByProduct(movements) {
  const map = {};
  for (const m of movements) {
    const key = m.product_id || m.product_sku;
    if (!map[key]) {
      map[key] = { product_name: m.product_name, product_sku: m.product_sku, uom: m.uom, qty: 0, cost: 0 };
    }
    map[key].qty += m.qty;
    map[key].cost += (m.unit_cost_at_movement || 0) * m.qty;
  }
  return Object.values(map).filter(r => r.qty > 0.001).sort((a, b) => b.qty - a.qty);
}

function SectionCard({ icon: Icon, iconColor, title, badge, children, emptyText }) {
  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      <div className="flex items-center gap-2 px-5 py-3 bg-muted/30 border-b border-border">
        <Icon className={cn("w-4 h-4", iconColor)} />
        <span className="text-sm font-bold">{title}</span>
        {badge && <Badge variant="outline" className="ml-auto text-xs">{badge}</Badge>}
      </div>
      {children || (
        <div className="px-5 py-4 text-center text-xs text-muted-foreground">{emptyText || 'None'}</div>
      )}
    </div>
  );
}

function ItemList({ items }) {
  return (
    <div className="divide-y divide-border">
      {items.map((item, i) => (
        <div key={i} className="flex items-center justify-between px-5 py-2.5 text-sm">
          <div className="flex-1 min-w-0">
            <span className="font-medium truncate block">{item.product_name || item.product_sku}</span>
            {item.product_sku && item.product_name && (
              <span className="text-xs text-muted-foreground font-mono">{item.product_sku}</span>
            )}
          </div>
          <div className="text-right shrink-0 ml-3">
            <span className="font-semibold tabular-nums">{Number(item.qty).toFixed(2)}</span>
            <span className="text-xs text-muted-foreground ml-1">{item.uom}</span>
            {item.cost > 0.01 && (
              <p className="text-[10px] text-muted-foreground">R{item.cost.toFixed(2)}</p>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

export default function CompletionStockSections({ movements, wipBatches, productTypeMap, loading }) {
  const { rawReturns, wastage } = useMemo(() => {
    const returnMvs = movements.filter(m => m.reason === 'return' && productTypeMap[m.product_id] === 'raw');
    const wastageMvs = movements.filter(m => m.reason === 'wastage_unusable' || m.reason === 'wastage_usable');
    return { rawReturns: netByProduct(returnMvs), wastage: netByProduct(wastageMvs) };
  }, [movements, productTypeMap]);

  const wipLeftovers = useMemo(() => {
    return wipBatches
      .filter(b => (b.qty_kg || 0) > 0.001)
      .map(b => ({
        product_name: b.bulk_product_name,
        product_sku: b.bulk_product_sku,
        uom: 'kg',
        qty: b.qty_kg,
        original: b.original_qty_kg,
        batch_number: b.batch_number,
      }))
      .sort((a, b) => b.qty - a.qty);
  }, [wipBatches]);

  if (loading) {
    return <div className="text-center py-8 text-sm text-muted-foreground">Loading stock data...</div>;
  }

  return (
    <div className="space-y-4">
      {/* Bulk Cooked Leftovers */}
      <SectionCard
        icon={Beef}
        iconColor="text-blue-600"
        title="Bulk Cooked Leftovers"
        badge={wipLeftovers.length > 0 ? `${wipLeftovers.length} items` : null}
        emptyText="No bulk leftovers — all WIP was portioned"
      >
        {wipLeftovers.length > 0 && (
          <div className="divide-y divide-border">
            {wipLeftovers.map((w, i) => (
              <div key={i} className="flex items-center justify-between px-5 py-2.5 text-sm">
                <div className="flex-1 min-w-0">
                  <span className="font-medium truncate block">{w.product_name}</span>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground font-mono">{w.product_sku}</span>
                    {w.batch_number && <Badge variant="outline" className="text-[10px]">{w.batch_number}</Badge>}
                  </div>
                </div>
                <div className="text-right shrink-0 ml-3">
                  <span className="font-semibold tabular-nums text-blue-700">{Number(w.qty).toFixed(2)} kg</span>
                  {w.original > 0 && (
                    <p className="text-[10px] text-muted-foreground">of {Number(w.original).toFixed(2)} produced</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </SectionCard>

      {/* Raw Returns */}
      <SectionCard
        icon={Warehouse}
        iconColor="text-amber-600"
        title="Raw Materials Returned to Stock"
        badge={rawReturns.length > 0 ? `${rawReturns.length} items` : null}
        emptyText="No raw materials returned"
      >
        {rawReturns.length > 0 && <ItemList items={rawReturns} />}
      </SectionCard>

      {/* Wastage */}
      {wastage.length > 0 && (
        <SectionCard
          icon={Trash2}
          iconColor="text-red-600"
          title="Wastage"
          badge={`${wastage.length} items`}
        >
          <ItemList items={wastage} />
        </SectionCard>
      )}
    </div>
  );
}