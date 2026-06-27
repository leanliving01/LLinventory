import React, { useMemo, useState } from 'react';
import { startOfMonth } from 'date-fns';
import { Package, Boxes, Truck, Trophy, MapPin, RotateCcw } from 'lucide-react';
import DateRangePicker from '@/components/dashboard/DateRangePicker';
import { formatZAR } from '@/lib/utils';
import { packageLabel, tierMeta, marginColor } from '@/lib/profitVisual';
import {
  useOrderProfitOrders, useOrderProfitLines, summariseOrders, groupProfit,
} from '@/components/order-profitability/useOrderProfit';
import MealBoxGauge from '@/components/order-profitability/MealBoxGauge';
import ProfitKpiRow from '@/components/order-profitability/ProfitKpiRow';
import GroupProfitPanel from '@/components/order-profitability/GroupProfitPanel';
import ProvinceProfitChart from '@/components/order-profitability/ProvinceProfitChart';
import ProfitTrendChart from '@/components/order-profitability/ProfitTrendChart';
import OrdersProfitTable from '@/components/order-profitability/OrdersProfitTable';

const ORDER_OPTS = { revenueField: 'product_revenue', cogsField: 'product_cogs', profitField: 'net_profit' };
const prov = (v) => v || 'Unknown';

function Select({ label, value, onChange, options }) {
  return (
    <label className="flex items-center gap-1.5 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)}
        className="h-8 rounded-md border border-border bg-card px-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary">
        <option value="">All</option>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </label>
  );
}

export default function OrderProfitability() {
  const [from, setFrom] = useState(() => startOfMonth(new Date()));
  const [to, setTo] = useState(() => new Date());
  const [filters, setFilters] = useState({ pack_family: '', province: '', fulfillment: '' });

  const { data: orders = [], isLoading: lo, isError: eo } = useOrderProfitOrders(from, to);
  const { data: lines = [], isLoading: ll } = useOrderProfitLines(from, to);
  const loading = lo || ll;

  // Option lists from the raw window.
  const opts = useMemo(() => {
    const pkgs = [...new Set(lines.map((l) => l.pack_family))].filter(Boolean)
      .map((k) => ({ value: k, label: packageLabel(k) }));
    const provs = [...new Set(orders.map((o) => prov(o.shipping_province)))]
      .map((k) => ({ value: k, label: k }));
    const ful = [...new Set(orders.map((o) => o.fulfillment_type))].filter(Boolean)
      .map((k) => ({ value: k, label: k }));
    return { pkgs, provs, ful };
  }, [lines, orders]);

  // Apply cross-cutting filters.
  const orderIdsWithPackage = useMemo(() => {
    if (!filters.pack_family) return null;
    return new Set(lines.filter((l) => l.pack_family === filters.pack_family).map((l) => l.order_id));
  }, [lines, filters.pack_family]);

  const fOrders = useMemo(() => orders.filter((o) =>
    (!filters.province || prov(o.shipping_province) === filters.province) &&
    (!filters.fulfillment || o.fulfillment_type === filters.fulfillment) &&
    (!orderIdsWithPackage || orderIdsWithPackage.has(o.order_id))
  ), [orders, filters, orderIdsWithPackage]);

  const fLines = useMemo(() => lines.filter((l) =>
    (!filters.pack_family || l.pack_family === filters.pack_family) &&
    (!filters.province || prov(l.shipping_province) === filters.province) &&
    (!filters.fulfillment || l.fulfillment_type === filters.fulfillment)
  ), [lines, filters]);

  const summary = useMemo(() => summariseOrders(fOrders), [fOrders]);

  const packSizeGroups = useMemo(() =>
    groupProfit(fLines.filter((l) => l.is_package_parent && l.pack_size), (l) => l.pack_size)
      .map((g) => ({ ...g, label: `${g.key}-Meal Pack`, sizeNum: Number(g.key) }))
      .sort((a, b) => a.sizeNum - b.sizeNum),
  [fLines]);

  const packageGroups = useMemo(() =>
    groupProfit(fLines, (l) => l.pack_family).map((g) => ({ ...g, label: packageLabel(g.key) })),
  [fLines]);

  const provinceGroups = useMemo(() =>
    groupProfit(fOrders, (o) => prov(o.shipping_province), ORDER_OPTS).map((g) => ({ ...g, label: g.key })),
  [fOrders]);

  const fulfillmentGroups = useMemo(() =>
    groupProfit(fOrders, (o) => o.fulfillment_type, ORDER_OPTS).map((g) => ({ ...g, label: g.key })),
  [fOrders]);

  // Hero highlights.
  const best = useMemo(() => {
    const byProfit = (arr) => [...arr].filter((g) => g.revenue > 0).sort((a, b) => b.profit - a.profit)[0];
    return {
      pack: byProfit(packSizeGroups),
      pkg: byProfit(packageGroups),
      province: byProfit(provinceGroups),
    };
  }, [packSizeGroups, packageGroups, provinceGroups]);

  const tier = tierMeta(summary.netMargin);
  const hasFilters = filters.pack_family || filters.province || filters.fulfillment;

  // Data-quality guard: orders whose COGS exceeds revenue point at inflated BOM
  // cost data (known Low-Carb / packaging cost issue), not real losses. Surface
  // it so the red gauges aren't read as genuine — the same COGS the per-order
  // profitability card uses, so this flags a data gap, not a dashboard bug.
  const suspect = useMemo(() => {
    const bad = fOrders.filter((o) => o.product_revenue > 0 && o.product_cogs > o.product_revenue);
    return { count: bad.length, share: fOrders.length ? bad.length / fOrders.length : 0 };
  }, [fOrders]);

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Order Profitability</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Where the money is made — by pack size, meal package, province and fulfillment.
          </p>
        </div>
        <DateRangePicker from={from} to={to} onChange={(f, t) => { setFrom(f); setTo(t); }} />
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap bg-card border border-border rounded-lg px-4 py-2.5">
        <Select label="Package" value={filters.pack_family}
          onChange={(v) => setFilters((s) => ({ ...s, pack_family: v }))} options={opts.pkgs} />
        <Select label="Province" value={filters.province}
          onChange={(v) => setFilters((s) => ({ ...s, province: v }))} options={opts.provs} />
        <Select label="Fulfillment" value={filters.fulfillment}
          onChange={(v) => setFilters((s) => ({ ...s, fulfillment: v }))} options={opts.ful} />
        {hasFilters && (
          <button onClick={() => setFilters({ pack_family: '', province: '', fulfillment: '' })}
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
            <RotateCcw className="w-3 h-3" /> Reset
          </button>
        )}
        <span className="text-[11px] text-muted-foreground ml-auto tabular-nums">
          {loading ? 'Loading…' : `${summary.orderCount} orders · ${formatZAR(summary.revenue)} revenue`}
        </span>
      </div>

      {eo && (
        <div className="bg-status-bad/10 border border-status-bad/30 text-status-bad text-sm rounded-lg px-4 py-3">
          Couldn't load profitability data. The analytics functions (migration 084) may not be applied yet.
        </div>
      )}

      {suspect.share > 0.05 && (
        <div className="bg-status-warn/10 border border-status-warn/30 text-foreground text-sm rounded-lg px-4 py-3 flex items-start gap-2">
          <span className="text-base leading-none mt-0.5">⚠️</span>
          <div>
            <p className="font-semibold">Cost data needs attention</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {suspect.count} of {summary.orderCount} orders show COGS above revenue — caused by inflated
              BOM cost data on some packages (notably Low Carb), not real losses. These use the same costing
              as the per-order profitability card, so margins below read low until the BOM costs are corrected.
            </p>
          </div>
        </div>
      )}

      {/* Hero: signature meal-box gauge + highlights */}
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="bg-card border border-border rounded-lg shadow-sm p-5 flex flex-col items-center justify-center">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1">Average Order Margin</p>
          <MealBoxGauge margin={summary.netMargin} size={190} />
          <p className="text-sm font-semibold mt-1" style={{ color: tier.color }}>{tier.emoji} {tier.label} margin</p>
          <p className="text-xs text-muted-foreground tabular-nums mt-0.5">
            {formatZAR(summary.avgProfit)} avg net profit / order
          </p>
        </div>

        <div className="lg:col-span-2 grid sm:grid-cols-2 gap-4">
          <HighlightCard icon={Trophy} title="Most profitable pack"
            primary={best.pack ? best.pack.label : '—'}
            margin={best.pack?.margin} value={best.pack ? formatZAR(best.pack.profit) + ' profit' : 'No package sales'} />
          <HighlightCard icon={Package} title="Top meal package"
            primary={best.pkg ? best.pkg.label : '—'}
            margin={best.pkg?.margin} value={best.pkg ? formatZAR(best.pkg.profit) + ' profit' : '—'} />
          <HighlightCard icon={MapPin} title="Best province"
            primary={best.province ? best.province.label : '—'}
            margin={best.province?.margin} value={best.province ? formatZAR(best.province.profit) + ' profit' : '—'} />
          <HighlightCard icon={Boxes} title="Total net profit"
            primary={formatZAR(summary.netProfit)}
            margin={summary.netMargin} value={`${Math.round(summary.netMargin)}% margin · ${summary.orderCount} orders`} />
        </div>
      </div>

      {/* KPIs */}
      <ProfitKpiRow summary={summary} />

      {/* Profit trend */}
      <ProfitTrendChart orders={fOrders} />

      {/* Pack size + meal package */}
      <div className="grid gap-4 lg:grid-cols-2">
        <GroupProfitPanel title="Profit by Pack Size" subtitle="Product margin per package size — which box earns most"
          icon={Boxes} groups={packSizeGroups} gaugeCount={4} />
        <GroupProfitPanel title="Profit by Meal Package" subtitle="Which range pulls its weight"
          icon={Package} groups={packageGroups} gaugeCount={3} />
      </div>

      {/* Province + fulfillment */}
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2"><ProvinceProfitChart groups={provinceGroups} /></div>
        <div className="lg:col-span-1">
          <GroupProfitPanel title="Fulfillment Method" subtitle="Pickup vs courier vs door-to-door"
            icon={Truck} groups={fulfillmentGroups} gaugeCount={0} metric="profit" />
        </div>
      </div>

      {/* Drill-down */}
      <OrdersProfitTable orders={fOrders} />
    </div>
  );
}

function HighlightCard({ icon: Icon, title, primary, value, margin }) {
  const col = margin != null ? marginColor(margin) : 'hsl(var(--muted-foreground))';
  return (
    <div className="bg-card border border-border rounded-lg shadow-sm p-4 flex flex-col justify-between card-lift">
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">{title}</p>
        <div className="p-1.5 rounded-md" style={{ background: `${col}1a` }}>
          <Icon className="w-4 h-4" strokeWidth={1.75} style={{ color: col }} />
        </div>
      </div>
      <div className="mt-2">
        <p className="text-lg font-bold text-foreground leading-tight">{primary}</p>
        <p className="text-xs text-muted-foreground tabular-nums mt-0.5">{value}</p>
      </div>
    </div>
  );
}
