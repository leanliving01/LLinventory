import React, { useState } from 'react';
import OperationalKPICard from './OperationalKPICard';
import getKpiStatus from '@/lib/getKpiStatus';
import {
  Factory, ShoppingCart, AlertTriangle, Truck,
  Package, Box, Trash2, PlayCircle,
} from 'lucide-react';

function fmtZAR(val) {
  return 'R ' + (val || 0).toLocaleString('en-ZA', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

/**
 * Renders operational KPI cards in grouped rows.
 * Clicking a card toggles a detail panel below.
 * `activeCard` / `onCardSelect` are controlled by parent.
 */
export default function OperationalKPISection({ data, perms, activeCard, onCardSelect }) {
  const cards = [];

  // ── Production & Fulfilment ──
  if (perms.dashboard_production) {
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
  }

  // ── Inventory Health ──
  if (perms.dashboard_shortages) {
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
  }

  // ── Wastage ──
  if (perms.dashboard_production) {
    cards.push({
      key: 'wastage',
      title: 'Wastage',
      value: fmtZAR(data.wastageValue),
      icon: Trash2,
      status: getKpiStatus(data.wastageValue, 'wastageValue'),
      trendLabel: `${data.wastageLogCount} entries in period`,
    });
  }

  // ── Supplier & Purchasing ──
  if (perms.dashboard_costs) {
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
  }

  if (cards.length === 0) return null;

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {cards.map(card => (
          <OperationalKPICard
            key={card.key}
            {...card}
            isActive={activeCard === card.key}
            onClick={() => onCardSelect(activeCard === card.key ? null : card.key)}
          />
        ))}
      </div>
    </div>
  );
}