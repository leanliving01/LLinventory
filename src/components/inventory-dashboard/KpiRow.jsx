import React, { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { supabase } from '@/api/supabaseClient';
import StatCard from '@/components/dashboard/StatCard';
import { buildReorderItems, isAssembledOnDemand } from '@/lib/reorderSignals';
import { DollarSign, PackageX, AlertTriangle, TrendingUp, Clock } from 'lucide-react';

async function fetchTrends() {
  const { data, error } = await supabase.rpc('inventory_trends', { p_window: 7 });
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
    .select('fifo_value')
    .eq('snapshot_date', day)
    .limit(5000);
  if (error) { console.error('[snapshot value]', error.message); return null; }
  return (data || []).reduce((sum, r) => sum + (Number(r.fifo_value) || 0), 0);
}

export default function KpiRow({ typeFilter = 'all' }) {
  const { data: products = [] } = useQuery({
    queryKey: ['products-reorder'],
    queryFn: () => base44.entities.Product.filter({ status: 'active' }, 'name', 500),
  });
  const { data: stockRecords = [] } = useQuery({
    queryKey: ['stock-on-hand-reorder'],
    queryFn: () => base44.entities.StockOnHand.list('-updated_date', 2000),
  });
  const { data: trends = [] } = useQuery({
    queryKey: ['inventory-trends', 7],
    queryFn: fetchTrends,
    staleTime: 60000,
  });
  const { data: stockValue } = useQuery({
    queryKey: ['inventory-stock-value'],
    queryFn: fetchStockValue,
    staleTime: 300000,
  });

  const kpis = useMemo(() => {
    const items = buildReorderItems({ products, stockRecords })
      .filter((p) => typeFilter === 'all' || p.type === typeFilter);

    const outOfStock = items.filter((p) => p.severity === 'critical').length;
    const toReorder = items.filter((p) => p.is_below).length;
    const belowPar = items.filter(
      (p) => !isAssembledOnDemand(p) && (p.par_level || 0) > 0 && p.total_available < p.par_level
    ).length;

    const tRows = trends.filter((t) => typeFilter === 'all' || t.type === typeFilter);
    const trendingUp = tRows.filter((t) => (t.momentum_pct ?? 0) >= 30).length;
    const lowCover = tRows.filter((t) => t.days_of_cover !== null && t.days_of_cover < 7).length;

    return { outOfStock, toReorder, belowPar, trendingUp, lowCover };
  }, [products, stockRecords, trends, typeFilter]);

  const valueDisplay =
    stockValue == null ? '—' : `R${Math.round(stockValue).toLocaleString()}`;

  return (
    <div className="grid gap-3 grid-cols-2 md:grid-cols-3 lg:grid-cols-6">
      <StatCard title="Stock Value" value={valueDisplay} icon={DollarSign} status="info" />
      <StatCard title="Out of Stock" value={kpis.outOfStock} icon={PackageX}
        status={kpis.outOfStock === 0 ? 'good' : 'bad'} />
      <StatCard title="To Reorder" value={kpis.toReorder} icon={AlertTriangle}
        status={kpis.toReorder === 0 ? 'good' : kpis.toReorder <= 3 ? 'warn' : 'bad'} />
      <StatCard title="Below Par" value={kpis.belowPar} icon={AlertTriangle}
        status={kpis.belowPar === 0 ? 'good' : 'warn'} />
      <StatCard title="Trending Up" value={kpis.trendingUp} icon={TrendingUp} status="info" />
      <StatCard title="Low Cover (<7d)" value={kpis.lowCover} icon={Clock}
        status={kpis.lowCover === 0 ? 'good' : 'warn'} />
    </div>
  );
}
