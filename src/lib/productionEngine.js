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
