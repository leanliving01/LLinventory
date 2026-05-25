import React, { useMemo } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { format, eachDayOfInterval, startOfDay, subDays } from 'date-fns';
import ChartCard from '@/components/shared/ChartCard';

const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-card border border-border rounded-md shadow-lg px-3 py-2">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-sm font-semibold tabular-nums text-red-600">R {payload[0].value.toLocaleString()}</p>
    </div>
  );
};

export default function WriteOffTrendChart({ writeOffs = [], from, to }) {
  const chartData = useMemo(() => {
    const start = from ? startOfDay(from) : startOfDay(subDays(new Date(), 30));
    const end = to || new Date();
    const days = eachDayOfInterval({ start, end });
    if (days.length > 62) return [];

    return days.map(day => {
      const dayStr = format(day, 'yyyy-MM-dd');
      const value = writeOffs
        .filter(wo => (wo._displayDate || '').startsWith(dayStr))
        .reduce((s, wo) => s + (wo.total_value || 0), 0);
      return { date: format(day, 'dd MMM'), value: Math.round(value) };
    });
  }, [writeOffs, from, to]);

  const hasData = chartData.some(d => d.value > 0);

  return (
    <ChartCard title="Write-Off Trend" subtitle="ZAR value by day — combined manual & QC">
      {!hasData ? (
        <div className="text-center py-8 text-sm text-muted-foreground">No write-offs in this period</div>
      ) : (
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={chartData} margin={{ top: 5, right: 5, bottom: 5, left: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
            <XAxis dataKey="date" tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} tickFormatter={v => `R${v}`} axisLine={false} tickLine={false} />
            <Tooltip content={<CustomTooltip />} />
            <Bar dataKey="value" fill="hsl(var(--destructive))" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      )}
    </ChartCard>
  );
}
