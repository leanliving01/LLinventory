import React from 'react';
import StatCard from './StatCard';
import {
  DollarSign, ShoppingCart, TrendingDown, TrendingUp,
  Factory, AlertTriangle, Package, Trash2
} from 'lucide-react';

function fmtZAR(val) {
  return 'R ' + (val || 0).toLocaleString('en-ZA', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

export default function KPICards({ data }) {
  const {
    revenue = 0,
    pendingOrders = 0,
    poSpend = 0,
    poOutstanding = 0,
    wastageValue = 0,
    productionRuns = 0,
    productionUnits = 0,
    lowStockCount = 0,
  } = data;

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      <StatCard
        title="Revenue"
        value={fmtZAR(revenue)}
        icon={DollarSign}
        variant="success"
      />
      <StatCard
        title="Pending Orders"
        value={pendingOrders}
        icon={ShoppingCart}
        variant={pendingOrders > 10 ? 'warning' : 'default'}
      />
      <StatCard
        title="PO Spend"
        value={fmtZAR(poSpend)}
        icon={TrendingUp}
        variant="info"
      />
      <StatCard
        title="PO Outstanding"
        value={fmtZAR(poOutstanding)}
        icon={TrendingDown}
        variant={poOutstanding > 0 ? 'warning' : 'default'}
      />
      <StatCard
        title="Wastage"
        value={fmtZAR(wastageValue)}
        icon={Trash2}
        variant={wastageValue > 0 ? 'danger' : 'success'}
      />
      <StatCard
        title="Production Runs"
        value={productionRuns}
        icon={Factory}
        variant="default"
        trendLabel={`${productionUnits} units`}
      />
      <StatCard
        title="Low Stock Items"
        value={lowStockCount}
        icon={AlertTriangle}
        variant={lowStockCount > 0 ? 'danger' : 'success'}
      />
      <StatCard
        title="Active Products"
        value={data.activeProducts || 0}
        icon={Package}
        variant="default"
      />
    </div>
  );
}