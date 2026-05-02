import React, { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { subDays, isWithinInterval, startOfDay, isToday, isTomorrow } from 'date-fns';
import { Clock } from 'lucide-react';
import { formatDateSAST, formatTimeSAST } from '@/lib/dateUtils';
import { useAuth } from '@/lib/AuthContext';
import { getUserPermissions } from '@/lib/permissions';
import { useCustomRoles } from '@/components/settings/CustomRolesManager';

import DateRangePicker from '@/components/dashboard/DateRangePicker';
import OperationalKPISection from '@/components/dashboard/OperationalKPISection';
import ProductionGapChart from '@/components/dashboard/ProductionGapChart';
import ProductionChart from '@/components/dashboard/ProductionChart';
import WastageChart from '@/components/dashboard/WastageChart';
import ActiveRunsProgress from '@/components/dashboard/ActiveRunsProgress';
import OrdersDueList from '@/components/dashboard/OrdersDueList';
import StockCoverTable from '@/components/dashboard/StockCoverTable';
import PackagingStockTable from '@/components/dashboard/PackagingStockTable';
import OverduePOsTable from '@/components/dashboard/OverduePOsTable';
import POAgingTable from '@/components/dashboard/POAgingTable';
import ShortageTable from '@/components/dashboard/ShortageTable';
import RecentRunsList from '@/components/dashboard/RecentRunsList';

export default function Dashboard() {
  const { user } = useAuth();
  const customRoles = useCustomRoles();
  const perms = getUserPermissions(user || {}, customRoles);

  const now = new Date();
  const [from, setFrom] = useState(subDays(now, 7));
  const [to, setTo] = useState(now);
  const [activeCard, setActiveCard] = useState(null);

  const handleDateChange = (newFrom, newTo) => { setFrom(newFrom); setTo(newTo); };

  const inRange = (dateStr) => {
    if (!dateStr) return false;
    const d = new Date(dateStr);
    return isWithinInterval(d, { start: startOfDay(from), end: to });
  };

  // ── Data fetching ──
  const queryOpts = { staleTime: 60000, retry: 2, retryDelay: 3000 };

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

  const { data: productionTasks = [] } = useQuery({
    queryKey: ['dash-tasks'],
    queryFn: () => base44.entities.ProductionTask.filter({ archived: false }, '-created_date', 500),
    ...queryOpts,
  });

  const { data: wastageLogs = [] } = useQuery({
    queryKey: ['dash-wastage'],
    queryFn: () => base44.entities.WastageLog.list('-wastage_date', 50),
    ...queryOpts,
  });

  const { data: products = [] } = useQuery({
    queryKey: ['dash-products'],
    queryFn: () => base44.entities.Product.filter({ status: 'active' }, 'name', 500),
    ...queryOpts,
  });

  const { data: stockRecords = [] } = useQuery({
    queryKey: ['dash-stock'],
    queryFn: () => base44.entities.StockOnHand.list('-updated_date', 500),
    ...queryOpts,
  });

  // ── Filter to date range ──
  const rangedRuns = useMemo(() => productionRuns.filter(r => inRange(r.run_date)), [productionRuns, from, to]);
  const rangedShopify = useMemo(() => shopifyOrders.filter(o => inRange(o.order_date)), [shopifyOrders, from, to]);
  const rangedWastage = useMemo(() => wastageLogs.filter(w => inRange(w.wastage_date)), [wastageLogs, from, to]);

  // ── KPI calculations ──
  const kpiData = useMemo(() => {
    // Only count orders that actually have meals (exclude supplement-only / zero-meal orders)
    const mealOrders = (list) => list.filter(o => (o.total_meals || 0) > 0);

    // Production gap — compare production output vs. meal demand in the date range
    const totalProduced = rangedRuns
      .filter(r => r.status === 'completed' || r.status === 'in_progress')
      .reduce((s, r) => s + (r.total_units || 0), 0);
    const totalOrdered = mealOrders(rangedShopify).reduce((s, o) => s + (o.total_meals || 0), 0);
    const productionGap = Math.max(0, totalOrdered - totalProduced);

    // Pending fulfilment — paid + unfulfilled orders with actual meals
    const pendingFulfilment = shopifyOrders.filter(
      o => o.paid_status === 'paid' && o.fulfilment_status === 'unfulfilled' && (o.total_meals || 0) > 0
    );
    const pendingOrders = pendingFulfilment.length;
    const pendingMeals = pendingFulfilment.reduce((s, o) => s + (o.total_meals || 0), 0);
    const ordersDueToday = pendingFulfilment.filter(
      o => o.order_date && isToday(new Date(o.order_date))
    ).length;
    const ordersDueTomorrow = pendingFulfilment.filter(
      o => o.order_date && isTomorrow(new Date(o.order_date))
    ).length;

    // Active runs
    const activeRuns = productionRuns.filter(r => r.status === 'in_progress' || r.status === 'scheduled');
    const activeRunCount = activeRuns.length;
    const productionUnits = activeRuns.reduce((s, r) => s + (r.total_units || 0), 0);

    // Low stock & stock cover
    let lowStockCount = 0;
    let criticalStockCount = 0;
    products.forEach(p => {
      if (p.min_before_reorder > 0) {
        const soh = stockRecords.filter(s => s.product_id === p.id).reduce((sum, s) => sum + (s.qty_on_hand || 0), 0);
        if (soh < p.min_before_reorder) {
          lowStockCount++;
          const dailyUse = (p.lead_time_days > 0 && p.reorder_qty > 0) ? p.reorder_qty / p.lead_time_days : 0;
          const daysCover = dailyUse > 0 ? soh / dailyUse : soh > 0 ? 999 : 0;
          if (daysCover <= 1) criticalStockCount++;
        }
      }
    });

    // Packaging
    const packagingProducts = products.filter(p => p.type === 'packaging');
    const packagingTotal = packagingProducts.length;
    const packagingLowCount = packagingProducts.filter(p => {
      if (p.min_before_reorder <= 0) return false;
      const soh = stockRecords.filter(s => s.product_id === p.id).reduce((sum, s) => sum + (s.qty_on_hand || 0), 0);
      return soh < p.min_before_reorder;
    }).length;

    // Wastage
    const wastageValue = rangedWastage.reduce((s, w) => s + (w.total_rand_value || 0), 0);
    const wastageLogCount = rangedWastage.length;

    // Overdue POs — only delivery-awaiting statuses (confirmed, partially_received)
    // "invoiced" means the bill exists but goods were received — that's accounts-payable, not overdue delivery
    const overduePOs = purchaseOrders.filter(po => {
      if (!['confirmed', 'partially_received'].includes(po.status)) return false;
      if (!po.expected_date) return false;
      return new Date(po.expected_date) < now;
    });
    const overduePOCount = overduePOs.length;
    const overduePOValue = overduePOs.reduce((s, po) => s + (po.total || 0), 0);

    // Open POs — awaiting delivery only (not invoiced/payment items)
    const openPOs = purchaseOrders.filter(
      po => ['draft', 'confirmed', 'partially_received'].includes(po.status)
    );
    const openPOCount = openPOs.length;
    const poOutstanding = openPOs.reduce((s, po) => s + (po.total || 0), 0);

    // Unpaid invoices — invoiced but not paid (accounts-payable, not procurement)
    const unpaidInvoices = purchaseOrders.filter(
      po => po.status === 'invoiced' && po.payment_status !== 'paid'
    );
    const unpaidInvoiceCount = unpaidInvoices.length;
    const unpaidInvoiceValue = unpaidInvoices.reduce((s, po) => s + (po.total || 0), 0);

    return {
      totalProduced, totalOrdered, productionGap,
      pendingOrders, pendingMeals, ordersDueToday, ordersDueTomorrow,
      activeRunCount, productionUnits,
      lowStockCount, criticalStockCount,
      packagingTotal, packagingLowCount,
      wastageValue, wastageLogCount,
      overduePOCount, overduePOValue,
      openPOCount, poOutstanding,
      unpaidInvoiceCount, unpaidInvoiceValue,
    };
  }, [rangedRuns, rangedShopify, rangedWastage, shopifyOrders, purchaseOrders, products, stockRecords]);

  // ── Shortage table ──
  const shortages = useMemo(() => {
    const list = [];
    products.forEach(p => {
      if (p.min_before_reorder > 0) {
        const soh = stockRecords.filter(s => s.product_id === p.id).reduce((sum, s) => sum + (s.qty_on_hand || 0), 0);
        if (soh < p.min_before_reorder) {
          list.push({ meal_name: p.name, package_type: p.type, shortage: p.min_before_reorder - soh, sku_code: p.sku });
        }
      }
    });
    return list.sort((a, b) => b.shortage - a.shortage);
  }, [products, stockRecords]);

  // ── Map active card to detail panel ──
  const renderDetailPanel = () => {
    switch (activeCard) {
      case 'production_gap':
        return <ProductionGapChart runs={rangedRuns} runLines={[]} orders={rangedShopify} from={from} to={to} />;
      case 'orders_due':
        return <OrdersDueList orders={shopifyOrders} />;
      case 'active_runs':
        return <ActiveRunsProgress runs={productionRuns} tasks={productionTasks} />;
      case 'low_stock':
        return <StockCoverTable products={products} stockRecords={stockRecords} />;
      case 'packaging_stock':
        return <PackagingStockTable products={products} stockRecords={stockRecords} />;
      case 'wastage':
        return <WastageChart wastageLogs={rangedWastage} />;
      case 'overdue_pos':
        return <OverduePOsTable purchaseOrders={purchaseOrders} />;
      case 'po_open':
        return <POAgingTable purchaseOrders={purchaseOrders} />;
      default:
        return null;
    }
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Operations Dashboard</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {formatDateSAST(new Date())}
          </p>
        </div>
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground tabular-nums">
          <Clock className="w-3.5 h-3.5" strokeWidth={1.5} />
          Updated {formatTimeSAST(new Date())}
        </div>
      </div>

      {/* Date Range */}
      <DateRangePicker from={from} to={to} onChange={handleDateChange} />

      {/* Interactive KPI Cards */}
      {perms.dashboard_kpis && (
        <OperationalKPISection
          data={kpiData}
          perms={perms}
          activeCard={activeCard}
          onCardSelect={setActiveCard}
        />
      )}

      {/* Detail panel — appears below KPIs when a card is clicked */}
      {activeCard && (
        <div className="animate-in fade-in slide-in-from-top-2 duration-200">
          {renderDetailPanel()}
        </div>
      )}

      {/* Always-visible bottom panels */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {perms.dashboard_production && <RecentRunsList runs={rangedRuns} />}
        {perms.dashboard_costs && <POAgingTable purchaseOrders={purchaseOrders} />}
        {perms.dashboard_shortages && <ShortageTable items={shortages} />}
      </div>
    </div>
  );
}