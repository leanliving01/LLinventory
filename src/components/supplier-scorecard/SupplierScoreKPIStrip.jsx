import React from 'react';
import { Users, Award, TrendingUp, AlertTriangle } from 'lucide-react';

function KPICard({ icon: Icon, label, value, subValue, color }) {
  return (
    <div className="bg-card border border-border rounded-xl px-4 py-3">
      <div className="flex items-center gap-2 mb-1">
        <Icon className={`w-4 h-4 ${color}`} />
        <span className="text-[10px] uppercase font-semibold text-muted-foreground tracking-wide">{label}</span>
      </div>
      <p className={`text-2xl font-bold tabular-nums ${color}`}>{value}</p>
      {subValue && <p className="text-[10px] text-muted-foreground mt-0.5">{subValue}</p>}
    </div>
  );
}

export default function SupplierScoreKPIStrip({ kpis }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      <KPICard icon={Users} label="Active Suppliers" value={kpis.count} color="text-blue-600" />
      <KPICard icon={Award} label="Avg Score" value={kpis.avgScore} subValue="Out of 100" color={kpis.avgScore >= 70 ? 'text-green-600' : 'text-amber-600'} />
      <KPICard icon={TrendingUp} label="Top Performers" value={kpis.topPerformers} subValue="Score ≥ 80" color="text-green-600" />
      <KPICard icon={AlertTriangle} label="At Risk" value={kpis.atRisk} subValue="Score < 60" color={kpis.atRisk > 0 ? 'text-red-600' : 'text-green-600'} />
    </div>
  );
}