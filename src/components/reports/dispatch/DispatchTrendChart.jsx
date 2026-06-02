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

export default function DispatchTrendChart({ events = [], from, to }) {
  const data = useMemo(() => {
    const days = eachDayOfInterval({ start: startOfDay(from), end: startOfDay(to) }).slice(-30);
    return days.map(day => {
      const dayEvents = events.filter(e => e.timestamp && isSameDay(new Date(e.timestamp), day));
      return {
        date: format(day, 'dd MMM'),
        items: dayEvents.reduce((s, e) => s + (Number(e.packed_items) || 0), 0),
        meals: dayEvents.reduce((s, e) => s + (Number(e.packed_meals) || 0), 0),
      };
    });
  }, [events, from, to]);

  const empty = data.every(d => d.items === 0 && d.meals === 0)
    ? <div className="text-center py-12 text-sm text-muted-foreground">No packing in period</div>
    : null;

  return (
    <ChartCard title="Daily Packing Volume" subtitle="Line items & meals packed per day" emptyState={empty}>
      {!empty && (
        <ResponsiveContainer width="100%" height={240}>
          <BarChart data={data} margin={{ top: 5, right: 5, bottom: 5, left: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
            <XAxis dataKey="date" tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} axisLine={false} tickLine={false}
              interval={Math.max(0, Math.floor(data.length / 8))} />
            <YAxis tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} axisLine={false} tickLine={false} />
            <Tooltip content={<CustomTooltip />} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Bar dataKey="items" name="Line items" fill="hsl(var(--status-info))" radius={[4, 4, 0, 0]} />
            <Bar dataKey="meals" name="Meals" fill="hsl(var(--status-good))" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      )}
    </ChartCard>
  );
}
