import React, { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { X, RotateCcw, Trash2, TrendingDown, ChefHat, Beef, Warehouse } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Aggregate a list of stock movements by product, summing qty per product.
 * Returns sorted array of { product_id, product_name, product_sku, uom, qty, cost }.
 */
function netByProduct(movements) {
  const map = {};
  for (const m of movements) {
    const key = m.product_id || m.product_sku;
    if (!map[key]) {
      map[key] = { product_id: m.product_id, product_name: m.product_name, product_sku: m.product_sku, uom: m.uom, qty: 0, cost: 0 };
    }
    map[key].qty += m.qty;
    map[key].cost += (m.unit_cost_at_movement || 0) * m.qty;
  }
  return Object.values(map).filter(r => r.qty > 0.001).sort((a, b) => b.qty - a.qty);
}

function ItemList({ items }) {
  if (!items || items.length === 0) return null;
  return (
    <div className="divide-y divide-border max-h-52 overflow-y-auto">
      {items.map((item, i) => (
        <div key={item.product_id || i} className="flex items-center justify-between px-4 py-2 text-sm">
          <div className="flex-1 min-w-0">
            <span className="font-medium truncate block">{item.product_name || item.product_sku}</span>
            {item.product_sku && item.product_name && (
              <span className="text-xs text-muted-foreground font-mono">{item.product_sku}</span>
            )}
          </div>
          <div className="text-right shrink-0 ml-3">
            <span className="font-semibold tabular-nums">{Number(item.qty).toFixed(2)}</span>
            <span className="text-xs text-muted-foreground ml-1">{item.uom}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

function SectionCard({ icon: Icon, iconColor, title, badge, children, emptyText }) {
  return (
    <div className="border border-border rounded-lg overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-2.5 bg-muted/50 border-b border-border">
        <Icon className={cn("w-4 h-4", iconColor)} />
        <span className="text-sm font-semibold">{title}</span>
        {badge && <Badge variant="outline" className="ml-auto text-xs">{badge}</Badge>}
      </div>
      {children || (
        <div className="px-4 py-3 text-center text-xs text-muted-foreground">
          {emptyText || 'None'}
        </div>
      )}
    </div>
  );
}

export default function ProductionSummaryModal({ runId, runNumber, lines, onClose }) {
  // Fetch all stock movements for this run
  const { data: movements = [], isLoading } = useQuery({
    queryKey: ['run-stock-movements', runId],
    queryFn: async () => {
      const [runMvs, pickListRecs] = await Promise.all([
        base44.entities.StockMovement.filter({ ref_id: runId, ref_type: 'production_run' }, '-created_date', 500),
        base44.entities.PickList.filter({ production_run_id: runId }, '-created_date', 1),
      ]);
      if (pickListRecs.length > 0) {
        const pickMvs = await base44.entities.StockMovement.filter({ ref_id: pickListRecs[0].id, ref_type: 'pick_list' }, '-created_date', 500);
        return [...runMvs, ...pickMvs];
      }
      return runMvs;
    },
    enabled: !!runId,
  });

  // Fetch WipBatch records linked to this run's cooking tasks to get remaining bulk WIP
  const { data: wipBatches = [] } = useQuery({
    queryKey: ['run-wip-batches', runId],
    queryFn: () => base44.entities.WipBatch.filter({ cooking_run_id: runId }, 'produced_date', 100),
    enabled: !!runId,
  });

  // Fetch products to identify raw materials vs bulk/WIP/packaging
  const productIdsInMovements = useMemo(() => {
    const ids = new Set();
    movements.forEach(m => { if (m.product_id) ids.add(m.product_id); });
    return [...ids];
  }, [movements]);

  const { data: products = [] } = useQuery({
    queryKey: ['run-summary-products', runId],
    queryFn: () => base44.entities.Product.filter({ status: 'active' }, 'sku', 500),
    enabled: productIdsInMovements.length > 0,
  });

  const productTypeMap = useMemo(() => {
    const map = {};
    products.forEach(p => { map[p.id] = p.type; });
    return map;
  }, [products]);

  // Categorise movements
  const { rawReturns, wastage, totalRawReturnQty, totalWasteQty, totalWasteCost } = useMemo(() => {
    // Raw material returns = 'return' reason movements for ONLY type=raw products
    // Bulk/WIP products are already tracked via WipBatch leftovers — never show them here
    const returnMvs = movements.filter(m =>
      m.reason === 'return' && productTypeMap[m.product_id] === 'raw'
    );
    const wastageMvs = movements.filter(m => m.reason === 'wastage_unusable' || m.reason === 'wastage_usable');

    const rawReturns = netByProduct(returnMvs);
    const wastage = netByProduct(wastageMvs);

    return {
      rawReturns,
      wastage,
      totalRawReturnQty: rawReturns.reduce((s, r) => s + r.qty, 0),
      totalWasteQty: wastage.reduce((s, r) => s + r.qty, 0),
      totalWasteCost: wastage.reduce((s, r) => s + r.cost, 0),
    };
  }, [movements, productTypeMap]);

  // WIP leftovers = WipBatch records with remaining qty > 0
  const wipLeftovers = useMemo(() => {
    return wipBatches
      .filter(b => (b.qty_kg || 0) > 0.001)
      .map(b => ({
        product_id: b.bulk_product_id,
        product_name: b.bulk_product_name,
        product_sku: b.bulk_product_sku,
        uom: 'kg',
        qty: b.qty_kg,
        original: b.original_qty_kg,
        batch_number: b.batch_number,
      }))
      .sort((a, b) => b.qty - a.qty);
  }, [wipBatches]);

  const totalWipLeftover = wipLeftovers.reduce((s, w) => s + w.qty, 0);

  // Meal totals
  const totalPlanned = lines.reduce((s, l) => s + l.planned_qty, 0);
  const totalActual = lines.reduce((s, l) => s + (l.actual_qty || 0), 0);
  const mealsWithVariance = lines.filter(l => (l.actual_qty || 0) !== l.planned_qty).length;

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-card rounded-2xl border border-border w-full max-w-2xl shadow-xl flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border shrink-0">
          <div>
            <h2 className="text-lg font-bold">Production Summary</h2>
            <p className="text-sm text-muted-foreground">Run {runNumber} — end-of-run report</p>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="w-5 h-5" />
          </Button>
        </div>

        {/* KPI strip */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 px-6 pt-4 shrink-0">
          <div className="bg-green-50 dark:bg-green-900/20 rounded-lg p-3 text-center">
            <p className="text-2xl font-bold text-green-700 dark:text-green-400 tabular-nums">{totalActual}</p>
            <p className="text-xs text-green-600">Meals Produced</p>
            {totalActual !== totalPlanned && (
              <p className="text-[10px] text-muted-foreground mt-0.5">of {totalPlanned} planned</p>
            )}
          </div>
          <div className="bg-blue-50 dark:bg-blue-900/20 rounded-lg p-3 text-center">
            <p className="text-2xl font-bold text-blue-700 dark:text-blue-400 tabular-nums">{totalWipLeftover.toFixed(1)}</p>
            <p className="text-xs text-blue-600">Bulk Leftover (kg)</p>
          </div>
          <div className="bg-amber-50 dark:bg-amber-900/20 rounded-lg p-3 text-center">
            <p className="text-2xl font-bold text-amber-700 dark:text-amber-400 tabular-nums">{totalRawReturnQty.toFixed(1)}</p>
            <p className="text-xs text-amber-600">Raw Returned</p>
          </div>
          <div className="bg-red-50 dark:bg-red-900/20 rounded-lg p-3 text-center">
            <p className="text-2xl font-bold text-red-700 dark:text-red-400 tabular-nums">{totalWasteQty.toFixed(1)}</p>
            <p className="text-xs text-red-600">Wastage</p>
          </div>
        </div>

        {totalWasteCost > 0.01 && (
          <div className="px-6 pt-2 shrink-0">
            <p className="text-xs text-red-600 text-center">
              Estimated wastage cost: <strong>R{totalWasteCost.toFixed(2)}</strong>
            </p>
          </div>
        )}

        {/* Detail sections */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          {isLoading ? (
            <p className="text-sm text-muted-foreground text-center py-8">Loading...</p>
          ) : (
            <>
              {/* 1. Bulk WIP Leftovers — what's remaining after portioning, goes to QC */}
              <SectionCard
                icon={Beef}
                iconColor="text-blue-600"
                title="Bulk Cooked Leftovers"
                badge={wipLeftovers.length > 0 ? `${wipLeftovers.length} items` : null}
                emptyText="No bulk leftovers — all WIP was portioned"
              >
                {wipLeftovers.length > 0 && (
                  <div className="divide-y divide-border max-h-52 overflow-y-auto">
                    {wipLeftovers.map((w, i) => (
                      <div key={w.product_id + '-' + i} className="flex items-center justify-between px-4 py-2 text-sm">
                        <div className="flex-1 min-w-0">
                          <span className="font-medium truncate block">{w.product_name}</span>
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-muted-foreground font-mono">{w.product_sku}</span>
                            {w.batch_number && (
                              <Badge variant="outline" className="text-[10px]">{w.batch_number}</Badge>
                            )}
                          </div>
                        </div>
                        <div className="text-right shrink-0 ml-3">
                          <span className="font-semibold tabular-nums text-blue-700">{Number(w.qty).toFixed(2)}</span>
                          <span className="text-xs text-muted-foreground ml-1">kg</span>
                          {w.original > 0 && (
                            <p className="text-[10px] text-muted-foreground">
                              of {Number(w.original).toFixed(2)} produced
                            </p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </SectionCard>

              {/* 2. Raw Materials Returned — picked but unused raw ingredients returned to warehouse */}
              <SectionCard
                icon={Warehouse}
                iconColor="text-amber-600"
                title="Raw Materials Returned to Stock"
                badge={rawReturns.length > 0 ? `${rawReturns.length} items` : null}
                emptyText="No raw materials returned — all picked stock was consumed"
              >
                {rawReturns.length > 0 && <ItemList items={rawReturns} />}
              </SectionCard>

              {/* 3. Wastage */}
              {wastage.length > 0 && (
                <SectionCard
                  icon={Trash2}
                  iconColor="text-red-600"
                  title="Unusable Wastage"
                  badge={`${wastage.length} items`}
                >
                  <ItemList items={wastage} />
                </SectionCard>
              )}

              {/* 4. Meal Variances — only if any meals deviated from plan */}
              {mealsWithVariance > 0 && (
                <SectionCard
                  icon={TrendingDown}
                  iconColor="text-purple-600"
                  title="Meal Variances"
                  badge={`${mealsWithVariance} meals`}
                >
                  <div className="divide-y divide-border max-h-48 overflow-y-auto">
                    {lines.filter(l => (l.actual_qty || 0) !== l.planned_qty).map(l => {
                      const diff = (l.actual_qty || 0) - l.planned_qty;
                      return (
                        <div key={l.id} className="flex items-center justify-between px-4 py-2 text-sm">
                          <div className="flex-1 min-w-0">
                            <span className="font-medium truncate block">{l.product_name}</span>
                            <span className="text-xs text-muted-foreground font-mono">{l.product_sku}</span>
                          </div>
                          <div className="flex items-center gap-2 shrink-0 ml-3">
                            <span className="text-xs text-muted-foreground">{l.planned_qty} → {l.actual_qty || 0}</span>
                            <Badge className={cn("text-[10px]", diff > 0 ? "bg-amber-100 text-amber-700" : "bg-red-100 text-red-700")}>
                              {diff > 0 ? '+' : ''}{diff}
                            </Badge>
                            {l.variance_reason && l.variance_reason !== 'as_planned' && (
                              <span className="text-[10px] text-muted-foreground italic">{l.variance_reason.replace(/_/g, ' ')}</span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </SectionCard>
              )}

              {/* Overall variance banner */}
              {totalPlanned !== totalActual && (
                <div className="bg-muted/50 rounded-lg px-4 py-3 flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">
                    Planned <strong>{totalPlanned}</strong> meals, Produced <strong>{totalActual}</strong>
                  </span>
                  <Badge className={cn("text-xs", totalActual >= totalPlanned ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700")}>
                    {totalActual >= totalPlanned ? '+' : ''}{totalActual - totalPlanned}
                  </Badge>
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-border shrink-0">
          <Button onClick={onClose} className="w-full h-11">Close Summary</Button>
        </div>
      </div>
    </div>
  );
}