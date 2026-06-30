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

  // group key → accumulator. ALL stations are always returned (even idle ones) so
  // the kitchen picture is complete — a 0% tilting pan tells the chef there's
  // spare wet capacity, rather than the machine silently vanishing.
  const G = {
    IVARIO:      { key: 'IVARIO', label: 'Ivario (wet, ≤20 kg/batch)', units: 1, cookWindowMin, kg: 0, batches: 0, cookMin: 0, bulks: [] },
    TILT:        { key: 'TILT',   label: 'Tilting Pan (wet, ≤100 kg/batch)', units: 1, cookWindowMin, kg: 0, batches: 0, cookMin: 0, bulks: [] },
    'OVEN-ROAST':{ key: 'OVEN-ROAST', label: `Ovens · roast (×${ovenSplit.roast})`, units: ovenSplit.roast, cookWindowMin, kg: 0, batches: 0, cookMin: 0, bulks: [] },
    'OVEN-STEAM':{ key: 'OVEN-STEAM', label: `Ovens · steam (×${ovenSplit.steam})`, units: ovenSplit.steam, cookWindowMin, kg: 0, batches: 0, cookMin: 0, bulks: [] },
  };
  const unscheduled = [];
  const wet = []; // wet bulks deferred so we can balance them across BOTH pans

  for (const [bulkId, info] of Object.entries(wipNeeded)) {
    const kg = Math.round((info.kg || 0) * 100) / 100;
    if (kg <= 0) continue;
    const caps = capsByProduct[bulkId] || [];
    if (caps.length === 0) { unscheduled.push({ ...info, kg, reason: 'no capacity set' }); continue; }

    const ovenCap = caps.find((c) => isOvenName(c.equipment_name));
    if (ovenCap) {
      const mode = /roast/i.test(ovenCap.notes || '') ? 'roast' : 'steam';
      const groupKey = mode === 'roast' ? 'OVEN-ROAST' : 'OVEN-STEAM';
      const maxBatch = Number(ovenCap.max_capacity) || 0;
      const cycle = Number(ovenCap.cycle_time_min) || 0;
      const batches = maxBatch > 0 ? Math.ceil(kg / maxBatch) : 1;
      const g = G[groupKey];
      g.kg += kg; g.batches += batches; g.cookMin += batches * cycle;
      g.bulks.push({ name: info.name, sku: info.sku, kg, batches, cookMin: batches * cycle });
    } else {
      // wet — collect; the Ivario and tilting pan are interchangeable, so balance
      // these across both pans below (don't dump them all on the tiny Ivario).
      const ivario = caps.find((c) => isIvarioName(c.equipment_name));
      const tilt = caps.find((c) => !isIvarioName(c.equipment_name));
      wet.push({
        info, kg,
        ivarioMax: Number(ivario?.max_capacity) || 20,
        tiltMax: Number(tilt?.max_capacity) || 100,
        cycle: Number((ivario || tilt)?.cycle_time_min) || 0,
      });
    }
  }

  // Balance wet bulks across Ivario + Tilting Pan to cook them in PARALLEL (less
  // wall-clock) rather than serially on one pan. Longest cooks placed first;
  // anything over the Ivario's batch size must go on the tilting pan.
  wet.sort((a, b) => b.cycle - a.cycle);
  for (const w of wet) {
    const mustTilt = w.kg > w.ivarioMax && w.tiltMax > 0;
    const key = mustTilt ? 'TILT' : (G.IVARIO.cookMin <= G.TILT.cookMin ? 'IVARIO' : 'TILT');
    const max = key === 'IVARIO' ? w.ivarioMax : w.tiltMax;
    const batches = max > 0 ? Math.ceil(w.kg / max) : 1;
    const g = G[key];
    g.kg += w.kg; g.batches += batches; g.cookMin += batches * w.cycle;
    g.bulks.push({ name: w.info.name, sku: w.info.sku, kg: w.kg, batches, cookMin: batches * w.cycle });
  }

  const groups = Object.values(G).map((g) => {
    const capacityMin = g.units * g.cookWindowMin;
    const utilisationPct = capacityMin > 0 ? Math.round((g.cookMin / capacityMin) * 100) : 0;
    return { ...g, capacityMin, utilisationPct, over: g.cookMin > capacityMin, idle: g.bulks.length === 0,
             bulks: g.bulks.sort((a, b) => b.kg - a.kg) };
  });

  return { groups, unscheduled };
}

// A "dish" is the same recipe plated across the 4 goal packages (MWL/MLM/WLM/WWL).
// They share the same cooked bulk(s) — only the portioning differs. The dish key
// is the meal NUMBER from the SKU (MWL1/MLM1/WLM1/WWL1 → "1"). Self-contained
// (mirrors lib/productionGrouping.extractMealNumber) so the engine stays
// node-testable without the '@/' alias.
const GOAL_CODES = ['MLM', 'MWL', 'WLM', 'WWL'];
function dishKey(sku) {
  if (!sku) return null;
  for (const c of GOAL_CODES) {
    if (sku.startsWith(c) && /^\d+$/.test(sku.slice(c.length))) return sku.slice(c.length);
  }
  return null;
}

/**
 * Build the per-meal recommendation map for a list of meals, then apply the
 * BULK CATCH-UP rule: once any package-variant of a dish is being cooked (it
 * triggered a backorder or >10%-below-par), every OTHER variant of that same
 * dish that's below par gets topped up too — even if it's under the 10%
 * threshold. Rationale: the bulk is already being cooked, so the extra packages
 * cost only portioning. "You're already making Beef & Beans for one package, so
 * portion the other three that are a few short."
 *
 * @param {Array}  meals      - finished_meal products ({ id, sku, par_level, ... })
 * @param {object} stockMap   - { [productId]: { qty_on_hand, qty_committed } }
 * @param {object} velocityMap- { [productId]: weeklyRate }
 * @param {object} [options]
 * @returns {object} { [productId]: result-from-recommendMealQty (reason may be 'catch_up') }
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

  // ── Bulk catch-up across the 4 package variants of each dish ────────────────
  const groups = {};
  for (const p of meals) {
    const k = dishKey(p.sku);
    if (k) (groups[k] ||= []).push(p);
  }
  for (const members of Object.values(groups)) {
    if (members.length < 2) continue;
    const cooking = members.some(p => (map[p.id]?.recommended || 0) > 0);
    if (!cooking) continue; // the bulk isn't being made today → no catch-up
    for (const p of members) {
      const r = map[p.id];
      if (!r || r.recommended > 0) continue; // already producing this variant
      const s = stockMap[p.id] || {};
      const onHand = s.qty_on_hand || 0, committed = s.qty_committed || 0, par = p.par_level || 0;
      if (par > 0 && (onHand - committed) < par) {
        // Below par but didn't trigger on its own — top to par (force the trigger
        // with a 0% threshold), still clamped to the 6-day forward-cover cap.
        const catchUp = recommendMealQty({
          par, onHand, committed, weeklyRate: velocityMap[p.id] || 0,
          options: { ...options, belowParTriggerPct: 0 },
        });
        if (catchUp.recommended > 0) map[p.id] = { ...catchUp, reason: 'catch_up' };
      }
    }
  }

  return map;
}
