import React, { useMemo } from 'react';
import {
  ResponsiveContainer, ComposedChart, Area, Line, XAxis, YAxis, Tooltip, CartesianGrid,
} from 'recharts';
import { startOfWeek, format } from 'date-fns';
import { TrendingUp } from 'lucide-react';
import { formatZAR } from '@/lib/utils';

/**
 * Profit trend — net profit per week across the window, with a revenue line for
 * context. Shows whether profitability is climbing or sliding over time.
 */
export default function ProfitTrendChart({ orders = [] }) {
  const { data, totalProfit, totalRevenue } = useMemo(() => {
    const byWeek = new Map();
    for (const o of orders) {
      if (!o.order_date) continue;
      const wk = startOfWeek(new Date(o.order_date), { weekStartsOn: 1 });
      const key = wk.toISOString().slice(0, 10);
      let g = byWeek.get(key);
      if (!g) { g = { key, ts: wk.getTime(), profit: 0, revenue: 0 }; byWeek.set(key, g); }
      g.profit += Number(o.net_profit) || 0;
      g.revenue += Number(o.product_revenue) || 0;
    }
    const sorted = [...byWeek.values()].sort((a, b) => a.ts - b.ts);
    return {
      data: sorted.map((g) => ({
        week: format(new Date(g.ts), 'd MMM'),
        profit: Math.round(g.profit),
        revenue: Math.round(g.revenue),
      })),
      totalProfit: sorted.reduce((s, g) => s + g.profit, 0),
      totalRevenue: sorted.reduce((s, g) => s + g.revenue, 0),
    };
  }, [orders]);

  const margin = totalRevenue > 0 ? Math.round((totalProfit / totalRevenue) * 100) : 0;

  return (
    <div className="bg-card border border-border rounded-lg shadow-sm overflow-hidden h-full">
      <div className="flex items-start justify-between px-5 pt-5 pb-2">
        <div className="flex items-start gap-2">
          <TrendingUp className="w-4 h-4 text-muted-foreground mt-0.5 shrink-0" strokeWidth={1.75} />
          <div>
            <h3 className="text-sm font-semibold text-foreground">Profit Trend</h3>
            <p className="text-xs text-muted-foreground mt-0.5">Net profit per week · revenue line for context</p>
          </div>
        </div>
        <div className="text-right">
          <p className="text-xl font-bold tabular-nums leading-none text-status-good">{formatZAR(totalProfit)}</p>
          <p className="text-[11px] text-muted-foreground mt-1">{margin}% net margin</p>
        </div>
      </div>
      <div className="px-3 pb-4">
        {data.length === 0 ? (
          <div className="h-[240px] flex items-center justify-center text-sm text-muted-foreground">No orders in this window yet.</div>
        ) : (
          <ResponsiveContainer width="100%" height={240}>
            <ComposedChart data={data} margin={{ top: 5, right: 12, bottom: 5, left: -8 }}>
              <defs>
                <linearGradient id="profitGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="hsl(var(--chart-1))" stopOpacity={0.35} />
                  <stop offset="100%" stopColor="hsl(var(--chart-1))" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
              <XAxis dataKey="week" tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} interval="preserveStartEnd" />
              <YAxis tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} width={42}
                tickFormatter={(v) => `R${Math.abs(v) >= 1000 ? (v / 1000).toFixed(0) + 'k' : v}`} />
              <Tooltip
                contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid hsl(var(--border))', background: 'hsl(var(--card))' }}
                formatter={(v, n) => [formatZAR(v), n === 'profit' ? 'Net profit' : 'Revenue']}
              />
              <Area type="monotone" dataKey="profit" stroke="hsl(var(--chart-1))" strokeWidth={2.5} fill="url(#profitGrad)" />
              <Line type="monotone" dataKey="revenue" stroke="hsl(var(--muted-foreground))" strokeWidth={1.5}
                strokeDasharray="4 3" dot={false} />
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}
