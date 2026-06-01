/**
 * Dispatch (packing) performance aggregation — pure, unit-testable.
 *
 * Throughput is measured in "throughput units" (TU) per ACTIVE packing hour, so total
 * time-on-task does not bias the score (a packer who logged the most hours does NOT win
 * by default). TU is driven by line items / units scanned, plus a small fixed per-order
 * overhead for the box/label/seal step:
 *
 *     TU(order) = packed_items + W_ORDER
 *
 * Performance % is each packer's TU/active-hour as a percentage of a benchmark:
 *   - default: the TEAM-AVERAGE TU/active-hour (100% = average packer)
 *   - if a standard rate is configured, that fixed standard is used instead.
 */

export const DEFAULT_W_ORDER = 2;       // per-order handling overhead (box/label/seal)
export const DEFAULT_MIN_ORDERS = 3;    // below this, flag "insufficient data"
export const DEFAULT_CAP_PCT = 200;     // cap displayed performance %

const num = (v) => Number(v) || 0;

export function orderTU(order, wOrder = DEFAULT_W_ORDER) {
  return num(order.packed_items) + wOrder;
}

/**
 * @param orders  packed sales_orders (each: packed_by_member_id, packing_active_seconds,
 *                packed_items, packed_meals, packed_package_meals, packed_byo_meals,
 *                packed_supplements)
 * @param members dispatch team members [{ id, name }]
 * @param options { wOrder, standardTUh, minOrders, capPct }
 * @returns { benchmarkTUh, basis: 'team-average'|'standard', rows: [...] }
 */
export function computeDispatchKpis(orders = [], members = [], options = {}) {
  const wOrder = options.wOrder ?? DEFAULT_W_ORDER;
  const minOrders = options.minOrders ?? DEFAULT_MIN_ORDERS;
  const capPct = options.capPct ?? DEFAULT_CAP_PCT;
  const standardTUh = options.standardTUh != null && options.standardTUh > 0 ? options.standardTUh : null;

  // Group orders by packer.
  const byMember = new Map();
  for (const o of orders) {
    const id = o.packed_by_member_id || '';
    if (!byMember.has(id)) byMember.set(id, []);
    byMember.get(id).push(o);
  }

  // Team benchmark uses only orders with positive active time (so a rate is well-defined).
  let teamTU = 0;
  let teamSec = 0;
  for (const o of orders) {
    const sec = num(o.packing_active_seconds);
    if (sec > 0) { teamTU += orderTU(o, wOrder); teamSec += sec; }
  }
  const teamAvgTUh = teamSec > 0 ? teamTU / (teamSec / 3600) : 0;
  const benchmarkTUh = standardTUh ?? teamAvgTUh;

  // Build a row per known dispatch member, plus any member id that appears on orders.
  const memberMap = new Map();
  members.forEach((m) => memberMap.set(m.id, m.name));
  byMember.forEach((list, id) => { if (!memberMap.has(id)) memberMap.set(id, list[0]?.packed_by_name || 'Unknown'); });

  const rows = [];
  memberMap.forEach((name, id) => {
    const list = byMember.get(id) || [];
    const ordersCount = list.length;
    let items = 0, meals = 0, pkgMeals = 0, byoMeals = 0, supplements = 0, sec = 0, tu = 0;
    for (const o of list) {
      items += num(o.packed_items);
      meals += num(o.packed_meals);
      pkgMeals += num(o.packed_package_meals);
      byoMeals += num(o.packed_byo_meals);
      supplements += num(o.packed_supplements);
      sec += num(o.packing_active_seconds);
      tu += orderTU(o, wOrder);
    }
    const activeHours = sec / 3600;
    const tuPerHour = activeHours > 0 ? tu / activeHours : 0;
    const itemsPerHour = activeHours > 0 ? items / activeHours : 0;
    const perfPct = (benchmarkTUh > 0 && activeHours > 0)
      ? Math.min(capPct, Math.round((tuPerHour / benchmarkTUh) * 100))
      : null;
    rows.push({
      member_id: id,
      name,
      orders: ordersCount,
      items,
      meals,
      packageMeals: pkgMeals,
      byoMeals,
      supplements,
      activeSeconds: sec,
      avgSecPerOrder: ordersCount > 0 ? Math.round(sec / ordersCount) : 0,
      secPerItem: items > 0 ? Math.round(sec / items) : 0,
      itemsPerHour: Math.round(itemsPerHour * 10) / 10,
      tuPerHour: Math.round(tuPerHour * 10) / 10,
      perfPct,
      insufficient: ordersCount < minOrders,
    });
  });

  rows.sort((a, b) => (b.perfPct ?? -1) - (a.perfPct ?? -1));
  return { benchmarkTUh: Math.round(benchmarkTUh * 10) / 10, basis: standardTUh ? 'standard' : 'team-average', rows };
}
