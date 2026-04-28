import React, { useMemo } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { format } from 'date-fns';
import ChartCard from '@/components/shared/ChartCard';

const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-card border border-border rounded-md shadow-lg px-3 py-2">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-sm font-semibold tabular-nums text-foreground">{payload[0].value.toLocaleString()} units</p>
    </div>
  );
};

export default function ProductionChart({ runs }) {
  const chartData = useMemo(() => {
    if (!runs.length) return [];
    const byDate = {};
    runs.forEach(r => {
      const d = r.run_date ? format(new Date(r.run_date), 'dd MMM') : 'N/A';
      if (!byDate[d]) byDate[d] = { date: d, units: 0, runs: 0 };
      byDate[d].units += r.total_units || 0;
      byDate[d].runs += 1;
    });
    return Object.values(byDate).slice(-15);
  }, [runs]);

  const empty = chartData.length === 0 ? (
    <div className="text-center py-12 text-sm text-muted-foreground">
      No production runs in period
    </div>
  ) : null;

  return (
    <ChartCard title="Production Output" emptyState={empty}>
      {!empty && (
        <ResponsiveContainer width="100%" height={240}>
          <BarChart data={chartData} margin={{ top: 5, right: 5, bottom: 5, left: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
            <XAxis dataKey="date" tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} axisLine={false} tickLine={false} />
            <Tooltip content={<CustomTooltip />} />
            <Bar dataKey="units" fill="hsl(var(--status-info))" radius={[4, 4, 0, 0]} name="Units" />
          </BarChart>
        </ResponsiveContainer>
      )}
    </ChartCard>
  );
}