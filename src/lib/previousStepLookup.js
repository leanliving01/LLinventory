/**
 * previousStepLookup.js
 *
 * Finds the previous step's output for any production task in the cascade:
 *   Prep → Cook → Portion
 *
 * For Cook tasks (step > 1): the previous step is a Prep task on the same product.
 * For Portion tasks: reads LIVE WipBatch availability (the source of truth after
 *   portioning tasks consume from them).
 *
 * Returns { hasPreviousStep, previousStation, items: [...] }
 */

/**
 * Check if a task has a completed previous step and return availability info.
 *
 * @param {object} task - The current ProductionTask
 * @param {object[]} allTasks - All tasks in the run (not archived)
 * @param {object[]} allBoms - All active BOMs
 * @param {object[]} allBomComponents - All BOM components
 * @param {object[]} [wipBatches] - Optional: live WipBatch records for accurate portioning availability
 * @returns {{ hasPreviousStep: boolean, previousStation: string|null, items: Array<{ productId, productName, productSku, uom, requiredQty, availableQty }> }}
 */
export function getPreviousStepInfo(task, allTasks, allBoms, allBomComponents, wipBatches) {
  const empty = { hasPreviousStep: false, previousStation: null, items: [] };

  // Case 1: Cook after Prep — check if a prep task exists for the same product
  if (task.station === 'cook') {
    const prepTask = allTasks.find(
      t => t.station === 'prep' && t.product_id === task.product_id && !t.archived
    );
    if (prepTask && prepTask.status === 'done') {
      return {
        hasPreviousStep: true,
        previousStation: 'prep',
        items: [{
          productId: task.product_id,
          productName: task.meal_name || task.name || '',
          productSku: task.product_sku || '',
          uom: task.qty_uom || 'kg',
          requiredQty: prepTask.qty, // original BOM-derived requirement
          availableQty: task.qty, // cascaded actual yield from prep
        }],
      };
    }
    // No prep task or not done yet — no previous step
  }

  // Case 2: Portion — find cook tasks that produced the WIP bulk inputs
  if (task.station === 'portion') {
    // Find the portion BOM for this finished meal
    const portionBom = allBoms.find(b => b.product_id === task.product_id && b.bom_type === 'portion' && b.is_active !== false);
    if (!portionBom) return empty;

    // Get portion BOM components that are WIP bulk products
    const portionComps = allBomComponents.filter(c => c.bom_id === portionBom.id);
    
    // For each WIP bulk input, find the corresponding cook task
    const items = [];
    for (const comp of portionComps) {
      // Check if this input has a cook BOM (meaning it's a WIP bulk product made during the run)
      const hasCookBom = allBoms.some(b => b.product_id === comp.input_product_id && b.bom_type === 'cook' && b.is_active !== false);
      if (!hasCookBom) continue;

      // Find the cook task for this WIP product in the same run
      const cookTask = allTasks.find(
        t => t.product_id === comp.input_product_id && 
             (t.station === 'cook') && 
             t.status === 'done'
      );
      if (!cookTask) continue;

      // Calculate required qty from BOM scaling
      const perUnit = comp.qty / (portionBom.yield_qty || 1);
      const requiredQty = Math.round(perUnit * (task.qty || 1) * 100) / 100;

      // Use WipBatch as the source of truth for available qty (it gets deducted as portioning consumes).
      // Fall back to cook task qty only if wipBatches aren't provided.
      let availableQty = cookTask.qty;
      if (wipBatches && wipBatches.length > 0) {
        const productBatches = wipBatches.filter(
          b => b.bulk_product_id === comp.input_product_id &&
               (b.quality_status === 'fresh' || b.quality_status === 'use_today')
        );
        if (productBatches.length > 0) {
          availableQty = productBatches.reduce((sum, b) => sum + (b.qty_kg || 0), 0);
          availableQty = Math.round(availableQty * 100) / 100;
        }
      }

      items.push({
        productId: comp.input_product_id,
        productName: comp.input_product_name || '',
        productSku: comp.input_product_sku || '',
        uom: comp.uom || 'kg',
        requiredQty,
        availableQty,
        cookTaskName: cookTask.meal_name || cookTask.name || '',
      });
    }

    if (items.length > 0) {
      return { hasPreviousStep: true, previousStation: 'cook', items };
    }
  }

  return empty;
}