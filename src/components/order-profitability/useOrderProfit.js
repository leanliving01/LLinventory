import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/api/supabaseClient';

// ISO-stamp a Date (or pass through a string) for stable query keys + RPC args.
function iso(d) {
  if (!d) return null;
  return d instanceof Date ? d.toISOString() : d;
}

/**
 * Order-grain profitability for the window — one row per order, full net profit
 * (revenue − COGS − discounts + shipping − vouchers − refunds − added costs).
 * Feeds KPIs, province + fulfillment breakdowns, profit trend and the table.
 */
export function useOrderProfitOrders(from, to) {
  return useQuery({
    queryKey: ['order-profit-orders', iso(from), iso(to)],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('order_profit_orders', {
        p_from: iso(from),
        p_to: iso(to),
      });
      if (error) {
        console.error('[order_profit_orders]', error.message);
        throw error;
      }
      return data || [];
    },
    staleTime: 5 * 60 * 1000,
    keepPreviousData: true,
  });
}

/**
 * Line-grain profitability for the window — one row per package/standalone line,
 * tagged with pack size + meal package family. Feeds the "which pack size /
 * which meal package is most profitable" product-contribution breakdowns.
 */
export function useOrderProfitLines(from, to) {
  return useQuery({
    queryKey: ['order-profit-lines', iso(from), iso(to)],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('order_profit_lines', {
        p_from: iso(from),
        p_to: iso(to),
      });
      if (error) {
        console.error('[order_profit_lines]', error.message);
        throw error;
      }
      return data || [];
    },
    staleTime: 5 * 60 * 1000,
    keepPreviousData: true,
  });
}

// --- Aggregation helpers (pure) -------------------------------------------

const num = (v) => Number(v) || 0;

/** Roll order rows up into the headline totals + averages. */
export function summariseOrders(orders = []) {
  const n = orders.length;
  const revenue = orders.reduce((s, o) => s + num(o.product_revenue), 0);
  const cogs = orders.reduce((s, o) => s + num(o.product_cogs), 0);
  const grossProfit = orders.reduce((s, o) => s + num(o.gross_profit), 0);
  const netProfit = orders.reduce((s, o) => s + num(o.net_profit), 0);
  const shipping = orders.reduce((s, o) => s + num(o.shipping_charged), 0);
  const discounts = orders.reduce((s, o) => s + num(o.discounts), 0);
  const refunds = orders.reduce((s, o) => s + num(o.refunds_financial) + num(o.refunds_returns), 0);
  const units = orders.reduce((s, o) => s + num(o.item_units), 0);
  return {
    orderCount: n,
    revenue,
    cogs,
    grossProfit,
    netProfit,
    shipping,
    discounts,
    refunds,
    units,
    avgProfit: n ? netProfit / n : 0,
    avgOrderValue: n ? revenue / n : 0,
    netMargin: revenue > 0 ? (netProfit / revenue) * 100 : 0,
    grossMargin: revenue > 0 ? (grossProfit / revenue) * 100 : 0,
  };
}

/**
 * Group rows by a key, summing revenue/cogs/profit and computing margin.
 * Works for both line rows (product contribution) and order rows (net).
 * @param rows array
 * @param keyFn (row) => string|null
 * @param opts  { revenueField, cogsField, profitField } column names
 */
export function groupProfit(rows = [], keyFn, opts = {}) {
  const revF = opts.revenueField || 'revenue';
  const cogsF = opts.cogsField || 'cogs';
  const profitF = opts.profitField; // when set, sum this instead of revenue−cogs
  const map = new Map();
  for (const r of rows) {
    const key = keyFn(r);
    if (key == null) continue;
    const k = String(key);
    let g = map.get(k);
    if (!g) {
      g = { key: k, revenue: 0, cogs: 0, profit: 0, units: 0, orders: 0 };
      map.set(k, g);
    }
    g.revenue += num(r[revF]);
    g.cogs += num(r[cogsF]);
    g.profit += profitF ? num(r[profitF]) : num(r[revF]) - num(r[cogsF]);
    g.units += num(r.qty) || num(r.item_units);
    g.orders += 1;
  }
  return [...map.values()].map((g) => ({
    ...g,
    margin: g.revenue > 0 ? (g.profit / g.revenue) * 100 : 0,
  }));
}
