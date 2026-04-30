import React, { useMemo } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from 'recharts';
import { format, eachDayOfInterval, isSameDay, startOfDay } from 'date-fns';
import ChartCard from '@/components/shared/ChartCard';

const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-card border border-border rounded-md shadow-lg px-3 py-2">
      <p className="text-xs text-muted-foreground mb-1">{label}</p>
      {payload.map(p => (
        <p key={p.dataKey} className="text-sm font-semibold tabular-nums" style={{ color: p.color }}>
          {p.name}: {p.value.toLocaleString()}
        </p>
      ))}
    </div>
  );
};

export default function ProductionGapChart({ runs, runLines, orders, from, to }) {
  const chartData = useMemo(() => {
    const days = eachDayOfInterval({ start: startOfDay(from), end: startOfDay(to) });
    // Show max 30 days
    const displayDays = days.slice(-30);
    return displayDays.map(day => {
      const dayRuns = runs.filter(r => r.run_date && isSameDay(new Date(r.run_date), day));
      const produced = dayRuns.reduce((s, r) => s + (r.total_units || 0), 0);
      const dayOrders = orders.filter(o => o.order_date && isSameDay(new Date(o.order_date), day));
      const ordered = dayOrders.reduce((s, o) => s + (o.total_meals || 0), 0);
      return {
        date: format(day, 'dd MMM'),
        produced,
        ordered,
      };
    });
  }, [runs, orders, from, to]);

  const empty = chartData.every(d => d.produced === 0 && d.ordered === 0) ? (
    <div className="text-center py-12 text-sm text-muted-foreground">No production or order data in period</div>
  ) : null;

  return (
    <ChartCard title="Meals Produced vs. Ordered" subtitle="Daily comparison" emptyState={empty}>
      {!empty && (
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={chartData} margin={{ top: 5, right: 5, bottom: 5, left: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
            <XAxis dataKey="date" tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} axisLine={false} tickLine={false}
              interval={Math.max(0, Math.floor(chartData.length / 8))} />
            <YAxis tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} axisLine={false} tickLine={false} />
            <Tooltip content={<CustomTooltip />} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Bar dataKey="produced" name="Produced" fill="hsl(var(--status-good))" radius={[4, 4, 0, 0]} />
            <Bar dataKey="ordered" name="Ordered" fill="hsl(var(--status-info))" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      )}
    </ChartCard>
  );
}