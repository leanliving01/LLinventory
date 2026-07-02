/**
 * Leftover raw-veg burn-down (Phase 2 of the 2026-07-01 planning logic).
 *
 * Turns "I have N kg of raw X to use up" into per-meal make targets that may
 * EXCEED par (the engine's burnDownQty). Two-level BOM traversal:
 *   finished_meal --portion BOM--> wip_bulk --cook BOM--> raw veg
 * so  per-meal veg kg = (veg kg per bulk kg) × (bulk kg per meal).
 *
 * Pure functions (no '@/' imports) so the engine stays node-testable.
 */

// Convert a BOM component qty to kg. Veg draws are weight (g/kg); L/ml treated as
// ~kg for water-based bulks. Non-weight uoms (pcs/box) return 0 → ignored.
function toKg(qty, uom) {
  const u = (uom || 'g').toLowerCase();
  if (u === 'kg' || u === 'l') return qty;
  if (u === 'g' || u === 'ml') return qty / 1000;
  return 0;
}

/**
 * Map, per raw veg, which finished meals draw it and how much per unit.
 *
 * @param {object} d
 * @param {Array}  d.rawVegProducts     - [{id, sku, name}] products with type='raw'
 * @param {object} d.portionByProductId - { mealId: portionBom }  (bom_type='portion')
 * @param {object} d.cookBomByProductId - { bulkId: cookBom }      (bom_type='cook')
 * @param {object} d.compsByBomId       - { bomId: [components] }
 * @param {object} d.productById        - { id: product }
 * @returns {object} { [vegId]: [{ mealId, mealSku, mealName, vegKgPerUnit }] } desc by draw
 */
export function buildVegToMealMap(d) {
  const { rawVegProducts = [], portionByProductId = {}, cookBomByProductId = {}, compsByBomId = {}, productById = {} } = d;
  const vegIds = new Set(rawVegProducts.map(v => v.id));

  // 1. veg kg per 1 kg of each bulk, from cook BOMs (yield_qty = kg bulk / batch).
  const vegKgPerBulkKg = {}; // { bulkId: { vegId: kgPerBulkKg } }
  for (const [bulkId, cookBom] of Object.entries(cookBomByProductId)) {
    const yield_ = cookBom.yield_qty || 1;
    for (const c of (compsByBomId[cookBom.id] || [])) {
      if (!vegIds.has(c.input_product_id)) continue;
      const kgPerBatch = toKg(c.qty || 0, c.uom);
      if (kgPerBatch <= 0) continue;
      (vegKgPerBulkKg[bulkId] ||= {});
      vegKgPerBulkKg[bulkId][c.input_product_id] =
        (vegKgPerBulkKg[bulkId][c.input_product_id] || 0) + kgPerBatch / yield_;
    }
  }

  // 2. walk each meal's portion BOM → its bulks → veg draw per unit of meal.
  //    Accumulate by (vegId, mealId) so a meal that draws the same veg through
  //    more than one bulk sums to a single per-unit figure (not duplicate homes).
  const agg = {}; // { vegId: { mealId: vegKgPerUnit } }
  for (const [mealId, pb] of Object.entries(portionByProductId)) {
    const yield_ = pb.yield_qty || 1;
    for (const c of (compsByBomId[pb.id] || [])) {
      const perVeg = vegKgPerBulkKg[c.input_product_id];
      if (!perVeg) continue; // component isn't a veg-bearing bulk
      const bulkKgPerMeal = toKg(c.qty || 0, c.uom) / yield_;
      if (bulkKgPerMeal <= 0) continue;
      for (const [vegId, kgPerBulkKg] of Object.entries(perVeg)) {
        const vegKgPerUnit = kgPerBulkKg * bulkKgPerMeal;
        if (vegKgPerUnit <= 0) continue;
        (agg[vegId] ||= {});
        agg[vegId][mealId] = (agg[vegId][mealId] || 0) + vegKgPerUnit;
      }
    }
  }
  const out = {};
  for (const [vegId, byMeal] of Object.entries(agg)) {
    out[vegId] = Object.entries(byMeal)
      .map(([mealId, vegKgPerUnit]) => {
        const meal = productById[mealId] || {};
        return { mealId, mealSku: meal.sku, mealName: meal.name, vegKgPerUnit };
      })
      .sort((a, b) => b.vegKgPerUnit - a.vegKgPerUnit);
  }
  return out;
}

/**
 * Turn burn-down entries into per-meal make targets + an allocation report.
 * Each veg burns into ONE meal (its chosen home, default = biggest draw).
 *
 * @param {Array}  entries      - [{ vegId, kg, mealId? }]
 * @param {object} vegToMealMap - from buildVegToMealMap
 * @returns {{ burnDownMap: object, allocations: Array }}
 *   burnDownMap = { [mealId]: targetUnits }; allocations describe each burn.
 */
export function computeBurnDown(entries, vegToMealMap) {
  const burnDownMap = {};
  const allocations = [];
  for (const e of (entries || [])) {
    const kg = Math.max(0, Number(e.kg) || 0);
    const homes = vegToMealMap[e.vegId] || [];
    if (kg <= 0 || homes.length === 0) continue;
    const home = (e.mealId && homes.find(h => h.mealId === e.mealId)) || homes[0];
    if (!home || home.vegKgPerUnit <= 0) continue;
    const units = Math.floor(kg / home.vegKgPerUnit);
    if (units <= 0) continue;
    // If two vegs target the same meal, take the larger target (avoid over-making).
    burnDownMap[home.mealId] = Math.max(burnDownMap[home.mealId] || 0, units);
    allocations.push({
      vegId: e.vegId, mealId: home.mealId, mealSku: home.mealSku, mealName: home.mealName,
      requestedKg: kg, units, kgPerUnit: home.vegKgPerUnit,
      kgAtTarget: Math.round(units * home.vegKgPerUnit * 10) / 10,
    });
  }
  return { burnDownMap, allocations };
}
