import React, { useMemo } from 'react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { format, eachDayOfInterval, isSameDay } from 'date-fns';

export default function RevenueChart({ orders, from, to }) {
  const chartData = useMemo(() => {
    const days = eachDayOfInterval({ start: from, end: to });
    return days.map(day => {
      const dayOrders = orders.filter(o =>
        o.order_date && isSameDay(new Date(o.order_date), day)
      );
      return {
        date: format(day, 'dd MMM'),
        revenue: dayOrders.reduce((s, o) => s + (o.total_amount || 0), 0),
        orders: dayOrders.length,
      };
    });
  }, [orders, from, to]);

  if (chartData.length === 0) return null;

  return (
    <div className="bg-card border border-border rounded-xl p-5">
      <h3 className="text-sm font-semibold text-foreground mb-4">Revenue Trend</h3>
      <ResponsiveContainer width="100%" height={240}>
        <AreaChart data={chartData} margin={{ top: 5, right: 5, bottom: 5, left: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
          <XAxis
            dataKey="date"
            tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
            interval={Math.max(0, Math.floor(chartData.length / 8))}
          />
          <YAxis
            tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
            tickFormatter={v => `R${(v / 1000).toFixed(0)}k`}
          />
          <Tooltip
            contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid hsl(var(--border))' }}
            formatter={(val) => [`R ${val.toLocaleString()}`, 'Revenue']}
          />
          <Area
            type="monotone"
            dataKey="revenue"
            stroke="hsl(var(--chart-1))"
            fill="hsl(var(--chart-1))"
            fillOpacity={0.15}
            strokeWidth={2}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}