import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';

const CATEGORY_ORDER = [
  'Meats', 'Vegetables', 'Starches', 'Spices & Seasoning',
  'Sauces & Condiments', 'Dairy & Eggs', 'Oils & Fats',
  'Dry Goods', 'Packaging', 'Other', 'Uncategorized',
];

const PICK_EXCLUDE_PATTERNS = ['sleeve', 'vacuum'];

/**
 * Shared hook: aggregates raw ingredients across Cook+Portion BOMs for a production run.
 * Returns { pickItems, categories, stockMap, isLoading }
 */
export default function usePickListData(runId) {
  const { data: lines = [], isLoading: l1 } = useQuery({
    queryKey: ['production-run-lines', runId],
    queryFn: () => base44.entities.ProductionRunLine.filter({ run_id: runId }, 'product_sku', 200),
    enabled: !!runId,
  });

  const { data: boms = [], isLoading: l2 } = useQuery({
    queryKey: ['boms-active'],
    queryFn: () => base44.entities.Bom.filter({ is_active: true }, '-created_date', 500),
  });

  const { data: bomComponents = [], isLoading: l3 } = useQuery({
    queryKey: ['bom-components'],
    queryFn: () => base44.entities.BomComponent.list('-created_date', 2000),
  });

  const { data: products = [], isLoading: l4 } = useQuery({
    queryKey: ['all-products'],
    queryFn: () => base44.entities.Product.filter({ status: 'active' }, 'name', 500),
  });

  const { data: stockRecords = [], isLoading: l5 } = useQuery({
    queryKey: ['stock-on-hand'],
    queryFn: () => base44.entities.StockOnHand.list('-updated_date', 1000),
  });

  const stockMap = useMemo(() => {
    const map = {};
    stockRecords.forEach(s => {
      if (!map[s.product_id]) map[s.product_id] = 0;
      map[s.product_id] += s.qty_on_hand || 0;
    });
    return map;
  }, [stockRecords]);

  const { pickItems, categories } = useMemo(() => {
    if (!lines.length || !boms.length || !bomComponents.length || !products.length) {
      return { pickItems: [], categories: [] };
    }

    const productMap = {};
    products.forEach(p => { productMap[p.id] = p; });

    const compsByBom = {};
    bomComponents.forEach(c => {
      if (!compsByBom[c.bom_id]) compsByBom[c.bom_id] = [];
      compsByBom[c.bom_id].push(c);
    });

    const ingredientAgg = {};

    for (const line of lines) {
      const qty = line.planned_qty;
      if (qty <= 0) continue;

      const portionBom = boms.find(b => b.product_id === line.product_id && b.bom_type === 'portion');
      if (!portionBom) continue;

      const portionComps = compsByBom[portionBom.id] || [];
      for (const comp of portionComps) {
        const inputProduct = productMap[comp.input_product_id];
        if (!inputProduct) continue;

        const portionYield = portionBom.yield_qty || 1;
        const neededPerUnit = comp.qty / portionYield;
        const totalNeeded = neededPerUnit * qty;

        if (inputProduct.type === 'wip_bulk') {
          const cookBom = boms.find(b => b.product_id === inputProduct.id && b.bom_type === 'cook');
          if (cookBom) {
            const cookComps = compsByBom[cookBom.id] || [];
            const cookYield = cookBom.yield_qty || 1;
            for (const cc of cookComps) {
              if (cc.is_consumable) continue;
              const rawProduct = productMap[cc.input_product_id];
              if (!rawProduct) continue;
              const rawTotal = (cc.qty / cookYield) * totalNeeded;
              if (!ingredientAgg[rawProduct.id]) {
                ingredientAgg[rawProduct.id] = { product: rawProduct, totalQty: 0, uom: cc.uom || rawProduct.stock_uom };
              }
              ingredientAgg[rawProduct.id].totalQty += rawTotal;
            }
          } else {
            if (!ingredientAgg[inputProduct.id]) {
              ingredientAgg[inputProduct.id] = { product: inputProduct, totalQty: 0, uom: comp.uom || inputProduct.stock_uom };
            }
            ingredientAgg[inputProduct.id].totalQty += totalNeeded;
          }
        } else {
          if (!ingredientAgg[inputProduct.id]) {
            ingredientAgg[inputProduct.id] = { product: inputProduct, totalQty: 0, uom: comp.uom || inputProduct.stock_uom };
          }
          ingredientAgg[inputProduct.id].totalQty += totalNeeded;
        }
      }
    }

    // Exclude non-pickable items
    for (const pid of Object.keys(ingredientAgg)) {
      const name = (ingredientAgg[pid].product.name || '').toLowerCase();
      if (PICK_EXCLUDE_PATTERNS.some(pat => name.includes(pat))) {
        delete ingredientAgg[pid];
      }
    }

    const items = Object.values(ingredientAgg).map(item => ({
      ...item,
      totalQty: Math.round(item.totalQty * 100) / 100,
      pickCategory: item.product.pick_category || 'Uncategorized',
    }));

    items.sort((a, b) => {
      const ai = CATEGORY_ORDER.indexOf(a.pickCategory);
      const bi = CATEGORY_ORDER.indexOf(b.pickCategory);
      if (ai !== bi) return ai - bi;
      return a.product.name.localeCompare(b.product.name);
    });

    const cats = [...new Set(items.map(i => i.pickCategory))];
    cats.sort((a, b) => CATEGORY_ORDER.indexOf(a) - CATEGORY_ORDER.indexOf(b));

    return { pickItems: items, categories: cats };
  }, [lines, boms, bomComponents, products]);

  return {
    pickItems,
    categories,
    stockMap,
    lines,
    isLoading: l1 || l2 || l3 || l4 || l5,
  };
}