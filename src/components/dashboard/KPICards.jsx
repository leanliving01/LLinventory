import React from 'react';
import StatCard from './StatCard';
import getKpiStatus from '@/lib/getKpiStatus';
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
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      <StatCard
        title="Revenue"
        value={fmtZAR(revenue)}
        icon={DollarSign}
        status={getKpiStatus(revenue, 'revenue')}
      />
      <StatCard
        title="Pending Orders"
        value={pendingOrders}
        icon={ShoppingCart}
        status={getKpiStatus(pendingOrders, 'pendingOrders')}
      />
      <StatCard
        title="PO Spend"
        value={fmtZAR(poSpend)}
        icon={TrendingUp}
        status={getKpiStatus(poSpend, 'poSpend')}
      />
      <StatCard
        title="PO Outstanding"
        value={fmtZAR(poOutstanding)}
        icon={TrendingDown}
        status={getKpiStatus(poOutstanding, 'poOutstanding')}
      />
      <StatCard
        title="Wastage"
        value={fmtZAR(wastageValue)}
        icon={Trash2}
        status={getKpiStatus(wastageValue, 'wastageValue')}
      />
      <StatCard
        title="Production Runs"
        value={productionRuns}
        icon={Factory}
        status={getKpiStatus(productionRuns, 'productionRuns')}
        trendLabel={`${productionUnits} units produced`}
      />
      <StatCard
        title="Low Stock Items"
        value={lowStockCount}
        icon={AlertTriangle}
        status={getKpiStatus(lowStockCount, 'lowStockCount')}
      />
      <StatCard
        title="Active Products"
        value={data.activeProducts || 0}
        icon={Package}
        status={getKpiStatus(data.activeProducts, 'activeProducts')}
      />
    </div>
  );
}