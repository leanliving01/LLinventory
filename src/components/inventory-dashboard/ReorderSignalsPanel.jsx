import React, { useState, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ShoppingCart, ArrowRight, PackageX } from 'lucide-react';
import CreatePOModal from '@/components/purchasing/CreatePOModal';
import { buildReorderItems, SEVERITY_ORDER } from '@/lib/reorderSignals';
import { useStockLevels } from '@/lib/useStockLevels';
import { typeInGroup } from '@/lib/inventoryCategories';

const SEVERITY_BADGE = {
  critical: { label: 'OUT', cls: 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300' },
  low:      { label: 'LOW', cls: 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300' },
  warning:  { label: 'WARN', cls: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-950 dark:text-yellow-300' },
};

/**
 * Dashboard reorder panel — the "what do I need to order right now" view.
 * Reuses the shared lib/reorderSignals.js logic so it always agrees with the
 * full Reorder Report. Select rows → Create PO (existing modal).
 */
export default function ReorderSignalsPanel({ types = null, limit = 12 }) {
  const queryClient = useQueryClient();
  const [selectedItems, setSelectedItems] = useState([]);
  const [showCreatePO, setShowCreatePO] = useState(false);

  // Same query keys as ReorderReport → shared react-query cache, no double fetch.
  const { data: products = [] } = useQuery({
    queryKey: ['products-reorder'],
    queryFn: () => base44.entities.Product.filter({ status: 'active' }, 'name', 500),
  });
  // Canonical, never-truncated per-product stock (RPC) — see lib/useStockLevels.js.
  const { rows: stockRecords = [] } = useStockLevels();
  const { data: suppliers = [] } = useQuery({
    queryKey: ['suppliers-active'],
    queryFn: () => base44.entities.Supplier.filter({ status: 'active' }, 'name', 200),
  });
  const { data: supplierProducts = [] } = useQuery({
    queryKey: ['supplier-products-reorder'],
    queryFn: () => base44.entities.SupplierProduct.filter({ active: true }, 'product_name', 2000),
  });

  const belowItems = useMemo(() => {
    const all = buildReorderItems({ products, stockRecords, suppliers, supplierProducts })
      .filter((p) => p.is_below)
      .filter((p) => typeInGroup(p.type, types));
    all.sort((a, b) => {
      const sa = SEVERITY_ORDER[a.severity] ?? 3;
      const sb = SEVERITY_ORDER[b.severity] ?? 3;
      if (sa !== sb) return sa - sb;
      return b.shortfall - a.shortfall;
    });
    return all;
  }, [products, stockRecords, suppliers, supplierProducts, types]);

  const shown = belowItems.slice(0, limit);

  const toggleSelect = (id) =>
    setSelectedItems((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const prefillLines = useMemo(
    () =>
      belowItems
        .filter((p) => selectedItems.includes(p.id))
        .map((p) => ({ product_id: p.id, qty: String(p.suggested_qty || 1), unit_cost: String(p.cost_avg || 0) })),
    [belowItems, selectedItems]
  );

  return (
    <div className="bg-card border border-border rounded-lg shadow-sm overflow-hidden">
      <div className="flex items-center justify-between px-5 pt-5 pb-3">
        <div>
          <h3 className="text-sm font-semibold text-foreground">Reorder Now</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            {belowItems.length} item{belowItems.length === 1 ? '' : 's'} below reorder point
          </p>
        </div>
        <div className="flex items-center gap-2">
          {selectedItems.length > 0 && (
            <Button size="sm" className="gap-1.5" onClick={() => setShowCreatePO(true)}>
              <ShoppingCart className="w-3.5 h-3.5" /> Create PO ({selectedItems.length})
            </Button>
          )}
          <Button asChild size="sm" variant="ghost" className="gap-1 text-muted-foreground">
            <Link to="/purchasing/reorder">
              Full report <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </Button>
        </div>
      </div>

      {shown.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 py-10 text-muted-foreground">
          <PackageX className="w-7 h-7 opacity-40" />
          <p className="text-sm">Nothing below reorder point. 🎉</p>
        </div>
      ) : (
        <table className="w-full">
          <thead>
            <tr className="bg-muted/50 border-y border-border">
              <th className="w-9 px-3 py-2" />
              <th className="text-left px-3 py-2 text-[11px] font-semibold text-muted-foreground uppercase">Product</th>
              <th className="text-left px-3 py-2 text-[11px] font-semibold text-muted-foreground uppercase">Supplier</th>
              <th className="text-right px-3 py-2 text-[11px] font-semibold text-muted-foreground uppercase">On Hand</th>
              <th className="text-right px-3 py-2 text-[11px] font-semibold text-muted-foreground uppercase">Short</th>
              <th className="text-right px-3 py-2 text-[11px] font-semibold text-muted-foreground uppercase">Order</th>
              <th className="text-center px-3 py-2 text-[11px] font-semibold text-muted-foreground uppercase">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {shown.map((item) => {
              const badge = SEVERITY_BADGE[item.severity];
              return (
                <tr key={item.id} className="hover:bg-muted/30 transition-colors">
                  <td className="px-3 py-2">
                    <input
                      type="checkbox"
                      checked={selectedItems.includes(item.id)}
                      onChange={() => toggleSelect(item.id)}
                      className="rounded border-border"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <p className="text-sm font-medium leading-tight">{item.name}</p>
                    <p className="text-[10px] font-mono text-muted-foreground">{item.sku}</p>
                  </td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">{item.supplier_name}</td>
                  <td className="px-3 py-2 text-right text-sm font-medium tabular-nums">{item.total_on_hand}</td>
                  <td className="px-3 py-2 text-right text-sm font-bold text-red-600 tabular-nums">{item.shortfall}</td>
                  <td className="px-3 py-2 text-right text-sm tabular-nums">{item.suggested_qty}</td>
                  <td className="px-3 py-2 text-center">
                    {badge && <Badge className={`text-[10px] ${badge.cls}`}>{badge.label}</Badge>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {belowItems.length > shown.length && (
        <div className="px-5 py-2.5 text-center border-t border-border">
          <Link to="/purchasing/reorder" className="text-xs text-primary hover:underline">
            + {belowItems.length - shown.length} more below reorder point
          </Link>
        </div>
      )}

      {showCreatePO && (
        <CreatePOModal
          prefillLines={prefillLines}
          onCreated={() => {
            setShowCreatePO(false);
            setSelectedItems([]);
            queryClient.invalidateQueries({ queryKey: ['purchase-orders'] });
          }}
          onCancel={() => setShowCreatePO(false)}
        />
      )}
    </div>
  );
}
