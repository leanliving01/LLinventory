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

// Known package-range labels for the `*_meals` order columns. Any range not
// listed here is still charted (label derived from the column key) so new
// package ranges are never silently dropped.
const KNOWN_LABELS = {
  mwl_meals: 'MWL',
  mlm_meals: 'MLM',
  wwl_meals: 'WWL',
  wlm_meals: 'WLM',
  lc_meals: 'LC',
  byo_meals: 'BYO',
};

// Derive a readable label from an unknown `*_meals` key (e.g. 'foo_bar_meals' → 'FOO BAR').
const deriveLabel = (key) =>
  key.replace(/_meals$/, '').replace(/_/g, ' ').trim().toUpperCase() || key;

export default function PackageBreakdownChart({ orders }) {
  const chartData = useMemo(() => {
    const counts = {};
    orders.forEach(o => {
      Object.keys(o).forEach(key => {
        if (!key.endsWith('_meals') || key === 'total_meals') return;
        const qty = Number(o[key]) || 0;
        if (!qty) return;
        const name = KNOWN_LABELS[key] || deriveLabel(key);
        counts[name] = (counts[name] || 0) + qty;
      });
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