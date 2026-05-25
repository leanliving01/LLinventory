import React, { useMemo, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { TrendingUp, ChefHat, Check } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * End-of-day surplus plating calculator.
 * Takes all surplus WIP yields, looks at portion BOMs, and suggests
 * how many extra plates can be made from the available surplus.
 */
export default function SurplusPlating({ tasks, runLines, boms, components, products, runId }) {
  const [selectedMeals, setSelectedMeals] = useState({});

  const productMap = useMemo(() => {
    const m = {};
    products.forEach(p => { m[p.id] = p; });
    return m;
  }, [products]);

  // Step 1: Calculate surplus WIP per product from completed cook/prep tasks
  const surplusWip = useMemo(() => {
    const wipMap = {}; // product_id → surplus qty in stock_uom

    const relevantTasks = tasks.filter(t =>
      (t.station === 'cook' || t.station === 'prep') && t.product_id && t.status === 'done'
    );

    // Group by product
    const grouped = {};
    for (const t of relevantTasks) {
      if (!grouped[t.product_id]) grouped[t.product_id] = [];
      grouped[t.product_id].push(t);
    }

    for (const [productId, groupTasks] of Object.entries(grouped)) {
      let totalPlanned = 0;
      let totalActual = 0;
      let hasActual = false;

      for (const t of groupTasks) {
        totalPlanned += t.qty || 0;
        const yieldMatch = t.notes?.match(/Yield:\s*([\d.]+)/);
        if (yieldMatch) {
          totalActual += parseFloat(yieldMatch[1]);
          hasActual = true;
        } else {
          totalActual += t.qty || 0;
        }
      }

      const surplus = Math.round((totalActual - totalPlanned) * 100) / 100;
      if (hasActual && surplus > 0.01) {
        const product = productMap[productId];
        wipMap[productId] = {
          product_id: productId,
          name: groupTasks[0].meal_name || product?.name || 'Unknown',
          sku: product?.sku || '',
          uom: groupTasks[0].qty_uom || product?.stock_uom || '',
          surplus,
        };
      }
    }

    return wipMap;
  }, [tasks, productMap]);

  // Step 2: Find portion BOMs that use surplus WIP as input
  const platingSuggestions = useMemo(() => {
    const surplusProductIds = Object.keys(surplusWip);
    if (surplusProductIds.length === 0) return [];

    // Get portion BOMs
    const portionBoms = boms.filter(b => b.bom_type === 'portion' && b.is_active !== false);

    const suggestions = [];
    for (const bom of portionBoms) {
      const bomComps = components.filter(c => c.bom_id === bom.id);
      // Check if any input is a surplus WIP product
      const surplusInputs = bomComps.filter(c => surplusWip[c.input_product_id]);
      if (surplusInputs.length === 0) continue;

      const yieldQty = bom.yield_qty || 1;
      const outputProduct = productMap[bom.product_id];

      // For each surplus input, calculate how many extra plates we could make
      // The bottleneck is the input with the fewest extra plates possible
      let maxPlates = Infinity;
      const inputDetails = [];

      for (const comp of surplusInputs) {
        const surplus = surplusWip[comp.input_product_id];
        const perPlate = comp.qty / yieldQty;
        if (perPlate <= 0) continue;
        const possiblePlates = Math.floor(surplus.surplus / perPlate);
        maxPlates = Math.min(maxPlates, possiblePlates);
        inputDetails.push({
          name: surplus.name,
          surplus: surplus.surplus,
          uom: surplus.uom,
          perPlate: Math.round(perPlate * 100) / 100,
          possiblePlates,
        });
      }

      // Check non-surplus inputs — these need to be available from existing stock
      const nonSurplusInputs = bomComps.filter(c => !surplusWip[c.input_product_id] && !c.is_consumable);

      if (maxPlates > 0 && maxPlates !== Infinity) {
        suggestions.push({
          bom_id: bom.id,
          product_id: bom.product_id,
          mealName: bom.product_name || outputProduct?.name || 'Unknown',
          mealSku: bom.product_sku || outputProduct?.sku || '',
          maxPlates,
          inputDetails,
          nonSurplusInputs: nonSurplusInputs.map(c => ({
            name: c.input_product_name || productMap[c.input_product_id]?.name || 'Unknown',
            qtyPerPlate: Math.round((c.qty / yieldQty) * 100) / 100,
            uom: c.uom,
            totalNeeded: Math.round((c.qty / yieldQty) * maxPlates * 100) / 100,
          })),
        });
      }
    }

    return suggestions.sort((a, b) => b.maxPlates - a.maxPlates);
  }, [surplusWip, boms, components, productMap]);

  const hasSurplus = Object.keys(surplusWip).length > 0;

  if (!hasSurplus) {
    return (
      <div className="bg-card border border-border rounded-xl p-5">
        <div className="flex items-center gap-2 mb-1">
          <TrendingUp className="w-5 h-5 text-green-500" />
          <h3 className="text-sm font-bold">Surplus Plating</h3>
        </div>
        <p className="text-xs text-muted-foreground">
          No surplus yield detected yet. When cook tasks yield more than planned, surplus plating suggestions will appear here.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Surplus WIP summary */}
      <div>
        <h3 className="text-sm font-bold flex items-center gap-2 mb-2">
          <TrendingUp className="w-4 h-4 text-green-500" />
          Surplus WIP Available
        </h3>
        <div className="flex gap-2 flex-wrap">
          {Object.values(surplusWip).map(wip => (
            <Badge
              key={wip.product_id}
              variant="outline"
              className="bg-green-50 text-green-700 border-green-200 dark:bg-green-950 dark:text-green-400 dark:border-green-800"
            >
              {wip.name}: +{wip.surplus} {wip.uom}
            </Badge>
          ))}
        </div>
      </div>

      {/* Plating suggestions */}
      {platingSuggestions.length > 0 ? (
        <div className="space-y-3">
          <div>
            <h3 className="text-sm font-bold flex items-center gap-2">
              <ChefHat className="w-4 h-4 text-primary" />
              Extra Plates Possible
            </h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              Based on surplus WIP, these meals can be plated. Non-surplus ingredients still need stock.
            </p>
          </div>

          {platingSuggestions.map(s => {
            const isSelected = !!selectedMeals[s.bom_id];
            return (
              <div
                key={s.bom_id}
                className={cn(
                  'rounded-xl border p-4 space-y-3 transition-colors',
                  isSelected
                    ? 'border-primary bg-primary/5'
                    : 'border-border bg-card'
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-bold truncate">{s.mealName}</p>
                    {s.mealSku && (
                      <p className="text-[10px] font-mono text-muted-foreground">{s.mealSku}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Badge className="bg-green-600 text-white border-0">
                      +{s.maxPlates} plates
                    </Badge>
                    <Button
                      size="sm"
                      variant={isSelected ? 'default' : 'outline'}
                      className="h-8 gap-1"
                      onClick={() => setSelectedMeals(prev => {
                        const next = { ...prev };
                        if (next[s.bom_id]) delete next[s.bom_id];
                        else next[s.bom_id] = { ...s };
                        return next;
                      })}
                    >
                      {isSelected ? <Check className="w-3 h-3" /> : null}
                      {isSelected ? 'Selected' : 'Select'}
                    </Button>
                  </div>
                </div>

                {/* Surplus input breakdown */}
                <div className="space-y-1">
                  <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                    Surplus ingredients used
                  </p>
                  {s.inputDetails.map((inp, i) => (
                    <div key={i} className="flex items-center justify-between text-xs">
                      <span className="text-muted-foreground">{inp.name}</span>
                      <span className="font-medium text-green-600">
                        {inp.perPlate} {inp.uom}/plate × {s.maxPlates} = {Math.round(inp.perPlate * s.maxPlates * 100) / 100} {inp.uom}
                      </span>
                    </div>
                  ))}
                </div>

                {/* Non-surplus inputs needed */}
                {s.nonSurplusInputs.length > 0 && (
                  <div className="space-y-1">
                    <p className="text-[10px] font-semibold text-amber-600 uppercase tracking-wider">
                      Also needed from stock
                    </p>
                    {s.nonSurplusInputs.map((inp, i) => (
                      <div key={i} className="flex items-center justify-between text-xs">
                        <span className="text-muted-foreground">{inp.name}</span>
                        <span className="font-medium">{inp.totalNeeded} {inp.uom}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}

          {/* Summary of selection */}
          {Object.keys(selectedMeals).length > 0 && (
            <div className="bg-primary/10 border border-primary/20 rounded-xl p-4">
              <p className="text-xs font-semibold text-primary uppercase tracking-wider mb-2">
                Selected for plating
              </p>
              {Object.values(selectedMeals).map(s => (
                <div key={s.bom_id} className="flex items-center justify-between text-sm">
                  <span className="font-medium">{s.mealName}</span>
                  <span className="font-bold text-primary">+{s.maxPlates} plates</span>
                </div>
              ))}
              <p className="text-[10px] text-muted-foreground mt-2">
                Assign these to the portioning station to plate the surplus.
              </p>
            </div>
          )}
        </div>
      ) : (
        <div className="bg-card border border-border rounded-xl p-4">
          <p className="text-xs text-muted-foreground">
            Surplus WIP exists but no matching portion recipes were found.
          </p>
        </div>
      )}
    </div>
  );
}