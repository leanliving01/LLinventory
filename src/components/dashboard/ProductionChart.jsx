import React, { useMemo } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { format } from 'date-fns';

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

  if (chartData.length === 0) {
    return (
      <div className="bg-card border border-border rounded-xl p-5">
        <h3 className="text-sm font-semibold text-foreground mb-4">Production Output</h3>
        <div className="text-center py-12 text-sm text-muted-foreground">No production runs in period</div>
      </div>
    );
  }

  return (
    <div className="bg-card border border-border rounded-xl p-5">
      <h3 className="text-sm font-semibold text-foreground mb-4">Production Output</h3>
      <ResponsiveContainer width="100%" height={240}>
        <BarChart data={chartData} margin={{ top: 5, right: 5, bottom: 5, left: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
          <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} />
          <YAxis tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} />
          <Tooltip
            contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid hsl(var(--border))' }}
            formatter={(val, name) => [val.toLocaleString(), name === 'units' ? 'Units' : 'Runs']}
          />
          <Bar dataKey="units" fill="hsl(var(--chart-2))" radius={[6, 6, 0, 0]} name="Units" />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}