import React from 'react';
import StatCard from '@/components/dashboard/StatCard';
import { formatZAR } from '@/lib/utils';
import { marginTier } from '@/lib/profitVisual';
import { TrendingUp, ShoppingBag, Coins, Percent, Boxes, Receipt } from 'lucide-react';

const tierStatus = (m) => {
  const t = marginTier(m);
  return t === 'excellent' || t === 'good' ? 'good' : t === 'ok' ? 'warn' : 'bad';
};

/** Headline KPIs for the selected window (order-grain). */
export default function ProfitKpiRow({ summary }) {
  const s = summary || {};
  return (
    <div className="grid gap-3 grid-cols-2 md:grid-cols-3 lg:grid-cols-6">
      <StatCard title="Net Profit" value={formatZAR(s.netProfit)} icon={TrendingUp}
        status={tierStatus(s.netMargin)} trendLabel={`${Math.round(s.netMargin || 0)}% net margin`}
        trendDirection={tierStatus(s.netMargin) === 'good' ? 'good' : 'bad'} />
      <StatCard title="Revenue" value={formatZAR(s.revenue)} icon={Coins} status="info" />
      <StatCard title="Avg Profit / Order" value={formatZAR(s.avgProfit)} icon={Receipt}
        status={tierStatus(s.netMargin)} />
      <StatCard title="Orders" value={s.orderCount || 0} icon={ShoppingBag} status="neutral"
        trendLabel={`${formatZAR(s.avgOrderValue)} avg value`} />
      <StatCard title="Gross Margin" value={`${Math.round(s.grossMargin || 0)}%`} icon={Percent}
        status={tierStatus(s.grossMargin)} trendLabel={formatZAR(s.grossProfit) + ' gross'} />
      <StatCard title="Units Sold" value={Math.round(s.units || 0)} icon={Boxes} status="neutral" />
    </div>
  );
}
