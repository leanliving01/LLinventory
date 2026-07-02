/**
 * Production Planning engine — the deterministic "judgment brain".
 *
 * Pure PAR-TO-TARGET replenishment (Thys, 2026-07-02). The old "6-day forward
 * cover" cap was RETIRED — it sat below par for slow movers and recommended
 * less-than-par (or zero), which broke "just work back to par". The rule now:
 *
 *   1. Backorder (committed > on-hand) → always covered: par − available exceeds
 *      par when available is negative, so the owed units are included by design.
 *   2. Otherwise rebuild to par: recommended = max(0, par − available), where
 *      available = on-hand − committed. At/over par → 0.
 *
 * There is no velocity cap and no below-par threshold — any meal under par
 * produces. Daily capacity + the production window (splitting the day's total
 * into sized runs) is applied downstream on the planning page, not here. The
 * shared-bulk / 4-weighting efficiency is inherent: every below-par variant of a
 * dish already appears, so there's no separate catch-up pass.
 *
 * Numbers only — no LLM. Livy narrates the OUTPUT; it never invents the maths.
 * (See docs/PRODUCTION_PLANNING_LOGIC_2026-07-01.md + PRODUCTION_PLANNING_AGENT_BRIEF.md.)
 */

/**
 * Recommend how many units of a single meal to produce — par-to-target with the
 * Phase-2 levers layered on: in-flight cover, a per-meal max ceiling, and a
 * leftover-veg burn-down target that may exceed par.
 *
 * @param {object} a
 * @param {number}  a.par         - products.par_level (the floor to rebuild to)
 * @param {number}  a.onHand      - total qty_on_hand across locations
 * @param {number}  a.committed   - total qty_committed (paid-unfulfilled, exploded)
 * @param {number}  [a.inFlight]  - units already scheduled/in-progress in open runs
 *                                  (counts as cover so back-to-back days don't double-produce)
 * @param {?number} [a.maxLevel]  - products.max_level ceiling; null = no ceiling
 * @param {number}  [a.burnDownQty]- leftover-veg burn-down target for this meal (may
 *                                  push the make ABOVE par; still bounded by maxLevel)
 * @returns {{ recommended:number, reason:string, available:number,
 *            backorderShortfall:number, rawQty:number, inFlight:number, maxLevel:?number }}
 */
export function recommendMealQty({ par = 0, onHand = 0, committed = 0, inFlight = 0, maxLevel = null, burnDownQty = 0 }) {
  const available = onHand - committed;
  // In-flight (scheduled / in-progress) production already counts as cover — so a
  // Day-2 plan doesn't re-make what Day 1 already covers.
  const scheduled = Math.max(0, inFlight);
  const cover = available + scheduled;
  // Units still owed after in-flight production is accounted for (a backorder an
  // open run already covers isn't owed again).
  const backorderShortfall = Math.max(0, committed - onHand - scheduled);

  // Par target: rebuild cover up to par. Leftover-veg burn-down can raise the
  // target ABOVE par (make extra to use up perishable raw veg).
  const parTarget = Math.max(0, par - cover);
  const burn = Math.max(0, burnDownQty);
  let target = Math.max(parTarget, burn);

  // Per-meal ceiling: never hold more than max_level on hand (backorders are
  // always covered below, even past the ceiling).
  const hasCeiling = maxLevel != null && maxLevel > 0;
  if (hasCeiling) target = Math.min(target, Math.max(0, maxLevel - cover));

  const recommended = Math.max(Math.round(target), backorderShortfall);

  let reason;
  if (burn > 0 && burn >= parTarget && burn >= backorderShortfall) reason = 'veg_burndown';
  else if (backorderShortfall > 0) reason = 'backorder';
  else if (par > 0 && cover < par) reason = 'below_par';
  else reason = par > 0 ? 'at_par' : 'no_par';

  return { recommended, reason, available, backorderShortfall, rawQty: recommended, inFlight: scheduled, maxLevel: hasCeiling ? maxLevel : null };
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
    // Wall-clock = total batch-minutes spread across the machine's parallel units.
    const wallClockMin = g.units > 0 ? Math.round(g.cookMin / g.units) : g.cookMin;
    return { ...g, capacityMin, utilisationPct, wallClockMin, over: g.cookMin > capacityMin, idle: g.bulks.length === 0,
             bulks: g.bulks.sort((a, b) => b.kg - a.kg) };
  });

  // Day totals + critical path (the longest single machine = the bottleneck that
  // sets when the whole cook is done).
  const active = groups.filter((g) => !g.idle);
  const critical = active.reduce((m, g) => (g.wallClockMin > (m?.wallClockMin || 0) ? g : m), null);
  const totals = {
    kg: Math.round(active.reduce((s, g) => s + g.kg, 0)),
    batches: active.reduce((s, g) => s + g.batches, 0),
    wallClockMin: critical?.wallClockMin || 0,
    criticalLabel: critical?.label || null,
  };

  return { groups, totals, unscheduled };
}

// Approx blast-chill minutes per station (from the CIN7 flow sheet: wet stews/
// sauces chill slowest, steamed veg fastest). Used until per-bulk chill is stored.
const CHILL_BY_GROUP = { IVARIO: 25, TILT: 25, 'OVEN-ROAST': 17, 'OVEN-STEAM': 12 };

/**
 * Production FLOW (run sheet) — schedules the cooked bulks into a sensible ORDER
 * and estimates when portioning can start. Broad + slow bulks (high fan-out, long
 * cook) go first; each bulk is scheduled into its machine's parallel lanes, and a
 * meal is "ready to portion" once its last component has cooked + chilled. So the
 * sheet shows: cook in THIS order → portioning can start ~HH:MM → all done ~HH:MM.
 *
 * @param {object} machinePlan      - output of buildMachinePlan (groups with bulks/units)
 * @param {object} ctx
 * @param {object} ctx.fanOutBySku  - { bulkSku: how many of today's meals use it }
 * @param {object} ctx.mealBulksBySku - { mealId: [bulkSku,...] } for today's meals
 * @returns {{ steps:Array, portioningStartMin:number, doneMin:number }}
 */
export function buildProductionFlow(machinePlan, ctx = {}) {
  const fanOut = ctx.fanOutBySku || {};
  const mealBulks = ctx.mealBulksBySku || {};
  const byRank = (a, b) =>
    (fanOut[b.sku] || 0) - (fanOut[a.sku] || 0) ||
    (b.cookMin || 0) - (a.cookMin || 0) ||
    String(a.sku || '').localeCompare(String(b.sku || ''));

  const steps = [];
  const readyBySku = {};
  for (const g of (machinePlan?.groups || [])) {
    if (g.idle) continue;
    const chill = CHILL_BY_GROUP[g.key] ?? 15;
    const lanes = new Array(Math.max(1, g.units)).fill(0);
    for (const b of [...g.bulks].sort(byRank)) {
      let li = 0;
      for (let i = 1; i < lanes.length; i++) if (lanes[i] < lanes[li]) li = i;
      const start = lanes[li];
      const end = start + (b.cookMin || 0);
      lanes[li] = end;
      const ready = end + chill;
      readyBySku[b.sku] = Math.max(readyBySku[b.sku] || 0, ready);
      steps.push({
        sku: b.sku, name: b.name, machine: g.label, machineKey: g.key,
        fanOut: fanOut[b.sku] || 0, cookMin: b.cookMin || 0, chillMin: chill,
        kg: b.kg, batches: b.batches, startMin: start, readyMin: ready,
      });
    }
  }
  steps.sort((a, b) => a.startMin - b.startMin || (b.fanOut - a.fanOut));

  // Portioning can start once the EARLIEST meal is fully cooked + chilled.
  let portioningStartMin = Infinity;
  for (const skus of Object.values(mealBulks)) {
    if (!skus || !skus.length) continue;
    let ready = 0, ok = true;
    for (const s of skus) {
      if (readyBySku[s] == null) { ok = false; break; }
      ready = Math.max(ready, readyBySku[s]);
    }
    if (ok && ready < portioningStartMin) portioningStartMin = ready;
  }
  if (!isFinite(portioningStartMin)) {
    portioningStartMin = steps.length ? Math.min(...steps.map(s => s.readyMin)) : 0;
  }
  const doneMin = steps.length ? Math.max(...steps.map(s => s.readyMin)) : 0;
  return { steps, portioningStartMin, doneMin };
}

/**
 * Production SEQUENCING — assign a `sequence_order` to each floor task so the
 * kitchen/prep/portioning tablets show work in the right ORDER.
 *
 * Cook/prep order: the BROAD + SLOW components first — those that feed the most
 * meals (high fan-out, e.g. rice/chicken) and take longest to cook+chill — so the
 * most meals become plate-ready as early as possible and the portioning line is
 * fed continuously. Portion order: each meal is sequenced by when its LAST
 * component is cooked, so meals unlock in a steady stream rather than all at once.
 *
 * Station bases keep prep < cook < portion if ever combined; within a station the
 * board just sorts ascending by sequence_order.
 *
 * @param {Array}  tasks - base tasks ({ station, product_id, step_no, ... })
 * @param {object} ctx   - { fanOut:{bulkId:mealCount}, cookMin:{bulkId:min}, mealBulks:{mealId:[bulkId]} }
 * @returns {Array} tasks with sequence_order set
 */
export function assignTaskSequence(tasks, ctx = {}) {
  const fanOut = ctx.fanOut || {};
  const cookMin = ctx.cookMin || {};
  const mealBulks = ctx.mealBulks || {};

  // Rank the cooked bulks: most meals first, then longest cook, then stable id.
  const bulkIds = [...new Set(tasks.filter(t => t.station === 'cook' || t.station === 'prep').map(t => t.product_id))];
  bulkIds.sort((a, b) =>
    (fanOut[b] || 0) - (fanOut[a] || 0) ||
    (cookMin[b] || 0) - (cookMin[a] || 0) ||
    String(a).localeCompare(String(b)));
  const cookRank = {};
  bulkIds.forEach((id, i) => { cookRank[id] = i; });

  const portionRank = (mealId) => {
    let max = 0;
    for (const b of (mealBulks[mealId] || [])) {
      if (cookRank[b] != null && cookRank[b] > max) max = cookRank[b];
    }
    return max; // ready after its last-cooked component
  };

  const BASE = { prep: 0, cook: 1000, portion: 2000 };
  return tasks.map((t) => {
    const rank = t.station === 'portion'
      ? portionRank(t.product_id)
      : (cookRank[t.product_id] != null ? cookRank[t.product_id] : 90);
    return { ...t, sequence_order: (BASE[t.station] ?? 0) + rank * 10 };
  });
}

/**
 * Build the per-meal recommendation map (par-to-target + Phase-2 levers). Every
 * below-par meal produces on its own, so there's no separate catch-up pass: all
 * four package variants of a dish that are below par already appear here, and
 * the shared bulk is cooked once for whichever variants need topping up.
 *
 * @param {Array}  meals    - finished_meal products ({ id, sku, par_level, max_level, ... })
 * @param {object} stockMap - { [productId]: { qty_on_hand, qty_committed } }
 * @param {object} [opts]
 * @param {object} [opts.inFlightMap] - { [productId]: units scheduled in open runs }
 * @param {object} [opts.burnDownMap] - { [productId]: leftover-veg burn-down target }
 * @returns {object} { [productId]: result-from-recommendMealQty }
 */
export function buildRecommendationMap(meals, stockMap, opts = {}) {
  const { inFlightMap = {}, burnDownMap = {} } = opts;
  const map = {};
  for (const product of meals) {
    const s = stockMap[product.id] || {};
    map[product.id] = recommendMealQty({
      par: product.par_level || 0,
      onHand: s.qty_on_hand || 0,
      committed: s.qty_committed || 0,
      maxLevel: product.max_level ?? null,
      inFlight: inFlightMap[product.id] || 0,
      burnDownQty: burnDownMap[product.id] || 0,
    });
  }
  return map;
}
