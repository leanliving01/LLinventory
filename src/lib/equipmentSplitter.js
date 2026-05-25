/**
 * Equipment-based task splitter.
 *
 * Given a list of base tasks (one per BOM operation), this splits any task
 * whose required quantity exceeds the equipment's capacity for that product
 * into multiple batch tasks.
 *
 * Priority order for capacity lookup:
 *   1. Product-specific EquipmentCapacity rule (equipment_id + product_id)
 *   2. Equipment default_capacity (from Equipment entity)
 *   3. No split (if neither is defined)
 *
 * @param {Array} tasks           – base tasks before splitting
 * @param {Array} equipmentList   – all Equipment records
 * @param {Array} capacityRules   – all EquipmentCapacity records
 * @param {Object} bomOpsMap      – { bomOpId: bomOperation } for equipment_id lookup
 * @returns {Array} final task list with batch_number / total_batches populated
 */
export function splitTasksByEquipment(tasks, equipmentList, capacityRules, bomOpsMap = {}) {
  // Build lookups
  const equipmentById = {};
  equipmentList.forEach(eq => { equipmentById[eq.id] = eq; });

  // capacityRules keyed by equipment_id:product_id
  const capByEqProduct = {};
  capacityRules.forEach(cap => {
    capByEqProduct[`${cap.equipment_id}:${cap.product_id}`] = cap;
  });

  const result = [];

  for (const task of tasks) {
    // Determine which equipment this task uses
    const equipmentId = task._equipment_id || null;
    const equipment = equipmentId ? equipmentById[equipmentId] : null;

    if (!equipment || !task.qty || task.qty <= 0) {
      // No equipment or no qty → no split
      result.push({ ...task, batch_number: 1, total_batches: 1 });
      continue;
    }

    // Find capacity: product-specific first, then equipment default
    const productCap = capByEqProduct[`${equipmentId}:${task.product_id}`];
    let maxCapacity = null;
    let capacityUom = null;
    let eqName = equipment.name;

    if (productCap && productCap.max_capacity > 0) {
      maxCapacity = productCap.max_capacity;
      capacityUom = productCap.capacity_uom;
    } else if (equipment.default_capacity && equipment.default_capacity > 0) {
      maxCapacity = equipment.default_capacity;
      capacityUom = equipment.default_capacity_uom;
    }

    if (!maxCapacity || task.qty <= maxCapacity) {
      // Fits in one batch
      result.push({
        ...task,
        batch_number: 1,
        total_batches: 1,
        equipment_id: equipmentId,
        equipment_name: eqName,
        qty_uom: capacityUom || task.qty_uom,
      });
      continue;
    }

    // Split into batches
    const totalBatches = Math.ceil(task.qty / maxCapacity);
    let remaining = task.qty;

    for (let b = 1; b <= totalBatches; b++) {
      const batchQty = Math.min(remaining, maxCapacity);
      remaining -= batchQty;

      result.push({
        ...task,
        name: `${task.name} (${b}/${totalBatches})`,
        qty: Math.round(batchQty * 100) / 100,
        qty_uom: capacityUom || task.qty_uom,
        batch_number: b,
        total_batches: totalBatches,
        equipment_id: equipmentId,
        equipment_name: eqName,
      });
    }
  }

  // Clean up internal fields
  return result.map(t => {
    const { _equipment_id, ...clean } = t;
    return clean;
  });
}