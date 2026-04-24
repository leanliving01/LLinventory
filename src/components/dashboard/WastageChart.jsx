import React, { useMemo } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { format } from 'date-fns';

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

  if (chartData.length === 0) {
    return (
      <div className="bg-card border border-border rounded-xl p-5">
        <h3 className="text-sm font-semibold text-foreground mb-4">Wastage Trend (ZAR)</h3>
        <div className="text-center py-12 text-sm text-muted-foreground">No wastage data in period</div>
      </div>
    );
  }

  return (
    <div className="bg-card border border-border rounded-xl p-5">
      <h3 className="text-sm font-semibold text-foreground mb-4">Wastage Trend (ZAR)</h3>
      <ResponsiveContainer width="100%" height={240}>
        <BarChart data={chartData} margin={{ top: 5, right: 5, bottom: 5, left: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
          <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} />
          <YAxis tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} tickFormatter={v => `R${v}`} />
          <Tooltip
            contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid hsl(var(--border))' }}
            formatter={(val) => [`R ${val.toLocaleString()}`, 'Wastage']}
          />
          <Bar dataKey="value" fill="hsl(var(--chart-4))" radius={[6, 6, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}