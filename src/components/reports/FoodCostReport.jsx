import React, { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { format, subDays, isWithinInterval, startOfDay } from 'date-fns';
import ReportDateFilter from './ReportDateFilter';
import { downloadCSV } from '@/lib/csvExport';

export default function FoodCostReport() {
  const now = new Date();
  const [from, setFrom] = useState(subDays(now, 30));
  const [to, setTo] = useState(now);

  const { data: sales = [] } = useQuery({
    queryKey: ['report-fc-sales'],
    queryFn: () => base44.entities.SalesOrder.list('-order_date', 1000),
  });

  // COGS = actual materials consumed in production (production_pick movements)
  const { data: pickMovements = [] } = useQuery({
    queryKey: ['report-fc-pick-movements'],
    queryFn: () => base44.entities.StockMovement.filter({ reason: 'production_pick' }, '-created_date', 2000),
  });

  // Purchases = value of confirmed GRNs (goods actually received, not just ordered)
  const { data: grnLines = [] } = useQuery({
    queryKey: ['report-fc-grn-lines'],
    queryFn: () => base44.entities.GRNLine.list('-created_date', 2000),
  });

  const { data: grns = [] } = useQuery({
    queryKey: ['report-fc-grns'],
    queryFn: () => base44.entities.GoodsReceivedNote.filter({ status: 'confirmed' }, '-received_date', 500),
  });

  const { data: wastage = [] } = useQuery({
    queryKey: ['report-fc-wastage'],
    queryFn: () => base44.entities.WastageLog.list('-wastage_date', 200),
  });

  const { data: runs = [] } = useQuery({
    queryKey: ['report-fc-runs'],
    queryFn: () => base44.entities.ProductionRun.list('-run_date', 200),
  });

  const data = useMemo(() => {
    const inRange = (d) => d && isWithinInterval(new Date(d), { start: startOfDay(from), end: to });

    const revenue = sales
      .filter(s => inRange(s.order_date) && !['cancelled', 'refunded'].includes(s.status))
      .reduce((sum, s) => sum + (s.total_amount || 0), 0);

    // True COGS: cost of raw materials actually consumed (pulled into production)
    const materialsCost = pickMovements
      .filter(m => inRange(m.created_date))
      .reduce((sum, m) => sum + ((m.qty || 0) * (m.unit_cost_at_movement || 0)), 0);

    // Purchases: confirmed GRN value (goods received — for cash flow context, not COGS)
    const confirmedGrnIds = new Set(grns.filter(g => inRange(g.received_date)).map(g => g.id));
    const purchasesReceived = grnLines
      .filter(l => confirmedGrnIds.has(l.grn_id))
      .reduce((sum, l) => sum + (l.line_total || 0), 0);

    const wasteValue = wastage
      .filter(w => inRange(w.wastage_date))
      .reduce((sum, w) => sum + (w.total_rand_value || 0), 0);

    const prodRuns = runs.filter(r => inRange(r.run_date));
    const totalUnits = prodRuns.reduce((sum, r) => sum + (r.total_units || 0), 0);

    // COGS = materials consumed + wastage
    const cogs = materialsCost + wasteValue;
    const grossProfit = revenue - cogs;
    const grossMargin = revenue > 0 ? (grossProfit / revenue) * 100 : 0;
    const foodCostPct = revenue > 0 ? (cogs / revenue) * 100 : 0;
    const costPerUnit = totalUnits > 0 ? cogs / totalUnits : 0;

    return { revenue, materialsCost, purchasesReceived, wasteValue, cogs, grossProfit, grossMargin, foodCostPct, totalUnits, costPerUnit };
  }, [sales, pickMovements, grnLines, grns, wastage, runs, from, to]);

  const handleExport = () => {
    downloadCSV('food_cost_report.csv', [{
      period: `${format(from, 'dd MMM yyyy')} - ${format(to, 'dd MMM yyyy')}`,
      revenue: data.revenue,
      materials_consumed: data.materialsCost,
      purchases_received: data.purchasesReceived,
      wastage: data.wasteValue,
      cogs: data.cogs,
      gross_profit: data.grossProfit,
      gross_margin_pct: data.grossMargin.toFixed(1),
      food_cost_pct: data.foodCostPct.toFixed(1),
      units_produced: data.totalUnits,
      cost_per_unit: data.costPerUnit.toFixed(2),
    }]);
  };

  return (
    <div className="space-y-4">
      <ReportDateFilter from={from} to={to} onChange={(f, t) => { setFrom(f); setTo(t); }} onExportCSV={handleExport} onPrint={() => window.print()} />

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <MetricCard label="Revenue" value={`R ${Math.round(data.revenue).toLocaleString()}`} color="text-foreground" />
        <MetricCard label="Materials Consumed" value={`R ${Math.round(data.materialsCost).toLocaleString()}`} color="text-blue-700" bg="bg-blue-50 border-blue-200" />
        <MetricCard label="Wastage" value={`R ${Math.round(data.wasteValue).toLocaleString()}`} color="text-red-700" bg="bg-red-50 border-red-200" />
        <MetricCard label="COGS" value={`R ${Math.round(data.cogs).toLocaleString()}`} color="text-foreground" />
        <MetricCard label="Gross Profit" value={`R ${Math.round(data.grossProfit).toLocaleString()}`} color={data.grossProfit >= 0 ? 'text-green-700' : 'text-red-700'} bg={data.grossProfit >= 0 ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'} />
        <MetricCard label="Gross Margin" value={`${data.grossMargin.toFixed(1)}%`} color={data.grossMargin >= 30 ? 'text-green-700' : 'text-amber-700'} bg={data.grossMargin >= 30 ? 'bg-green-50 border-green-200' : 'bg-amber-50 border-amber-200'} />
      </div>

      <div className="bg-card border border-border rounded-xl p-5 space-y-3">
        <h4 className="text-sm font-semibold">Breakdown</h4>
        <BreakdownRow label="Food Cost %" value={`${data.foodCostPct.toFixed(1)}%`} note="COGS ÷ Revenue · target < 35%" ok={data.foodCostPct > 0 && data.foodCostPct < 35} />
        <BreakdownRow label="Units Produced" value={data.totalUnits.toLocaleString()} />
        <BreakdownRow label="Cost per Unit" value={`R ${data.costPerUnit.toFixed(2)}`} />
        <BreakdownRow label="Wastage as % of COGS" value={data.cogs > 0 ? `${((data.wasteValue / data.cogs) * 100).toFixed(1)}%` : '—'} note="Target < 5%" ok={data.cogs > 0 && (data.wasteValue / data.cogs) * 100 < 5} />
        <BreakdownRow label="Purchases Received (cash)" value={`R ${Math.round(data.purchasesReceived).toLocaleString()}`} note="Confirmed GRN value — for cash flow, not COGS" />
      </div>
    </div>
  );
}

function MetricCard({ label, value, color, bg }) {
  return (
    <div className={`rounded-lg px-4 py-3 border ${bg || 'bg-muted/50 border-border'}`}>
      <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">{label}</p>
      <p className={`text-xl font-bold mt-0.5 ${color || 'text-foreground'}`}>{value}</p>
    </div>
  );
}

function BreakdownRow({ label, value, note, ok }) {
  return (
    <div className="flex items-center justify-between py-2 border-b border-border last:border-0">
      <div>
        <p className="text-sm font-medium">{label}</p>
        {note && <p className="text-[10px] text-muted-foreground">{note}</p>}
      </div>
      <p className={`text-sm font-bold ${ok === true ? 'text-green-600' : ok === false ? 'text-red-600' : 'text-foreground'}`}>{value}</p>
    </div>
  );
}