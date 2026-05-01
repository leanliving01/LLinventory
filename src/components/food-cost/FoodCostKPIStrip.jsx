import React from 'react';
import { CookingPot, UtensilsCrossed, Package, TrendingUp, AlertTriangle, CircleSlash } from 'lucide-react';

function KPICard({ icon: Icon, label, value, subValue, color }) {
  return (
    <div className="bg-card border border-border rounded-xl px-4 py-3">
      <div className="flex items-center gap-2 mb-1">
        <Icon className={`w-4 h-4 ${color}`} />
        <span className="text-[10px] uppercase font-semibold text-muted-foreground tracking-wide">{label}</span>
      </div>
      <p className={`text-xl font-bold tabular-nums ${color}`}>{value}</p>
      {subValue && <p className="text-[10px] text-muted-foreground mt-0.5">{subValue}</p>}
    </div>
  );
}

export default function FoodCostKPIStrip({ kpis }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
      <KPICard icon={CookingPot} label="Cook BOMs" value={kpis.cookBomCount} subValue="Raw → Bulk" color="text-blue-600" />
      <KPICard icon={UtensilsCrossed} label="Portion BOMs" value={kpis.portionBomCount} subValue="Bulk → Meals" color="text-purple-600" />
      <KPICard icon={Package} label="Pack BOMs" value={kpis.packBomCount} subValue="Meals → Packages" color="text-green-600" />
      <KPICard
        icon={TrendingUp}
        label="Avg Margin"
        value={`${kpis.avgMargin}%`}
        subValue={`${kpis.totalSellable} sellable items`}
        color={kpis.avgMargin < 30 ? 'text-red-600' : 'text-green-600'}
      />
      <KPICard
        icon={AlertTriangle}
        label="Low Margin"
        value={kpis.lowMarginCount}
        subValue="Below 30%"
        color={kpis.lowMarginCount > 0 ? 'text-amber-600' : 'text-green-600'}
      />
      <KPICard
        icon={CircleSlash}
        label="Zero Cost"
        value={kpis.zeroCostCount}
        subValue="No cost data yet"
        color={kpis.zeroCostCount > 0 ? 'text-red-600' : 'text-green-600'}
      />
    </div>
  );
}