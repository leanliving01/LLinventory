import { startOfWeek, subWeeks, format, isWithinInterval, parseISO } from 'date-fns';

/**
 * Build weekly demand data and per-SKU statistics from SalesOrder + SalesOrderLine data.
 * 
 * @param {Array} orders — SalesOrder records
 * @param {Array} orderLines — SalesOrderLine records
 * @param {Array} products — Product records (for par_level lookup)
 * @param {number} weeks — How many weeks back to analyze
 * @returns {{ weeklyData, skuStats, kpis }}
 */
export function buildForecast(orders, orderLines, products, weeks = 12) {
  const now = new Date();
  const cutoff = subWeeks(now, weeks);

  // Only paid/fulfilled orders within window
  const validOrders = orders.filter(o => {
    if (!o.order_date) return false;
    const d = parseISO(o.order_date);
    if (d < cutoff) return false;
    return ['paid_unfulfilled', 'fulfilled'].includes(o.lifecycle_state);
  });

  const validOrderIds = new Set(validOrders.map(o => o.id));

  // Filter order lines to valid orders — only active component/standalone lines (not package parents)
  const validLines = orderLines.filter(l =>
    validOrderIds.has(l.sales_order_id) &&
    !l.is_package_parent &&
    l.status === 'active'
  );

  // Build order date lookup
  const orderDateMap = {};
  validOrders.forEach(o => { orderDateMap[o.id] = o.order_date; });

  // Build product lookup
  const productMap = {};
  products.forEach(p => { productMap[p.sku] = p; });

  // --- Weekly aggregation ---
  const weekBuckets = {};
  for (let i = 0; i < weeks; i++) {
    const weekStart = startOfWeek(subWeeks(now, i), { weekStartsOn: 1 });
    const label = format(weekStart, 'dd MMM');
    weekBuckets[label] = { week: label, orders: 0, units: 0, _start: weekStart, _end: subWeeks(now, i - 1) < now ? (i === 0 ? now : startOfWeek(subWeeks(now, i - 1), { weekStartsOn: 1 })) : now };
  }

  // Simpler: build week index per order
  validOrders.forEach(o => {
    const d = parseISO(o.order_date);
    const ws = startOfWeek(d, { weekStartsOn: 1 });
    const label = format(ws, 'dd MMM');
    if (weekBuckets[label]) {
      weekBuckets[label].orders += 1;
    }
  });

  validLines.forEach(l => {
    const orderDate = orderDateMap[l.sales_order_id];
    if (!orderDate) return;
    const d = parseISO(orderDate);
    const ws = startOfWeek(d, { weekStartsOn: 1 });
    const label = format(ws, 'dd MMM');
    if (weekBuckets[label]) {
      weekBuckets[label].units += (l.qty || 0);
    }
  });

  const weeklyData = Object.values(weekBuckets)
    .sort((a, b) => a._start - b._start)
    .map(({ week, orders, units }) => ({ week, orders, units }));

  // --- Per-SKU stats ---
  const skuDemand = {}; // sku -> { totalDemand, weeklyDemands: { weekLabel: qty } }
  validLines.forEach(l => {
    const sku = l.sku;
    if (!sku) return;
    if (!skuDemand[sku]) {
      skuDemand[sku] = { sku, name: l.name || sku, totalDemand: 0, weeklyDemands: {} };
    }
    skuDemand[sku].totalDemand += (l.qty || 0);

    const orderDate = orderDateMap[l.sales_order_id];
    if (orderDate) {
      const ws = format(startOfWeek(parseISO(orderDate), { weekStartsOn: 1 }), 'dd MMM');
      skuDemand[sku].weeklyDemands[ws] = (skuDemand[sku].weeklyDemands[ws] || 0) + (l.qty || 0);
    }
  });

  const weekLabels = weeklyData.map(w => w.week);
  const halfPoint = Math.floor(weekLabels.length / 2);
  const firstHalf = weekLabels.slice(0, halfPoint);
  const secondHalf = weekLabels.slice(halfPoint);

  const skuStats = Object.values(skuDemand).map(s => {
    const avgPerWeek = Math.round(s.totalDemand / weeks);

    // Trend: compare first half avg vs second half avg
    const firstSum = firstHalf.reduce((sum, w) => sum + (s.weeklyDemands[w] || 0), 0);
    const secondSum = secondHalf.reduce((sum, w) => sum + (s.weeklyDemands[w] || 0), 0);
    const firstAvg = firstHalf.length ? firstSum / firstHalf.length : 0;
    const secondAvg = secondHalf.length ? secondSum / secondHalf.length : 0;

    let trend = 'stable';
    let trendPct = 0;
    if (firstAvg > 0) {
      const change = ((secondAvg - firstAvg) / firstAvg) * 100;
      trendPct = Math.round(Math.abs(change));
      if (change > 15) trend = 'up';
      else if (change < -15) trend = 'down';
    } else if (secondAvg > 0) {
      trend = 'up';
      trendPct = 100;
    }

    // Suggested par = avg weekly demand * 1.3 (30% safety buffer), rounded up
    const suggestedPar = Math.ceil(avgPerWeek * 1.3);
    const product = productMap[s.sku];
    const currentPar = product?.par_level || 0;

    return {
      sku: s.sku,
      name: s.name,
      totalDemand: s.totalDemand,
      avgPerWeek,
      trend,
      trendPct,
      currentPar,
      suggestedPar,
    };
  }).sort((a, b) => b.totalDemand - a.totalDemand);

  // --- KPIs ---
  const totalOrders = validOrders.length;
  const totalUnits = validLines.reduce((s, l) => s + (l.qty || 0), 0);
  const avgWeeklyOrders = Math.round(totalOrders / weeks);
  const skusBelowPar = skuStats.filter(s => s.currentPar > 0 && s.suggestedPar > s.currentPar).length;

  return {
    weeklyData,
    skuStats,
    kpis: { totalOrders, totalUnits, avgWeeklyOrders, skusBelowPar },
  };
}