import React from 'react';
import OperationalKPICard from './OperationalKPICard';
import getKpiStatus from '@/lib/getKpiStatus';
import {
  Factory, ShoppingCart, AlertTriangle, Truck,
  Package, Box, Trash2, PlayCircle, TrendingUp, FileX2,
  DollarSign, BarChart2, FileWarning, Layers, Receipt,
} from 'lucide-react';

function fmtZAR(val) {
  return 'R ' + (val || 0).toLocaleString('en-ZA', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

function SectionLabel({ label }) {
  return (
    <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest mt-1 mb-2">
      {label}
    </p>
  );
}

/**
 * Renders operational KPI cards grouped into labelled sections.
 * Clicking a card toggles a detail panel below (managed by parent).
 */
export default function OperationalKPISection({ data, financialData = {}, perms, activeCard, onCardSelect }) {
  const sections = [];

  // ── Fulfilment ──
  if (perms.dashboard_production) {
    const cards = [];
    cards.push({
      key: 'production_gap',
      title: 'Production Gap',
      value: data.productionGap,
      icon: Factory,
      status: data.productionGap <= 0 ? 'good' : data.productionGap > 50 ? 'bad' : 'warn',
      trendLabel: `${data.totalProduced} produced / ${data.totalOrdered} meal orders`,
      trendDirection: data.productionGap <= 0 ? 'good' : 'bad',
    });
    cards.push({
      key: 'orders_due',
      title: 'Pending Fulfilment',
      value: data.pendingOrders,
      icon: ShoppingCart,
      status: data.pendingOrders > 20 ? 'bad' : data.pendingOrders > 5 ? 'warn' : 'good',
      trendLabel: `${data.pendingMeals || 0} meals · ${data.ordersDueToday} today · ${data.ordersDueTomorrow} tomorrow`,
      trendDirection: data.pendingOrders > 5 ? 'bad' : 'good',
    });
    cards.push({
      key: 'active_runs',
      title: 'Active Runs',
      value: data.activeRunCount,
      icon: PlayCircle,
      status: data.activeRunCount > 0 ? 'info' : 'neutral',
      trendLabel: `${data.productionUnits} units in progress`,
    });
    if (data.avgYieldPct != null) {
      cards.push({
        key: 'yield_pct',
        title: 'Avg Cook Yield',
        value: `${data.avgYieldPct.toFixed(1)}%`,
        icon: TrendingUp,
        status: getKpiStatus(data.avgYieldPct, { good: v => v >= 85, warn: v => v >= 70 }),
        trendLabel: 'last 20 cooking runs',
      });
    }
    sections.push({ label: 'Production & Fulfilment', cards });
  }

  // ── Inventory ──
  if (perms.dashboard_shortages) {
    const cards = [];
    cards.push({
      key: 'low_stock',
      title: 'Low Stock Items',
      value: data.lowStockCount,
      icon: AlertTriangle,
      status: getKpiStatus(data.lowStockCount, 'lowStockCount'),
      trendLabel: `${data.criticalStockCount} critical (≤1 day cover)`,
      trendDirection: data.criticalStockCount > 0 ? 'bad' : 'good',
    });
    cards.push({
      key: 'packaging_stock',
      title: 'Packaging',
      value: data.packagingLowCount > 0 ? `${data.packagingLowCount} low` : 'OK',
      icon: Box,
      status: data.packagingLowCount > 0 ? 'warn' : 'good',
      trendLabel: `${data.packagingTotal} packaging SKUs tracked`,
    });
    sections.push({ label: 'Inventory Health', cards });
  }

  // ── Waste & Write-Offs ──
  if (perms.dashboard_production) {
    const cards = [];
    cards.push({
      key: 'wastage',
      title: 'Wastage',
      value: fmtZAR(data.wastageValue),
      icon: Trash2,
      status: getKpiStatus(data.wastageValue, 'wastageValue'),
      trendLabel: `${data.wastageLogCount} entries in period`,
    });
    cards.push({
      key: 'write_offs',
      title: 'Write-Offs',
      value: fmtZAR(data.writeOffValue),
      icon: FileX2,
      status: getKpiStatus(data.writeOffValue, { good: v => v === 0, warn: v => v < 1000 }),
      trendLabel: `${data.writeOffCount} event${data.writeOffCount !== 1 ? 's' : ''} in period`,
      trendDirection: data.writeOffValue > 0 ? 'bad' : 'good',
    });
    sections.push({ label: 'Waste & Write-Offs', cards });
  }

  // ── Financial Health (new section) ──
  if (perms.dashboard_costs && Object.keys(financialData).length > 0) {
    const cards = [];
    if (financialData.grossMarginPct != null) {
      const gm = financialData.grossMarginPct;
      cards.push({
        key: 'gross_margin',
        title: 'Gross Margin',
        value: `${gm.toFixed(1)}%`,
        icon: BarChart2,
        status: gm >= 50 ? 'good' : gm >= 40 ? 'warn' : 'bad',
        trendLabel: `Revenue − COGS`,
      });
    }
    if (financialData.wastagePct != null) {
      const wp = financialData.wastagePct;
      cards.push({
        key: 'wastage_pct',
        title: 'Wastage % of Production',
        value: `${wp.toFixed(1)}%`,
        icon: Trash2,
        status: wp < 3 ? 'good' : wp < 5 ? 'warn' : 'bad',
        trendLabel: 'Target: < 3%',
        trendDirection: wp < 3 ? 'good' : 'bad',
      });
    }
    if (financialData.avgCostPerMeal != null) {
      cards.push({
        key: 'avg_cost_meal',
        title: 'Avg Cost / Meal',
        value: fmtZAR(financialData.avgCostPerMeal),
        icon: DollarSign,
        status: 'neutral',
        trendLabel: 'Production pick cost ÷ meals portioned',
      });
    }
    if (financialData.unmatchedInvoiceCount != null) {
      const ui = financialData.unmatchedInvoiceCount;
      cards.push({
        key: 'unmatched_invoices',
        title: 'Unmatched Xero Bills',
        value: ui,
        icon: Receipt,
        status: ui === 0 ? 'good' : 'bad',
        trendLabel: ui > 0 ? 'Action required' : 'All matched',
        trendDirection: ui > 0 ? 'bad' : 'good',
      });
    }
    if (financialData.openShortageCount != null) {
      const os = financialData.openShortageCount;
      cards.push({
        key: 'open_shortages_fin',
        title: 'Open Shortages',
        value: os,
        icon: FileWarning,
        status: os === 0 ? 'good' : os <= 5 ? 'warn' : 'bad',
        trendLabel: os > 0 ? `${fmtZAR(financialData.openShortageValue || 0)} at risk` : 'No open shortages',
        trendDirection: os > 0 ? 'bad' : 'good',
      });
    }
    if (cards.length > 0) sections.push({ label: 'Financial Health', cards });
  }

  // ── Purchasing ──
  if (perms.dashboard_costs) {
    const cards = [];
    cards.push({
      key: 'overdue_pos',
      title: 'Overdue Deliveries',
      value: data.overduePOCount,
      icon: Truck,
      status: data.overduePOCount > 0 ? 'bad' : 'good',
      trendLabel: data.overduePOCount > 0
        ? `${fmtZAR(data.overduePOValue)} awaiting delivery`
        : 'All deliveries on track',
      trendDirection: data.overduePOCount > 0 ? 'bad' : 'good',
    });
    cards.push({
      key: 'po_open',
      title: 'Open POs',
      value: data.openPOCount,
      icon: Package,
      status: data.openPOCount > 0 ? 'info' : 'good',
      trendLabel: `${fmtZAR(data.poOutstanding)} awaiting delivery`,
    });
    sections.push({ label: 'Purchasing', cards });
  }

  if (sections.length === 0) return null;

  return (
    <div className="space-y-5">
      {sections.map(section => (
        <div key={section.label}>
          <SectionLabel label={section.label} />
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {section.cards.map(card => (
              <OperationalKPICard
                key={card.key}
                {...card}
                isActive={activeCard === card.key}
                onClick={() => onCardSelect(activeCard === card.key ? null : card.key)}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
