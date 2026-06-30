import React, { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { supabase } from '@/api/supabaseClient';
import StatCard from '@/components/dashboard/StatCard';
import { buildReorderItems, isAssembledOnDemand } from '@/lib/reorderSignals';
import { useStockLevels } from '@/lib/useStockLevels';
import { typeInGroup } from '@/lib/inventoryCategories';
import { DollarSign, PackageX, AlertTriangle, TrendingUp, Clock, Boxes } from 'lucide-react';

async function fetchTrends() {
  const { data, error } = await supabase.rpc('inventory_trends');
  if (error) { console.error('[inventory_trends]', error.message); return []; }
  return data || [];
}

async function fetchStockValue() {
  // Sum FIFO value from the latest daily snapshot (written by the nightly cron / seed).
  const { data: latest } = await supabase
    .from('inventory_daily_snapshot')
    .select('snapshot_date')
    .order('snapshot_date', { ascending: false })
    .limit(1);
  const day = latest?.[0]?.snapshot_date;
  if (!day) return null;
  const { data, error } = await supabase
    .from('inventory_daily_snapshot')
    .select('fifo_value, type')
    .eq('snapshot_date', day)
    .limit(5000);
  if (error) { console.error('[snapshot value]', error.message); return null; }
  return data || [];
}

export default function KpiRow({ types = null }) {
  const { data: products = [] } = useQuery({
    queryKey: ['products-reorder'],
    queryFn: () => base44.entities.Product.filter({ status: 'active' }, 'name', 500),
  });
  // Canonical, never-truncated per-product stock (RPC) — see lib/useStockLevels.js.
  const { rows: stockRecords = [] } = useStockLevels();
  const { data: trends = [] } = useQuery({
    queryKey: ['inventory-trends'],
    queryFn: fetchTrends,
    staleTime: 60000,
  });
  const { data: valueRows = [] } = useQuery({
    queryKey: ['inventory-stock-value'],
    queryFn: fetchStockValue,
    staleTime: 300000,
  });

  const kpis = useMemo(() => {
    const items = buildReorderItems({ products, stockRecords })
      .filter((p) => typeInGroup(p.type, types));

    const outOfStock = items.filter((p) => p.severity === 'critical').length;
    const toReorder = items.filter((p) => p.is_below).length;
    const belowPar = items.filter(
      (p) => !isAssembledOnDemand(p) && (p.par_level || 0) > 0 && p.total_available < p.par_level
    ).length;

    const tRows = trends.filter((t) => typeInGroup(t.type, types));
    const trendingUp = tRows.filter((t) => (t.momentum_pct ?? 0) >= 30).length;
    const lowCover = tRows.filter((t) => t.days_of_cover !== null && t.days_of_cover < 7).length;
    const weeklyUnits = tRows.reduce((s, t) => s + (Number(t.units_week) || 0), 0);

    const stockValue = (Array.isArray(valueRows) ? valueRows : [])
      .filter((r) => typeInGroup(r.type, types))
      .reduce((s, r) => s + (Number(r.fifo_value) || 0), 0);

    return { outOfStock, toReorder, belowPar, trendingUp, lowCover, weeklyUnits, stockValue };
  }, [products, stockRecords, trends, valueRows, types]);

  const valueDisplay = kpis.stockValue ? `R${Math.round(kpis.stockValue).toLocaleString()}` : '—';

  return (
    <div className="grid gap-3 grid-cols-2 md:grid-cols-3 lg:grid-cols-6">
      <StatCard title="Stock Value" value={valueDisplay} icon={DollarSign} status="info" />
      <StatCard title="Units / Week" value={Math.round(kpis.weeklyUnits)} icon={Boxes} status="neutral"
        trendLabel="last 7 days" />
      <StatCard title="Out of Stock" value={kpis.outOfStock} icon={PackageX}
        status={kpis.outOfStock === 0 ? 'good' : 'bad'} />
      <StatCard title="To Reorder" value={kpis.toReorder} icon={AlertTriangle}
        status={kpis.toReorder === 0 ? 'good' : kpis.toReorder <= 3 ? 'warn' : 'bad'} />
      <StatCard title="Trending Up" value={kpis.trendingUp} icon={TrendingUp} status="info" />
      <StatCard title="Low Cover (<7d)" value={kpis.lowCover} icon={Clock}
        status={kpis.lowCover === 0 ? 'good' : 'warn'} />
    </div>
  );
}
