import React, { useMemo } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import ChartCard from '@/components/shared/ChartCard';

const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-card border border-border rounded-md shadow-lg px-3 py-2">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-sm font-semibold tabular-nums text-foreground">{payload[0].value.toLocaleString()} meals</p>
    </div>
  );
};

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

  const empty = chartData.length === 0 ? (
    <div className="text-center py-12 text-sm text-muted-foreground">No order data in period</div>
  ) : null;

  return (
    <ChartCard title="Meals by Package Type" emptyState={empty}>
      {!empty && (
        <ResponsiveContainer width="100%" height={240}>
          <BarChart data={chartData} margin={{ top: 5, right: 5, bottom: 5, left: 5 }}>
            <XAxis dataKey="name" tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} axisLine={false} tickLine={false} />
            <Tooltip content={<CustomTooltip />} />
            <Bar dataKey="value" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      )}
    </ChartCard>
  );
}