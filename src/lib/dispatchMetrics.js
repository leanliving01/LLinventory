/**
 * Dispatch (packing) performance aggregation — pure, unit-testable.
 *
 * Source = `packing_event_logs` rows with event_type='completed' (one per section a packer
 * finishes). Each carries member_id, section, the packed_* counts and active_seconds, so a
 * single order split across two packers credits supplements to one and meals to the other.
 * Legacy single-flow finishes (section=null) still aggregate.
 *
 * Throughput is "throughput units" (TU) per ACTIVE hour, so total time-on-task doesn't bias
 * the score: TU(event) = packed_items + W_ORDER (per-order/section box/label/seal overhead).
 * Performance % = a packer's TU/active-hour vs a benchmark (team average by default; a
 * configured standard rate if provided). 100% = the benchmark.
 */

export const DEFAULT_W_ORDER = 2;
export const DEFAULT_MIN_ORDERS = 3;
export const DEFAULT_CAP_PCT = 200;

const num = (v) => Number(v) || 0;

export function eventTU(event, wOrder = DEFAULT_W_ORDER) {
  return num(event.packed_items) + wOrder;
}

/**
 * @param events  completed packing_event_logs [{ member_id, member_name, sales_order_id,
 *                packed_items, packed_meals, packed_package_meals, packed_byo_meals,
 *                packed_supplements, active_seconds, timestamp }]
 * @param members dispatch team members [{ id, name }]
 * @param options { wOrder, standardTUh, minOrders, capPct }
 */
export function computeDispatchKpis(events = [], members = [], options = {}) {
  const wOrder = options.wOrder ?? DEFAULT_W_ORDER;
  const minOrders = options.minOrders ?? DEFAULT_MIN_ORDERS;
  const capPct = options.capPct ?? DEFAULT_CAP_PCT;
  const standardTUh = options.standardTUh != null && options.standardTUh > 0 ? options.standardTUh : null;

  const byMember = new Map();
  for (const e of events) {
    const id = e.member_id || '';
    if (!byMember.has(id)) byMember.set(id, []);
    byMember.get(id).push(e);
  }

  // Benchmark from events with positive active time (rate well-defined).
  let teamTU = 0, teamSec = 0;
  for (const e of events) {
    const sec = num(e.active_seconds);
    if (sec > 0) { teamTU += eventTU(e, wOrder); teamSec += sec; }
  }
  const teamAvgTUh = teamSec > 0 ? teamTU / (teamSec / 3600) : 0;
  const benchmarkTUh = standardTUh ?? teamAvgTUh;

  const memberMap = new Map();
  members.forEach((m) => memberMap.set(m.id, m.name));
  byMember.forEach((list, id) => { if (!memberMap.has(id)) memberMap.set(id, list[0]?.member_name || 'Unknown'); });

  const rows = [];
  memberMap.forEach((name, id) => {
    const list = byMember.get(id) || [];
    const orderIds = new Set(list.map(e => e.sales_order_id));
    let items = 0, meals = 0, pkg = 0, byo = 0, supp = 0, sec = 0, tu = 0;
    for (const e of list) {
      items += num(e.packed_items);
      meals += num(e.packed_meals);
      pkg += num(e.packed_package_meals);
      byo += num(e.packed_byo_meals);
      supp += num(e.packed_supplements);
      sec += num(e.active_seconds);
      tu += eventTU(e, wOrder);
    }
    const activeHours = sec / 3600;
    const tuPerHour = activeHours > 0 ? tu / activeHours : 0;
    const itemsPerHour = activeHours > 0 ? items / activeHours : 0;
    const orders = orderIds.size;
    const perfPct = (benchmarkTUh > 0 && activeHours > 0)
      ? Math.min(capPct, Math.round((tuPerHour / benchmarkTUh) * 100))
      : null;
    rows.push({
      member_id: id,
      name,
      orders,
      items,
      meals,
      packageMeals: pkg,
      byoMeals: byo,
      supplements: supp,
      activeSeconds: sec,
      avgSecPerOrder: orders > 0 ? Math.round(sec / orders) : 0,
      secPerItem: items > 0 ? Math.round(sec / items) : 0,
      itemsPerHour: Math.round(itemsPerHour * 10) / 10,
      tuPerHour: Math.round(tuPerHour * 10) / 10,
      perfPct,
      insufficient: orders < minOrders,
    });
  });

  rows.sort((a, b) => (b.perfPct ?? -1) - (a.perfPct ?? -1));
  return { benchmarkTUh: Math.round(benchmarkTUh * 10) / 10, basis: standardTUh ? 'standard' : 'team-average', rows };
}
