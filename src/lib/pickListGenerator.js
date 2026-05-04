import { base44 } from '@/api/base44Client';

/**
 * Pick List Generation Logic (§10 Section C)
 *
 * Aggregates raw ingredients across Cook+Portion BOMs for a production run
 * and persists them as PickList + PickLine entities.
 *
 * All BOM aggregation happens in-memory to minimise API calls.
 *
 * @param {string} runId - ProductionRun ID
 * @param {object} run - ProductionRun record (must have run_date, run_number)
 * @returns {{ pickList, pickLines }} - created records
 */
export async function generatePickList(runId, run) {
  // 1. Check for existing pick list — prevent duplicates
  const existing = await base44.entities.PickList.filter({ production_run_id: runId }, '-created_date', 1);
  if (existing.length > 0) {
    throw new Error(`Pick list already exists for run ${run.run_number || runId}`);
  }

  // 2. Fetch all data in parallel (4 calls total)
  const [runLines, allBoms, allBomComponents, allProducts, allLocations] = await Promise.all([
    base44.entities.ProductionRunLine.filter({ run_id: runId }, 'product_sku', 200),
    base44.entities.Bom.filter({ is_active: true }, '-created_date', 500),
    base44.entities.BomComponent.list('-created_date', 2000),
    base44.entities.Product.filter({ status: 'active' }, 'name', 500),
    base44.entities.Location.list('name', 50),
  ]);

  if (runLines.length === 0) {
    throw new Error('No production run lines found for this run');
  }

  // 3. Build lookup maps
  const productMap = {};
  allProducts.forEach(p => { productMap[p.id] = p; });

  const locationMap = {};
  allLocations.forEach(l => { locationMap[l.id] = l; });

  const compsByBom = {};
  allBomComponents.forEach(c => {
    if (!compsByBom[c.bom_id]) compsByBom[c.bom_id] = [];
    compsByBom[c.bom_id].push(c);
  });

  // 4. Explode BOMs and aggregate ingredients
  // ingredientAgg: { [productId]: { product, totalQty, uom, isConsumable, fromLocationId } }
  const ingredientAgg = {};

  for (const line of runLines) {
    const qty = line.planned_qty;
    if (qty <= 0) continue;

    // Find portion BOM for this meal
    const portionBom = allBoms.find(b => b.product_id === line.product_id && b.bom_type === 'portion');
    if (!portionBom) continue;

    const portionComps = compsByBom[portionBom.id] || [];
    for (const comp of portionComps) {
      const inputProduct = productMap[comp.input_product_id];
      if (!inputProduct) continue;

      const portionYield = portionBom.yield_qty || 1;
      const neededPerUnit = comp.qty / portionYield;
      const totalNeeded = neededPerUnit * qty;

      if (inputProduct.type === 'wip_bulk') {
        // Explode cook BOM to get raw ingredients
        const cookBom = allBoms.find(b => b.product_id === inputProduct.id && b.bom_type === 'cook');
        if (cookBom) {
          const cookComps = compsByBom[cookBom.id] || [];
          const cookYield = cookBom.yield_qty || 1;
          for (const cc of cookComps) {
            const rawProduct = productMap[cc.input_product_id];
            if (!rawProduct) continue;
            const rawTotal = (cc.qty / cookYield) * totalNeeded;
            addIngredient(ingredientAgg, rawProduct, rawTotal, cc.uom || rawProduct.stock_uom, cc.is_consumable);
          }
        } else {
          // No cook BOM — treat WIP itself as the pick item
          addIngredient(ingredientAgg, inputProduct, totalNeeded, comp.uom || inputProduct.stock_uom, comp.is_consumable);
        }
      } else {
        // Direct raw or other ingredient
        addIngredient(ingredientAgg, inputProduct, totalNeeded, comp.uom || inputProduct.stock_uom, comp.is_consumable);
      }
    }
  }

  // 5. Filter: exclude packaging, zero-qty, sleeves/vacuum bags
  const EXCLUDE_TYPES = ['packaging'];
  const EXCLUDE_PATTERNS = ['sleeve', 'vacuum'];
  const lines = [];

  for (const [pid, agg] of Object.entries(ingredientAgg)) {
    const rounded = Math.round(agg.totalQty * 100) / 100;
    if (rounded <= 0) continue; // §F rule 5: zero-qty exclusion
    if (EXCLUDE_TYPES.includes(agg.product.type)) continue;
    const nameLower = (agg.product.name || '').toLowerCase();
    if (EXCLUDE_PATTERNS.some(pat => nameLower.includes(pat))) continue;

    const fromLocation = agg.product.default_location_id
      ? locationMap[agg.product.default_location_id]
      : null;

    lines.push({
      product_id: pid,
      product_sku: agg.product.sku || '',
      product_name: agg.product.name || '',
      category_group: agg.product.pick_category || 'Uncategorized',
      from_location_id: agg.product.default_location_id || '',
      from_location_name: fromLocation?.name || '',
      required_qty: rounded,
      required_uom: agg.uom,
      actual_qty_picked: 0,
      status: 'not_picked',
      is_consumable: agg.isConsumable || false,
    });
  }

  if (lines.length === 0) {
    throw new Error('No pickable ingredients found — check that recipes are set up for the meals in this run');
  }

  // 6. Create PickList entity
  const pickList = await base44.entities.PickList.create({
    production_run_id: runId,
    production_run_number: run.run_number || '',
    pick_date: run.run_date || new Date().toISOString().split('T')[0],
    status: 'open',
    total_lines: lines.length,
    released_lines: 0,
  });

  // 7. Create PickLine entities (batch)
  const pickLineData = lines.map(l => ({
    ...l,
    pick_list_id: pickList.id,
  }));

  const pickLines = await base44.entities.PickLine.bulkCreate(pickLineData);

  return { pickList, pickLines };
}

/** Helper: accumulate ingredient into the aggregation map */
function addIngredient(agg, product, qty, uom, isConsumable) {
  if (!agg[product.id]) {
    agg[product.id] = {
      product,
      totalQty: 0,
      uom,
      isConsumable: isConsumable || false,
    };
  }
  agg[product.id].totalQty += qty;
  // A component is consumable only if ALL occurrences are flagged consumable
  if (!isConsumable) {
    agg[product.id].isConsumable = false;
  }
}