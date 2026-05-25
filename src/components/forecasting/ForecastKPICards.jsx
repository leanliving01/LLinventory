import React from 'react';
import { TrendingUp, ShoppingCart, Package, AlertTriangle } from 'lucide-react';

const cards = [
  { key: 'totalOrders', label: 'Orders (Period)', icon: ShoppingCart },
  { key: 'totalUnits', label: 'Total Units Sold', icon: Package },
  { key: 'avgWeeklyOrders', label: 'Avg Orders / Week', icon: TrendingUp },
  { key: 'skusBelowPar', label: 'SKUs Below Par', icon: AlertTriangle, alert: true },
];

export default function ForecastKPICards({ stats }) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      {cards.map(c => {
        const value = stats[c.key] ?? 0;
        return (
          <div
            key={c.key}
            className={`rounded-xl border px-4 py-3 ${c.alert && value > 0 ? 'bg-orange-50 border-orange-200' : 'bg-card'}`}
          >
            <div className="flex items-center gap-2 mb-1">
              <c.icon className={`w-4 h-4 ${c.alert && value > 0 ? 'text-orange-600' : 'text-muted-foreground'}`} />
              <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">{c.label}</span>
            </div>
            <p className={`text-xl font-bold ${c.alert && value > 0 ? 'text-orange-700' : 'text-foreground'}`}>
              {typeof value === 'number' ? value.toLocaleString() : value}
            </p>
          </div>
        );
      })}
    </div>
  );
}