import { base44 } from '@/api/base44Client';
import { format } from 'date-fns';

/**
 * Generate draft CookingRun records for WIP bulk products required by a production run's lines.
 *
 * Walks each line's Portion BOM → finds WIP components → looks up Cook BOM → creates one
 * CookingRun per unique WIP product. Returns the count of cooking runs created.
 *
 * @param {string} runId - ProductionRun ID
 * @param {Array} runLines - Array of { product_id, planned_qty, ... }
 * @param {string} runDate - YYYY-MM-DD
 * @returns {Promise<number>} Number of cooking runs created
 */
export async function generateCookingRunsForRun(runId, runLines, runDate) {
  const [portionBoms, bomComponents, cookBoms, products] = await Promise.all([
    base44.entities.Bom.filter({ bom_type: 'portion', is_active: true }, 'product_name', 200),
    base44.entities.BomComponent.list('bom_id', 2000),
    base44.entities.Bom.filter({ bom_type: 'cook', is_active: true }, 'product_name', 200),
    base44.entities.Product.filter({ status: 'active' }, 'name', 500),
  ]);

  const bomByProductId = {};
  portionBoms.forEach(b => { bomByProductId[b.product_id] = b; });

  const compsByBomId = {};
  bomComponents.forEach(c => {
    if (!compsByBomId[c.bom_id]) compsByBomId[c.bom_id] = [];
    compsByBomId[c.bom_id].push(c);
  });

  const cookBomByProductId = {};
  cookBoms.forEach(b => { cookBomByProductId[b.product_id] = b; });

  const productById = {};
  products.forEach(p => { productById[p.id] = p; });

  // Aggregate WIP qty needed per bulk product (in kg)
  const wipNeeded = {}; // { productId: { kg, name, sku, cookBomId } }

  for (const line of runLines) {
    const portionBom = bomByProductId[line.product_id];
    if (!portionBom) continue;

    const comps = compsByBomId[portionBom.id] || [];
    const bomYield = portionBom.yield_qty || 1;

    for (const comp of comps) {
      const cookBom = cookBomByProductId[comp.input_product_id];
      if (!cookBom) continue; // not a WIP product

      const uom = (comp.uom || 'g').toLowerCase();
      const qtyRaw = comp.qty || 0;
      const qtyInKg = uom === 'kg' ? qtyRaw : uom === 'g' ? qtyRaw / 1000 : qtyRaw;
      const perMealKg = qtyInKg / bomYield;
      const totalKg = perMealKg * (line.planned_qty || 0);

      if (!wipNeeded[comp.input_product_id]) {
        const prod = productById[comp.input_product_id];
        wipNeeded[comp.input_product_id] = {
          kg: 0,
          name: prod?.name || comp.input_product_name || 'Unknown',
          sku: prod?.sku || comp.input_product_sku || '',
          cookBomId: cookBom.id,
          rawCostPerKg: prod?.cost_avg || 0,
          bomExpectedYieldPct: cookBom.yield_qty || 1,
        };
      }
      wipNeeded[comp.input_product_id].kg += totalKg;
    }
  }

  // Create a draft CookingRun for each WIP product
  const entries = Object.entries(wipNeeded).filter(([, v]) => v.kg > 0);
  if (entries.length === 0) return 0;

  // Generate run numbers
  const existingCRs = await base44.entities.CookingRun.list('-created_date', 1);
  const lastNum = existingCRs.length > 0
    ? parseInt((existingCRs[0].run_number || '').replace(/\D/g, '') || '0')
    : 0;

  const year = format(new Date(), 'yyyy');
  const cookingRuns = entries.map(([productId, data], idx) => ({
    run_number: `COOK-${year}-${String(year) + String(lastNum + idx + 1).padStart(4, '0')}`,
    run_type: 'standard',
    status: 'draft',
    run_date: runDate,
    bulk_product_id: productId,
    bulk_product_name: data.name,
    bulk_product_sku: data.sku,
    cook_bom_id: data.cookBomId,
    target_output_kg: Math.round(data.kg * 1000) / 1000,
    raw_cost_per_kg: data.rawCostPerKg,
    bom_expected_yield_pct: data.bomExpectedYieldPct,
    total_wastage_kg: 0,
    production_run_id: runId,
    contributing_run_ids: JSON.stringify([runId]),
  }));

  // Bulk create in batches of 25
  for (let i = 0; i < cookingRuns.length; i += 25) {
    await base44.entities.CookingRun.bulkCreate(cookingRuns.slice(i, i + 25));
  }

  return cookingRuns.length;
}