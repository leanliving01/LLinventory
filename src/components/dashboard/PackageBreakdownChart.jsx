import React, { useMemo } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';

const COLORS = [
  'hsl(var(--chart-1))',
  'hsl(var(--chart-2))',
  'hsl(var(--chart-3))',
  'hsl(var(--chart-4))',
  'hsl(var(--chart-5))',
  'hsl(142 71% 35%)',
];

export default function PackageBreakdownChart({ orders }) {
  const chartData = useMemo(() => {
    const counts = {};
    orders.forEach(o => {
      if (o.mwl_meals) counts['MWL'] = (counts['MWL'] || 0) + o.mwl_meals;
      if (o.mlm_meals) counts['MLM'] = (counts['MLM'] || 0) + o.mlm_meals;
      if (o.wwl_meals) counts['WWL'] = (counts['WWL'] || 0) + o.wwl_meals;
      if (o.wlm_meals) counts['WLM'] = (counts['WLM'] || 0) + o.wlm_meals;
      if (o.lc_meals) counts['LC'] = (counts['LC'] || 0) + o.lc_meals;
      if (o.byo_meals) counts['BYO'] = (counts['BYO'] || 0) + o.byo_meals;
    });
    return Object.entries(counts)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);
  }, [orders]);

  if (chartData.length === 0) {
    return (
      <div className="bg-card border border-border rounded-xl p-5">
        <h3 className="text-sm font-semibold text-foreground mb-4">Meals by Package Type</h3>
        <div className="text-center py-12 text-sm text-muted-foreground">No order data in period</div>
      </div>
    );
  }

  return (
    <div className="bg-card border border-border rounded-xl p-5">
      <h3 className="text-sm font-semibold text-foreground mb-4">Meals by Package Type</h3>
      <ResponsiveContainer width="100%" height={240}>
        <BarChart data={chartData} margin={{ top: 5, right: 5, bottom: 5, left: 5 }}>
          <XAxis dataKey="name" tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} />
          <YAxis tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} />
          <Tooltip
            contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid hsl(var(--border))' }}
            formatter={(val) => [val.toLocaleString(), 'Meals']}
          />
          <Bar dataKey="value" radius={[6, 6, 0, 0]}>
            {chartData.map((_, i) => (
              <Cell key={i} fill={COLORS[i % COLORS.length]} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}