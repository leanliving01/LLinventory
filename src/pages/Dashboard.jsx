import React, { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { format, subDays, isWithinInterval, startOfDay } from 'date-fns';
import { Clock } from 'lucide-react';
import { useAuth } from '@/lib/AuthContext';
import { getUserPermissions } from '@/lib/permissions';
import { useCustomRoles } from '@/components/settings/CustomRolesManager';

import DateRangePicker from '@/components/dashboard/DateRangePicker';
import KPICards from '@/components/dashboard/KPICards';
import RevenueChart from '@/components/dashboard/RevenueChart';
import PackageBreakdownChart from '@/components/dashboard/PackageBreakdownChart';
import ProductionChart from '@/components/dashboard/ProductionChart';
import WastageChart from '@/components/dashboard/WastageChart';
import RecentRunsList from '@/components/dashboard/RecentRunsList';
import POAgingTable from '@/components/dashboard/POAgingTable';
import ShortageTable from '@/components/dashboard/ShortageTable';

export default function Dashboard() {
  const { user } = useAuth();
  const customRoles = useCustomRoles();
  const perms = getUserPermissions(user || {}, customRoles);

  const now = new Date();
  const [from, setFrom] = useState(subDays(now, 30));
  const [to, setTo] = useState(now);

  const handleDateChange = (newFrom, newTo) => { setFrom(newFrom); setTo(newTo); };

  // Helper: is a record within the date range?
  const inRange = (dateStr) => {
    if (!dateStr) return false;
    const d = new Date(dateStr);
    return isWithinInterval(d, { start: startOfDay(from), end: to });
  };

  // ── Data fetching ──
  const queryOpts = { staleTime: 60000, retry: 2, retryDelay: 3000 };

  const { data: salesOrders = [] } = useQuery({
    queryKey: ['dash-sales'],
    queryFn: () => base44.entities.SalesOrder.list('-order_date', 200),
    ...queryOpts,
  });

  const { data: shopifyOrders = [] } = useQuery({
    queryKey: ['dash-shopify-orders'],
    queryFn: () => base44.entities.ShopifyOrder.list('-order_date', 200),
    ...queryOpts,
  });

  const { data: purchaseOrders = [] } = useQuery({
    queryKey: ['dash-pos'],
    queryFn: () => base44.entities.PurchaseOrder.list('-order_date', 100),
    ...queryOpts,
  });

  const { data: productionRuns = [] } = useQuery({
    queryKey: ['dash-runs'],
    queryFn: () => base44.entities.ProductionRun.list('-run_date', 50),
    ...queryOpts,
  });

  const { data: wastageLogs = [] } = useQuery({
    queryKey: ['dash-wastage'],
    queryFn: () => base44.entities.WastageLog.list('-wastage_date', 50),
    ...queryOpts,
  });

  const { data: products = [] } = useQuery({
    queryKey: ['dash-products'],
    queryFn: () => base44.entities.Product.filter({ status: 'active' }, 'name', 200),
    ...queryOpts,
  });

  const { data: stockRecords = [] } = useQuery({
    queryKey: ['dash-stock'],
    queryFn: () => base44.entities.StockOnHand.list('-updated_date', 500),
    ...queryOpts,
  });

  // ── Filter to date range ──
  const rangedSales = useMemo(() => salesOrders.filter(o => inRange(o.order_date)), [salesOrders, from, to]);
  const rangedShopify = useMemo(() => shopifyOrders.filter(o => inRange(o.order_date)), [shopifyOrders, from, to]);
  const rangedPOs = useMemo(() => purchaseOrders.filter(o => inRange(o.order_date)), [purchaseOrders, from, to]);
  const rangedRuns = useMemo(() => productionRuns.filter(r => inRange(r.run_date)), [productionRuns, from, to]);
  const rangedWastage = useMemo(() => wastageLogs.filter(w => inRange(w.wastage_date)), [wastageLogs, from, to]);

  // ── KPI calculations ──
  const kpiData = useMemo(() => {
    const revenue = rangedSales.reduce((s, o) => s + (o.total_amount || 0), 0);
    const pendingOrders = salesOrders.filter(o => o.fulfillment_status === 'unfulfilled' && o.payment_status === 'paid').length;
    const poSpend = rangedPOs
      .filter(po => !['draft', 'cancelled'].includes(po.status))
      .reduce((s, po) => s + (po.total || 0), 0);
    const poOutstanding = purchaseOrders
      .filter(po => ['confirmed', 'partially_received', 'received', 'invoiced'].includes(po.status) && po.payment_status !== 'paid')
      .reduce((s, po) => s + (po.total || 0), 0);
    const wastageValue = rangedWastage.reduce((s, w) => s + (w.total_rand_value || 0), 0);
    const completedRuns = rangedRuns.filter(r => r.status === 'completed' || r.status === 'in_progress');
    const productionUnits = completedRuns.reduce((s, r) => s + (r.total_units || 0), 0);

    // Low stock: products with reorder point where on-hand < reorder point
    let lowStockCount = 0;
    products.forEach(p => {
      if (p.min_before_reorder > 0) {
        const soh = stockRecords.filter(s => s.product_id === p.id).reduce((sum, s) => sum + (s.qty_on_hand || 0), 0);
        if (soh < p.min_before_reorder) lowStockCount++;
      }
    });

    return {
      revenue,
      pendingOrders,
      poSpend,
      poOutstanding,
      wastageValue,
      productionRuns: rangedRuns.length,
      productionUnits,
      lowStockCount,
      activeProducts: products.length,
    };
  }, [rangedSales, rangedPOs, rangedRuns, rangedWastage, salesOrders, purchaseOrders, products, stockRecords]);

  // ── Shortage table (same as before but from products/stock) ──
  const shortages = useMemo(() => {
    const list = [];
    products.forEach(p => {
      if (p.min_before_reorder > 0) {
        const soh = stockRecords.filter(s => s.product_id === p.id).reduce((sum, s) => sum + (s.qty_on_hand || 0), 0);
        if (soh < p.min_before_reorder) {
          list.push({
            meal_name: p.name,
            package_type: p.type,
            shortage: p.min_before_reorder - soh,
            sku_code: p.sku,
          });
        }
      }
    });
    return list.sort((a, b) => b.shortage - a.shortage);
  }, [products, stockRecords]);

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Dashboard</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {format(new Date(), 'EEEE, d MMMM yyyy')}
          </p>
        </div>
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground tabular-nums">
          <Clock className="w-3.5 h-3.5" strokeWidth={1.5} />
          Updated {format(new Date(), 'HH:mm')}
        </div>
      </div>

      {/* Date Range */}
      <DateRangePicker from={from} to={to} onChange={handleDateChange} />

      {/* KPI Cards */}
      {perms.dashboard_kpis && <KPICards data={kpiData} />}

      {/* Charts Row 1: Revenue + Package Breakdown */}
      {perms.dashboard_revenue && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <RevenueChart orders={rangedSales} from={from} to={to} />
          <PackageBreakdownChart orders={rangedShopify} />
        </div>
      )}

      {/* Charts Row 2: Production + Wastage */}
      {perms.dashboard_production && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <ProductionChart runs={rangedRuns} />
          <WastageChart wastageLogs={rangedWastage} />
        </div>
      )}

      {/* Bottom Row: Recent Runs + PO Aging + Shortages */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {perms.dashboard_production && <RecentRunsList runs={rangedRuns} />}
        {perms.dashboard_costs && <POAgingTable purchaseOrders={purchaseOrders} />}
        {perms.dashboard_shortages && <ShortageTable items={shortages} />}
      </div>
    </div>
  );
}