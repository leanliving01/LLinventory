import React, { useMemo } from 'react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { format, eachDayOfInterval, isSameDay } from 'date-fns';
import ChartCard from '@/components/shared/ChartCard';

const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-card border border-border rounded-md shadow-lg px-3 py-2">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-sm font-semibold tabular-nums text-foreground">R {payload[0].value.toLocaleString()}</p>
    </div>
  );
};

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
      };
    });
  }, [orders, from, to]);

  if (chartData.length === 0) return null;

  return (
    <ChartCard title="Revenue Trend">
      <ResponsiveContainer width="100%" height={240}>
        <AreaChart data={chartData} margin={{ top: 5, right: 5, bottom: 5, left: 5 }}>
          <defs>
            <linearGradient id="revenueGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="hsl(var(--status-good))" stopOpacity={0.12} />
              <stop offset="100%" stopColor="hsl(var(--status-good))" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
          <XAxis
            dataKey="date"
            tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
            interval={Math.max(0, Math.floor(chartData.length / 8))}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
            tickFormatter={v => `R${(v / 1000).toFixed(0)}k`}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip content={<CustomTooltip />} />
          <Area
            type="monotone"
            dataKey="revenue"
            stroke="hsl(var(--status-good))"
            fill="url(#revenueGrad)"
            strokeWidth={2}
          />
        </AreaChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}