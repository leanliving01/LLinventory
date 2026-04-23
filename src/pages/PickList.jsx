import React, { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ArrowLeft, Printer } from 'lucide-react';
import { cn } from '@/lib/utils';
import HelpDrawer from '@/components/help/HelpDrawer';

/**
 * §5.1.3 Master Pick List
 * Aggregates raw ingredients across Cook BOMs for a production run.
 * Groups by storage zone. Printer-friendly. Stock NOT deducted here.
 */
export default function PickList() {
  const runId = window.location.pathname.split('/').filter(Boolean).find((_, i, arr) => arr[i - 1] === 'run');

  const { data: run } = useQuery({
    queryKey: ['production-run', runId],
    queryFn: () => base44.entities.ProductionRun.filter({ id: runId }).then(r => r[0]),
    enabled: !!runId,
  });

  const { data: lines = [] } = useQuery({
    queryKey: ['production-run-lines', runId],
    queryFn: () => base44.entities.ProductionRunLine.filter({ run_id: runId }, 'product_sku', 200),
    enabled: !!runId,
  });

  // Load BOMs (Cook + Portion) and their components
  const { data: boms = [] } = useQuery({
    queryKey: ['boms-active'],
    queryFn: () => base44.entities.Bom.filter({ is_active: true }, '-created_date', 500),
  });

  const { data: bomComponents = [] } = useQuery({
    queryKey: ['bom-components'],
    queryFn: () => base44.entities.BomComponent.list('-created_date', 2000),
  });

  const { data: products = [] } = useQuery({
    queryKey: ['all-products'],
    queryFn: () => base44.entities.Product.filter({ status: 'active' }, 'name', 500),
  });

  const { data: locations = [] } = useQuery({
    queryKey: ['locations'],
    queryFn: () => base44.entities.Location.list('name', 50),
  });

  // Build ingredient pick list
  const { pickItems, zones } = useMemo(() => {
    if (!lines.length || !boms.length || !bomComponents.length || !products.length) {
      return { pickItems: [], zones: [] };
    }

    const productMap = {};
    products.forEach(p => { productMap[p.id] = p; });

    const locationMap = {};
    locations.forEach(l => { locationMap[l.id] = l; });

    // For each run line (finished meal), find its Portion BOM to get the WIP input,
    // then find the Cook BOM for that WIP to get raw ingredients
    const ingredientAgg = {}; // product_id → { product, totalQty, uom }

    const bomByProduct = {};
    boms.forEach(b => {
      const key = `${b.product_id}_${b.bom_type}`;
      bomByProduct[key] = b;
    });

    const compsByBom = {};
    bomComponents.forEach(c => {
      if (!compsByBom[c.bom_id]) compsByBom[c.bom_id] = [];
      compsByBom[c.bom_id].push(c);
    });

    for (const line of lines) {
      const qty = line.planned_qty;
      if (qty <= 0) continue;

      // 1. Find Portion BOM for this finished meal
      const portionBom = boms.find(b => b.product_id === line.product_id && b.bom_type === 'portion');
      if (portionBom) {
        const portionComps = compsByBom[portionBom.id] || [];
        for (const comp of portionComps) {
          // Each portion component is a WIP (bulk cooked) or raw ingredient
          const inputProduct = productMap[comp.input_product_id];
          if (!inputProduct) continue;

          const portionYield = portionBom.yield_qty || 1;
          const neededPerUnit = comp.qty / portionYield;
          const totalNeeded = neededPerUnit * qty;

          if (inputProduct.type === 'wip_bulk') {
            // 2. Find Cook BOM for this WIP to get raw ingredients
            const cookBom = boms.find(b => b.product_id === inputProduct.id && b.bom_type === 'cook');
            if (cookBom) {
              const cookComps = compsByBom[cookBom.id] || [];
              const cookYield = cookBom.yield_qty || 1;
              for (const cc of cookComps) {
                if (cc.is_consumable) continue;
                const rawProduct = productMap[cc.input_product_id];
                if (!rawProduct) continue;
                const rawPerUnit = cc.qty / cookYield;
                const rawTotal = rawPerUnit * totalNeeded;
                if (!ingredientAgg[rawProduct.id]) {
                  ingredientAgg[rawProduct.id] = { product: rawProduct, totalQty: 0, uom: cc.uom || rawProduct.stock_uom };
                }
                ingredientAgg[rawProduct.id].totalQty += rawTotal;
              }
            } else {
              // No cook BOM — treat the WIP itself as a pick item
              if (!ingredientAgg[inputProduct.id]) {
                ingredientAgg[inputProduct.id] = { product: inputProduct, totalQty: 0, uom: comp.uom || inputProduct.stock_uom };
              }
              ingredientAgg[inputProduct.id].totalQty += totalNeeded;
            }
          } else {
            // Direct raw/packaging ingredient in portion BOM
            if (!ingredientAgg[inputProduct.id]) {
              ingredientAgg[inputProduct.id] = { product: inputProduct, totalQty: 0, uom: comp.uom || inputProduct.stock_uom };
            }
            ingredientAgg[inputProduct.id].totalQty += totalNeeded;
          }
        }
      }
    }

    // Exclude items that don't need picking (sleeves are at the production line, vacuum skin is on the machine)
    const PICK_EXCLUDE_PATTERNS = ['sleeve', 'vacuum'];
    for (const pid of Object.keys(ingredientAgg)) {
      const name = (ingredientAgg[pid].product.name || '').toLowerCase();
      if (PICK_EXCLUDE_PATTERNS.some(pat => name.includes(pat))) {
        delete ingredientAgg[pid];
      }
    }

    // Group by storage zone
    const items = Object.values(ingredientAgg).map(item => {
      const loc = item.product.default_location_id ? locationMap[item.product.default_location_id] : null;
      return {
        ...item,
        totalQty: Math.round(item.totalQty * 100) / 100,
        zone: loc?.name || 'Unassigned',
        zoneType: loc?.type || 'ambient',
        zoneCode: loc?.code || '—',
      };
    });

    items.sort((a, b) => a.zone.localeCompare(b.zone) || a.product.name.localeCompare(b.product.name));
    const uniqueZones = [...new Set(items.map(i => i.zone))];

    return { pickItems: items, zones: uniqueZones };
  }, [lines, boms, bomComponents, products, locations]);

  if (!run) {
    return <div className="text-center py-12 text-sm text-muted-foreground">Loading...</div>;
  }

  return (
    <div className="space-y-4 print:space-y-2">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3 print:hidden">
        <div className="flex items-center gap-3">
          <Link to={`/production/run/${runId}`}>
            <Button variant="ghost" size="icon"><ArrowLeft className="w-4 h-4" /></Button>
          </Link>
          <div>
            <h1 className="text-2xl font-bold">Pick List — {run.run_number}</h1>
            <p className="text-sm text-muted-foreground mt-0.5">{lines.length} meals · {pickItems.length} ingredients across {zones.length} zones</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <HelpDrawer pageKey="pick-list" />
          <Button variant="outline" onClick={() => window.print()} className="gap-1.5">
            <Printer className="w-4 h-4" /> Print
          </Button>
        </div>
      </div>

      {/* Print header */}
      <div className="hidden print:block">
        <h1 className="text-xl font-bold">Pick List — {run.run_number}</h1>
        <p className="text-sm">{lines.length} meals · {pickItems.length} ingredients</p>
      </div>

      <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-2.5 text-sm text-amber-800 print:hidden">
        Stock is <strong>not</strong> deducted when printing the pick list — only when the run is completed.
      </div>

      {/* Grouped by zone */}
      {zones.map(zone => {
        const zoneItems = pickItems.filter(i => i.zone === zone);
        return (
          <div key={zone} className="bg-card border border-border rounded-xl overflow-hidden print:break-inside-avoid print:rounded-none print:border-black">
            <div className="px-4 py-2.5 border-b border-border bg-muted/50 flex items-center gap-2">
              <h3 className="text-sm font-bold">{zone}</h3>
              <Badge variant="secondary" className="text-[10px]">{zoneItems.length} items</Badge>
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left px-4 py-2 font-medium text-muted-foreground w-8">✓</th>
                  <th className="text-left px-4 py-2 font-medium text-muted-foreground">SKU</th>
                  <th className="text-left px-4 py-2 font-medium text-muted-foreground">Ingredient</th>
                  <th className="text-right px-4 py-2 font-medium text-muted-foreground">Qty Needed</th>
                  <th className="text-left px-4 py-2 font-medium text-muted-foreground">UoM</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {zoneItems.map(item => (
                  <tr key={item.product.id} className="print:leading-8">
                    <td className="px-4 py-2">
                      <div className="w-5 h-5 border-2 border-border rounded print:border-black" />
                    </td>
                    <td className="px-4 py-2 font-mono text-xs text-muted-foreground">{item.product.sku}</td>
                    <td className="px-4 py-2 font-medium">{item.product.name}</td>
                    <td className="px-4 py-2 text-right font-bold tabular-nums">{item.totalQty.toLocaleString()}</td>
                    <td className="px-4 py-2 text-muted-foreground">{item.uom}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      })}

      {pickItems.length === 0 && (
        <div className="bg-card border border-border rounded-xl px-6 py-12 text-center text-sm text-muted-foreground">
          No ingredients found — check that recipes (Cook + Portion BOMs) are set up for the meals in this run.
        </div>
      )}
    </div>
  );
}