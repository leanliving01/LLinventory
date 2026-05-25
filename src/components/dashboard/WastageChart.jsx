import React, { useMemo } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { format } from 'date-fns';
import ChartCard from '@/components/shared/ChartCard';

const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-card border border-border rounded-md shadow-lg px-3 py-2">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-sm font-semibold tabular-nums text-status-bad">R {payload[0].value.toLocaleString()}</p>
    </div>
  );
};

export default function WastageChart({ wastageLogs }) {
  const chartData = useMemo(() => {
    if (!wastageLogs.length) return [];
    return wastageLogs
      .filter(w => w.wastage_date && w.total_rand_value > 0)
      .map(w => ({
        date: format(new Date(w.wastage_date), 'dd MMM'),
        value: Math.round(w.total_rand_value),
      }))
      .slice(-15);
  }, [wastageLogs]);

  const empty = chartData.length === 0 ? (
    <div className="text-center py-12 text-sm text-muted-foreground">
      No wastage data in period
    </div>
  ) : null;

  return (
    <ChartCard title="Wastage Trend" subtitle="ZAR value" emptyState={empty}>
      {!empty && (
        <ResponsiveContainer width="100%" height={240}>
          <BarChart data={chartData} margin={{ top: 5, right: 5, bottom: 5, left: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
            <XAxis dataKey="date" tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} tickFormatter={v => `R${v}`} axisLine={false} tickLine={false} />
            <Tooltip content={<CustomTooltip />} />
            <Bar dataKey="value" fill="hsl(var(--status-bad))" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      )}
    </ChartCard>
  );
}