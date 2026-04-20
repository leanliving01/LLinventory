import React from 'react';

const FAMILY_CONFIG = [
  { key: 'MWL', label: 'MWL', color: 'text-blue-700' },
  { key: 'MLM', label: 'MLM', color: 'text-green-700' },
  { key: 'WWL', label: 'WWL', color: 'text-pink-700' },
  { key: 'WLM', label: 'WLM', color: 'text-orange-700' },
  { key: 'LOW_CARB', label: 'LC', color: 'text-amber-700' },
];

export default function DemandSummaryCards({ demandByFamily, totalOrders, ordersWithDemand, totalRecords, warnings }) {
  const totalUnits = Object.values(demandByFamily || {}).reduce((s, v) => s + v, 0);

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-9 gap-3">
      <div className="bg-card border border-border rounded-xl p-4">
        <p className="text-xs text-muted-foreground uppercase tracking-wider">Orders</p>
        <p className="text-xl font-bold mt-1">{totalOrders}</p>
      </div>
      <div className="bg-card border border-border rounded-xl p-4">
        <p className="text-xs text-muted-foreground uppercase tracking-wider">With Demand</p>
        <p className="text-xl font-bold mt-1">{ordersWithDemand}</p>
      </div>
      <div className="bg-card border border-border rounded-xl p-4">
        <p className="text-xs text-muted-foreground uppercase tracking-wider">Total Units</p>
        <p className="text-xl font-bold mt-1 text-emerald-600">{totalUnits}</p>
      </div>
      <div className="bg-card border border-border rounded-xl p-4">
        <p className="text-xs text-muted-foreground uppercase tracking-wider">SKU Lines</p>
        <p className="text-xl font-bold mt-1">{totalRecords}</p>
      </div>
      {FAMILY_CONFIG.map(f => (
        <div key={f.key} className="bg-card border border-border rounded-xl p-4">
          <p className={`text-xs uppercase tracking-wider ${f.color}`}>{f.label}</p>
          <p className={`text-xl font-bold mt-1 ${f.color}`}>{demandByFamily?.[f.key] || 0}</p>
        </div>
      ))}
    </div>
  );
}