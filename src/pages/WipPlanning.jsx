import React, { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Badge } from '@/components/ui/badge';
import { ClipboardCheck, AlertTriangle, CheckCircle2 } from 'lucide-react';

export default function WipPlanning() {
  // WIP batches (active only)
  const { data: batches = [], isLoading: loadingBatches } = useQuery({
    queryKey: ['wip-batches-planning'],
    queryFn: () => base44.entities.WipBatch.list('-created_date', 500),
  });

  // Cook BOMs to understand WIP → finished meal links
  const { data: portionBoms = [] } = useQuery({
    queryKey: ['portion-boms-planning'],
    queryFn: () => base44.entities.Bom.filter({ bom_type: 'portion', is_active: true }, 'product_name', 200),
  });

  // BOM components for portion BOMs — tells us which WIP goes into which meal
  const { data: bomComponents = [] } = useQuery({
    queryKey: ['bom-components-planning'],
    queryFn: () => base44.entities.BomComponent.list('bom_id', 2000),
  });

  // Finished meal stock & par levels
  const { data: meals = [] } = useQuery({
    queryKey: ['finished-meals-planning'],
    queryFn: () => base44.entities.Product.filter({ type: 'finished_meal', status: 'active' }, 'name', 500),
  });

  const { data: stockRecords = [] } = useQuery({
    queryKey: ['stock-on-hand-planning'],
    queryFn: () => base44.entities.StockOnHand.list('-updated_date', 1000),
  });

  // Build stock lookup
  const stockMap = useMemo(() => {
    const map = {};
    stockRecords.forEach(s => {
      if (!map[s.product_id]) map[s.product_id] = { qty_on_hand: 0, qty_committed: 0 };
      map[s.product_id].qty_on_hand += s.qty_on_hand || 0;
      map[s.product_id].qty_committed += s.qty_committed || 0;
    });
    return map;
  }, [stockRecords]);

  // Available WIP per bulk product (approved batches only)
  const wipAvailable = useMemo(() => {
    const map = {};
    batches
      .filter(b => ['fresh', 'use_today'].includes(b.quality_status) && b.qty_kg > 0)
      .forEach(b => {
        if (!map[b.bulk_product_id]) map[b.bulk_product_id] = { name: b.bulk_product_name, sku: b.bulk_product_sku, totalKg: 0, batches: 0 };
        map[b.bulk_product_id].totalKg += b.qty_kg;
        map[b.bulk_product_id].batches += 1;
      });
    return map;
  }, [batches]);

  // Calculate meal-driven bulk requirement per WIP product
  const wipRequirements = useMemo(() => {
    // Map portion bom_id → components that are WIP
    const portionBomIds = new Set(portionBoms.map(b => b.id));
    const wipProductIds = new Set(Object.keys(wipAvailable));

    // For each portion BOM, find WIP components and the finished meal qty needed
    const bulkReq = {}; // bulk_product_id → required_kg

    portionBoms.forEach(bom => {
      const mealProduct = meals.find(m => m.id === bom.product_id);
      if (!mealProduct) return;

      const stock = stockMap[mealProduct.id] || { qty_on_hand: 0, qty_committed: 0 };
      const available = stock.qty_on_hand - stock.qty_committed;
      const par = mealProduct.par_level || 0;
      const mealsNeeded = Math.max(0, par - available);
      if (mealsNeeded <= 0) return;

      // Find WIP components for this BOM
      const comps = bomComponents.filter(c => c.bom_id === bom.id);
      comps.forEach(comp => {
        // Convert component qty (usually in g) to kg for the number of meals needed
        const qtyPerMeal = comp.qty || 0;
        const uom = (comp.uom || 'g').toLowerCase();
        const perMealKg = uom === 'kg' ? qtyPerMeal : uom === 'g' ? qtyPerMeal / 1000 : qtyPerMeal;
        const totalKgNeeded = perMealKg * mealsNeeded;

        if (!bulkReq[comp.input_product_id]) {
          bulkReq[comp.input_product_id] = {
            name: comp.input_product_name,
            sku: comp.input_product_sku,
            requiredKg: 0,
            mealCount: 0,
          };
        }
        bulkReq[comp.input_product_id].requiredKg += totalKgNeeded;
        bulkReq[comp.input_product_id].mealCount += mealsNeeded;
      });
    });

    return bulkReq;
  }, [portionBoms, bomComponents, meals, stockMap, wipAvailable]);

  // Build unified rows
  const rows = useMemo(() => {
    const allIds = new Set([...Object.keys(wipAvailable), ...Object.keys(wipRequirements)]);
    return Array.from(allIds).map(id => {
      const wip = wipAvailable[id] || { name: wipRequirements[id]?.name || '?', sku: wipRequirements[id]?.sku || '?', totalKg: 0, batches: 0 };
      const req = wipRequirements[id] || { requiredKg: 0, mealCount: 0 };
      const netKg = wip.totalKg - req.requiredKg;
      return {
        id,
        name: wip.name,
        sku: wip.sku,
        availableKg: wip.totalKg,
        batchCount: wip.batches,
        requiredKg: req.requiredKg,
        mealCount: req.mealCount,
        netKg,
        needsCooking: netKg < 0,
        cookingNeededKg: Math.max(0, -netKg),
      };
    }).sort((a, b) => a.netKg - b.netKg); // show shortfalls first
  }, [wipAvailable, wipRequirements]);

  const shortfallCount = rows.filter(r => r.needsCooking).length;
  const isLoading = loadingBatches;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <ClipboardCheck className="w-6 h-6 text-primary" /> WIP-Aware Production Planning
        </h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Available approved WIP, today's meal-driven requirement, and net production need
        </p>
      </div>

      {/* Summary strip */}
      <div className="flex items-center gap-6 bg-card border border-border rounded-xl px-6 py-4 flex-wrap">
        <div>
          <p className="text-[10px] text-muted-foreground uppercase font-semibold">Bulk Products</p>
          <p className="text-lg font-bold">{rows.length}</p>
        </div>
        <div className="w-px h-8 bg-border" />
        <div>
          <p className="text-[10px] text-muted-foreground uppercase font-semibold">Need Cooking</p>
          <p className={`text-lg font-bold ${shortfallCount > 0 ? 'text-red-600' : 'text-green-600'}`}>{shortfallCount}</p>
        </div>
        <div className="w-px h-8 bg-border" />
        <div>
          <p className="text-[10px] text-muted-foreground uppercase font-semibold">Total WIP Available</p>
          <p className="text-lg font-bold">{Object.values(wipAvailable).reduce((s, w) => s + w.totalKg, 0).toFixed(1)} kg</p>
        </div>
      </div>

      {isLoading ? (
        <div className="text-center py-12 text-sm text-muted-foreground">Loading...</div>
      ) : rows.length === 0 ? (
        <div className="text-center py-12 text-sm text-muted-foreground">
          No WIP data available. Complete cooking runs to generate WIP batches.
        </div>
      ) : (
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="bg-muted/50 border-b border-border">
                <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase">Bulk Product</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-muted-foreground uppercase">Available (kg)</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-muted-foreground uppercase">Batches</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-muted-foreground uppercase">Required (kg)</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-muted-foreground uppercase">Meals</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-muted-foreground uppercase">Net (kg)</th>
                <th className="text-center px-4 py-3 text-xs font-semibold text-muted-foreground uppercase">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map(r => (
                <tr key={r.id} className={r.needsCooking ? 'bg-red-50/50 dark:bg-red-950/10' : ''}>
                  <td className="px-4 py-3">
                    <p className="text-sm font-medium">{r.name}</p>
                    <p className="text-[10px] font-mono text-muted-foreground">{r.sku}</p>
                  </td>
                  <td className="px-4 py-3 text-sm text-right tabular-nums font-medium">{r.availableKg.toFixed(1)}</td>
                  <td className="px-4 py-3 text-sm text-right tabular-nums text-muted-foreground">{r.batchCount}</td>
                  <td className="px-4 py-3 text-sm text-right tabular-nums">{r.requiredKg.toFixed(1)}</td>
                  <td className="px-4 py-3 text-sm text-right tabular-nums text-muted-foreground">{r.mealCount}</td>
                  <td className={`px-4 py-3 text-sm text-right tabular-nums font-bold ${r.netKg < 0 ? 'text-red-600' : 'text-green-600'}`}>
                    {r.netKg >= 0 ? '+' : ''}{r.netKg.toFixed(1)}
                  </td>
                  <td className="px-4 py-3 text-center">
                    {r.needsCooking ? (
                      <Badge className="bg-red-100 text-red-700 text-[10px] gap-1">
                        <AlertTriangle className="w-3 h-3" /> Cook {r.cookingNeededKg.toFixed(1)} kg
                      </Badge>
                    ) : (
                      <Badge className="bg-green-100 text-green-700 text-[10px] gap-1">
                        <CheckCircle2 className="w-3 h-3" /> OK
                      </Badge>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}