import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { explodeLinesToBulks, buildMachinePlan, buildProductionFlow } from '@/lib/productionEngine';

/**
 * Shared loader + compute for the machine-load plan. Both MachineLoadPanel and
 * the Livy plan-read use this so the data loads once (react-query dedupes on the
 * shared key) and they agree on the numbers.
 *
 * @param {Array} lines - [{ product_id, planned_qty }]
 * @returns {{ plan: object|null, flow: object|null, isLoading: boolean }}
 */
export function useMachinePlan(lines = []) {
  const { data, isLoading } = useQuery({
    queryKey: ['machine-load-data'],
    queryFn: async () => {
      const [portionBoms, bomComponents, cookBoms, products, equipment, capacities] = await Promise.all([
        base44.entities.Bom.filter({ bom_type: 'portion', is_active: true }, 'product_name', 200),
        base44.entities.BomComponent.list('bom_id', 2000),
        base44.entities.Bom.filter({ bom_type: 'cook', is_active: true }, 'product_name', 200),
        base44.entities.Product.filter({ status: 'active' }, 'name', 500),
        base44.entities.Equipment.list('name', 200),
        base44.entities.EquipmentCapacity.list('product_name', 1000),
      ]);
      return { portionBoms, bomComponents, cookBoms, products, equipment, capacities };
    },
    staleTime: 5 * 60 * 1000,
  });

  const plan = useMemo(() => {
    if (!data) return null;
    const portionByProductId = {};
    data.portionBoms.forEach((b) => { portionByProductId[b.product_id] = b; });
    const compsByBomId = {};
    data.bomComponents.forEach((c) => { (compsByBomId[c.bom_id] ||= []).push(c); });
    const cookBomByProductId = {};
    data.cookBoms.forEach((b) => { cookBomByProductId[b.product_id] = b; });
    const productById = {};
    data.products.forEach((p) => { productById[p.id] = p; });
    const capsByProduct = {};
    data.capacities.forEach((c) => { (capsByProduct[c.product_id] ||= []).push(c); });

    const wip = explodeLinesToBulks(lines, { portionByProductId, compsByBomId, cookBomByProductId, productById });
    return buildMachinePlan(wip, capsByProduct, data.equipment);
  }, [data, lines]);

  // Production flow (cook order + portioning-start) — fan-out counts only TODAY's
  // meals (the plan lines), so the order reflects what's actually being made.
  const flow = useMemo(() => {
    if (!data || !plan) return null;
    const skuById = {};
    data.products.forEach((p) => { skuById[p.id] = p.sku; });
    const isCookBulk = new Set(data.cookBoms.map((b) => b.product_id));
    const compsByBomId = {};
    data.bomComponents.forEach((c) => { (compsByBomId[c.bom_id] ||= []).push(c); });
    const portionByProductId = {};
    data.portionBoms.forEach((b) => { portionByProductId[b.product_id] = b; });

    const planMealIds = new Set(lines.map((l) => l.product_id));
    const fanOutBySku = {};
    const mealBulksBySku = {};
    for (const mealId of planMealIds) {
      const pb = portionByProductId[mealId];
      if (!pb) continue;
      const skus = [];
      for (const c of (compsByBomId[pb.id] || [])) {
        if (isCookBulk.has(c.input_product_id)) {
          const s = skuById[c.input_product_id];
          if (s) { skus.push(s); fanOutBySku[s] = (fanOutBySku[s] || 0) + 1; }
        }
      }
      mealBulksBySku[mealId] = skus;
    }
    return buildProductionFlow(plan, { fanOutBySku, mealBulksBySku });
  }, [data, plan, lines]);

  return { plan, flow, isLoading };
}
