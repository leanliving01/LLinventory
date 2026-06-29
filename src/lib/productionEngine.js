/**
 * Production Planning engine — the deterministic "judgment brain".
 *
 * Replaces the naive `Math.max(0, par - available)` recommendation with the
 * rules Thys locked on 29/06/2026:
 *
 *   1. Backorder (committed > on-hand) → ALWAYS produce, even 1 unit. Clears the
 *      negative and rebuilds toward par.
 *   2. Below par → only if more than 10% below par. Within 10% → skip (not worth
 *      a batch). Meals only (packages are built from meals).
 *   3. Produce-to target = back to par, THEN clamp to a 6-day forward-cover cap
 *      (6 × daily sales velocity). Stops over-building slow meals whose par
 *      implies many days of cover. No velocity data → the cap doesn't bite.
 *
 * Numbers only — no LLM. Livy narrates the OUTPUT; it never invents the maths.
 * (See PRODUCTION_PLANNING_AGENT_BRIEF.md.)
 */

export const PLANNING_DEFAULTS = {
  belowParTriggerPct: 0.10, // must be > this fraction below par to trigger
  forwardCoverDays: 6,      // max days of sales to hold for a fresh meal
};

/**
 * Recommend how many units of a single meal to produce.
 *
 * @param {object} a
 * @param {number} a.par         - products.par_level
 * @param {number} a.onHand      - total qty_on_hand across locations
 * @param {number} a.committed   - total qty_committed (paid-unfulfilled, exploded)
 * @param {number} [a.weeklyRate]- units sold/week (inventory_trends.weekly_rate)
 * @param {object} [a.options]   - { belowParTriggerPct, forwardCoverDays }
 * @returns {{ recommended:number, reason:string, capped:boolean, available:number,
 *            backorderShortfall:number, rawQty:number, coverCapOnHand:number }}
 */
export function recommendMealQty({ par = 0, onHand = 0, committed = 0, weeklyRate = 0, options = {} }) {
  const belowParTriggerPct = options.belowParTriggerPct ?? PLANNING_DEFAULTS.belowParTriggerPct;
  const forwardCoverDays = options.forwardCoverDays ?? PLANNING_DEFAULTS.forwardCoverDays;

  const available = onHand - committed;
  const backorderShortfall = Math.max(0, committed - onHand); // units owed beyond stock
  const isBackorder = backorderShortfall > 0;

  // ── 1+2. Trigger gate ──────────────────────────────────────────────────────
  let reason;
  let shouldProduce = false;
  if (isBackorder) {
    shouldProduce = true;
    reason = 'backorder';
  } else if (par > 0 && available < par) {
    const gapPct = (par - available) / par;
    if (gapPct > belowParTriggerPct) {
      shouldProduce = true;
      reason = 'below_par';
    } else {
      reason = 'within_10pct'; // close enough to par — skip
    }
  } else {
    reason = par > 0 ? 'at_par' : 'no_par';
  }

  if (!shouldProduce) {
    return { recommended: 0, reason, capped: false, available, backorderShortfall, rawQty: 0, coverCapOnHand: Infinity };
  }

  // Raw target: rebuild `available` up to par (covers a backorder automatically,
  // since available is negative when committed > on-hand).
  const rawQty = Math.max(0, par - available);

  // ── 3. 6-day forward-cover cap on total on-hand ────────────────────────────
  const dailyRate = weeklyRate > 0 ? weeklyRate / 7 : 0;
  const coverCapOnHand = dailyRate > 0 ? Math.ceil(forwardCoverDays * dailyRate) : Infinity;
  // Never cap below what we owe (committed must always be coverable).
  const capOnHand = Math.max(committed, coverCapOnHand);
  const qtyCap = Math.max(0, capOnHand - onHand);

  let recommended = Math.min(rawQty, qtyCap);
  // A real backorder is always fully covered, even if the cap would trim it.
  recommended = Math.max(recommended, backorderShortfall);
  recommended = Math.round(recommended);

  const capped = recommended < rawQty;
  return { recommended, reason, capped, available, backorderShortfall, rawQty, coverCapOnHand };
}

/**
 * Advisory par-level suggestion (two-way: raise if understocked, lower if
 * overstocked). Pars stay exactly as set — this only PROPOSES; the user accepts
 * or leaves it. Based on a target days-of-cover against real sales velocity, and
 * only surfaced when the current par diverges materially (so well-set pars are
 * left alone).
 *
 * @param {object} a
 * @param {number} a.par              - current products.par_level
 * @param {number} a.weeklyRate       - units/week (inventory_trends.weekly_rate)
 * @param {number} [a.targetCoverDays]- days of stock a par should represent (def 7)
 * @param {number} [a.divergencePct]  - only suggest if off by more than this (def 0.20)
 * @returns {{ show:boolean, suggested:number, direction:'raise'|'lower'|null, coverDaysAtPar:number|null }}
 */
export function suggestParLevel({ par = 0, weeklyRate = 0, targetCoverDays = 7, divergencePct = 0.20 }) {
  const dailyRate = weeklyRate > 0 ? weeklyRate / 7 : 0;
  if (dailyRate <= 0) return { show: false, suggested: par, direction: null, coverDaysAtPar: null };

  const suggested = Math.round(dailyRate * targetCoverDays);
  const coverDaysAtPar = par > 0 ? Math.round((par / dailyRate) * 10) / 10 : 0;

  // Don't suggest a change that's immaterial, or a pointless 0.
  if (suggested <= 0) return { show: false, suggested: par, direction: null, coverDaysAtPar };
  const diff = Math.abs(suggested - par);
  const base = par > 0 ? par : suggested;
  if (diff / base <= divergencePct) return { show: false, suggested, direction: null, coverDaysAtPar };

  return {
    show: true,
    suggested,
    direction: suggested > par ? 'raise' : 'lower',
    coverDaysAtPar,
  };
}

// ── Machine-load breakdown ───────────────────────────────────────────────────
// Explodes the planned meals into bulk kg (via portion BOMs), then schedules
// each bulk onto its machine using the equipment_capacities written for it, and
// rolls up per-machine load + utilisation. The wet line is a POOL (chef's call):
// we RECOMMEND tilting for > 20 kg runs, Ivario for ≤ 20 kg. Ovens run ~2 roast
// + 2 steam (flex).

/**
 * Aggregate planned meal lines into cooked-kg per bulk (shared bulks combine).
 * Mirrors lib/cookingRunGenerator.js so the numbers match the cooking runs.
 *
 * @param {Array}  lines  - [{ product_id, planned_qty }]
 * @param {object} d      - { portionByProductId, compsByBomId, cookBomByProductId, productById }
 * @returns {object} { [bulkId]: { kg, name, sku } }
 */
export function explodeLinesToBulks(lines, d) {
  const { portionByProductId, compsByBomId, cookBomByProductId, productById } = d;
  const wip = {};
  for (const line of lines) {
    const pb = portionByProductId[line.product_id];
    if (!pb) continue;
    const comps = compsByBomId[pb.id] || [];
    const yield_ = pb.yield_qty || 1;
    for (const comp of comps) {
      if (!cookBomByProductId[comp.input_product_id]) continue; // not a bulk
      const uom = (comp.uom || 'g').toLowerCase();
      const qty = comp.qty || 0;
      const kgEach = uom === 'kg' ? qty : uom === 'g' ? qty / 1000 : qty;
      const totalKg = (kgEach / yield_) * (line.planned_qty || 0);
      if (!wip[comp.input_product_id]) {
        const p = productById[comp.input_product_id];
        wip[comp.input_product_id] = { kg: 0, name: p?.name || comp.input_product_name || '—', sku: p?.sku || '' };
      }
      wip[comp.input_product_id].kg += totalKg;
    }
  }
  return wip;
}

const isOvenName = (n = '') => /oven|rational/i.test(n);
const isIvarioName = (n = '') => /ivario/i.test(n);

/**
 * Schedule exploded bulks onto machines and roll up per-machine load.
 *
 * @param {object} wipNeeded   - { [bulkId]: { kg, name, sku } }
 * @param {object} capsByProduct - { [bulkId]: [equipment_capacities rows] }
 * @param {Array}  equipment   - equipment rows (for oven count)
 * @param {object} [options]   - { cookWindowMin=480, ovenSplit={roast:2,steam:2} }
 * @returns {{ groups:Array, unscheduled:Array }}
 */
export function buildMachinePlan(wipNeeded, capsByProduct, equipment = [], options = {}) {
  const cookWindowMin = options.cookWindowMin || 480;
  const ovenUnits = equipment.filter((e) => isOvenName(e.name) || /oven/i.test(e.equipment_type || '')).length || 4;
  const ovenSplit = options.ovenSplit || { roast: Math.ceil(ovenUnits / 2), steam: Math.floor(ovenUnits / 2) };

  // group key → accumulator
  const G = {
    IVARIO:      { key: 'IVARIO', label: 'Ivario (wet ≤20 kg)', units: 1, cookWindowMin, kg: 0, batches: 0, cookMin: 0, bulks: [] },
    TILT:        { key: 'TILT',   label: 'Tilting Pan (wet >20 kg)', units: 1, cookWindowMin, kg: 0, batches: 0, cookMin: 0, bulks: [] },
    'OVEN-ROAST':{ key: 'OVEN-ROAST', label: `Ovens · roast (×${ovenSplit.roast})`, units: ovenSplit.roast, cookWindowMin, kg: 0, batches: 0, cookMin: 0, bulks: [] },
    'OVEN-STEAM':{ key: 'OVEN-STEAM', label: `Ovens · steam (×${ovenSplit.steam})`, units: ovenSplit.steam, cookWindowMin, kg: 0, batches: 0, cookMin: 0, bulks: [] },
  };
  const unscheduled = [];

  for (const [bulkId, info] of Object.entries(wipNeeded)) {
    const kg = Math.round((info.kg || 0) * 100) / 100;
    if (kg <= 0) continue;
    const caps = capsByProduct[bulkId] || [];
    if (caps.length === 0) { unscheduled.push({ ...info, kg, reason: 'no capacity set' }); continue; }

    const ovenCap = caps.find((c) => isOvenName(c.equipment_name));
    let groupKey, maxBatch, cycle;
    if (ovenCap) {
      const mode = /roast/i.test(ovenCap.notes || '') ? 'roast' : 'steam';
      groupKey = mode === 'roast' ? 'OVEN-ROAST' : 'OVEN-STEAM';
      maxBatch = Number(ovenCap.max_capacity) || 0;
      cycle = Number(ovenCap.cycle_time_min) || 0;
    } else {
      // wet: pick by run size (recommendation; chef can switch)
      const ivario = caps.find((c) => isIvarioName(c.equipment_name));
      const tilt = caps.find((c) => !isIvarioName(c.equipment_name));
      const useTilt = kg > 20 && tilt;
      const chosen = useTilt ? tilt : (ivario || tilt);
      groupKey = useTilt ? 'TILT' : 'IVARIO';
      maxBatch = Number(chosen?.max_capacity) || 0;
      cycle = Number(chosen?.cycle_time_min) || 0;
    }

    const batches = maxBatch > 0 ? Math.ceil(kg / maxBatch) : 1;
    const cookMin = batches * cycle;
    const g = G[groupKey];
    g.kg += kg; g.batches += batches; g.cookMin += cookMin;
    g.bulks.push({ name: info.name, sku: info.sku, kg, batches, cookMin });
  }

  const groups = Object.values(G)
    .filter((g) => g.bulks.length > 0)
    .map((g) => {
      const capacityMin = g.units * g.cookWindowMin;
      const utilisationPct = capacityMin > 0 ? Math.round((g.cookMin / capacityMin) * 100) : 0;
      return { ...g, capacityMin, utilisationPct, over: g.cookMin > capacityMin,
               bulks: g.bulks.sort((a, b) => b.kg - a.kg) };
    });

  return { groups, unscheduled };
}

/**
 * Build the per-meal recommendation map for a list of meals.
 *
 * @param {Array}  meals      - finished_meal products ({ id, par_level, ... })
 * @param {object} stockMap   - { [productId]: { qty_on_hand, qty_committed } }
 * @param {object} velocityMap- { [productId]: weeklyRate }
 * @param {object} [options]
 * @returns {object} { [productId]: result-from-recommendMealQty }
 */
export function buildRecommendationMap(meals, stockMap, velocityMap = {}, options = {}) {
  const map = {};
  for (const product of meals) {
    const s = stockMap[product.id] || {};
    map[product.id] = recommendMealQty({
      par: product.par_level || 0,
      onHand: s.qty_on_hand || 0,
      committed: s.qty_committed || 0,
      weeklyRate: velocityMap[product.id] || 0,
      options,
    });
  }
  return map;
}
