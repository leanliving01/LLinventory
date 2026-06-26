import React, { useState, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/api/supabaseClient';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { TrendingUp, TrendingDown, Minus, Check, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { typeInGroup } from '@/lib/inventoryCategories';
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid, ReferenceLine,
} from 'recharts';

async function fetchTrends() {
  const { data, error } = await supabase.rpc('inventory_trends');
  if (error) { console.error('[inventory_trends]', error.message); return []; }
  return data || [];
}

async function fetchWeekly(sku) {
  const { data, error } = await supabase.rpc('product_sales_weekly', { p_sku: sku, p_weeks: 13 });
  if (error) { console.error('[product_sales_weekly]', error.message); return []; }
  return data || [];
}

function MomentumPill({ pct }) {
  if (pct === null || pct === undefined) {
    return <span className="inline-flex items-center gap-1 text-xs text-muted-foreground"><Minus className="w-3 h-3" /> new</span>;
  }
  const up = pct >= 0;
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-semibold tabular-nums ${up ? 'text-status-good' : 'text-status-bad'}`}>
      {up ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />}
      {up ? '+' : ''}{pct}%
    </span>
  );
}

/**
 * Sales velocity / trend intelligence.
 * Left: movers table — this week vs 90-day baseline, days-of-cover, and a
 *       "bump par" suggestion (one-click apply, writes products.par_level).
 * Right: 13-week unit area chart for the selected mover, with the 90-day
 *        average as a reference line so the trend reads at a glance.
 */
export default function VelocityTrendPanel({ types = null }) {
  const queryClient = useQueryClient();
  const [selectedSku, setSelectedSku] = useState(null);
  const [applyingId, setApplyingId] = useState(null);

  const { data: trends = [], isLoading } = useQuery({
    queryKey: ['inventory-trends'],
    queryFn: fetchTrends,
    staleTime: 60000,
  });

  const rows = useMemo(() => {
    const list = trends.filter((t) => typeInGroup(t.type, types));
    return [...list].sort((a, b) => {
      const ma = a.momentum_pct ?? -999;
      const mb = b.momentum_pct ?? -999;
      if (mb !== ma) return mb - ma;
      return (b.units_week || 0) - (a.units_week || 0);
    });
  }, [trends, types]);

  const activeSku = selectedSku && rows.some((r) => r.sku === selectedSku) ? selectedSku : rows[0]?.sku || null;
  const activeRow = rows.find((r) => r.sku === activeSku);

  const { data: weekly = [] } = useQuery({
    queryKey: ['product-sales-weekly', activeSku],
    queryFn: () => fetchWeekly(activeSku),
    enabled: !!activeSku,
    staleTime: 60000,
  });

  // Drop the final bucket (current calendar week, still in progress) so the
  // chart shows complete weeks only and doesn't fake a dip.
  const chartData = (weekly.length > 1 ? weekly.slice(0, -1) : weekly).map((w) => ({
    week: new Date(w.week_start).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short' }),
    units: Number(w.units) || 0,
  }));

  const applyBump = async (row) => {
    setApplyingId(row.product_id);
    try {
      await base44.entities.Product.update(row.product_id, { par_level: Number(row.suggested_par) || 0 });
      queryClient.invalidateQueries({ queryKey: ['products-reorder'] });
      queryClient.invalidateQueries({ queryKey: ['inventory-trends'] });
      toast.success(`Par for ${row.name} set to ${row.suggested_par}`);
    } catch (err) {
      toast.error('Failed to set par: ' + (err.message || 'Unknown error'));
    } finally {
      setApplyingId(null);
    }
  };

  return (
    <div className="grid gap-4 lg:grid-cols-5">
      {/* Movers table */}
      <div className="lg:col-span-3 bg-card border border-border rounded-lg shadow-sm overflow-hidden">
        <div className="px-5 pt-5 pb-3">
          <h3 className="text-sm font-semibold text-foreground">What's Moving</h3>
          <p className="text-xs text-muted-foreground mt-0.5">This week vs 90-day average · suggested par bump when demand outpaces cover</p>
        </div>
        {isLoading ? (
          <div className="py-10 text-center text-sm text-muted-foreground">Loading…</div>
        ) : rows.length === 0 ? (
          <div className="py-10 text-center text-sm text-muted-foreground">No sales activity yet.</div>
        ) : (
          <div className="max-h-[440px] overflow-y-auto">
            <table className="w-full">
              <thead className="sticky top-0 bg-muted/80 backdrop-blur">
                <tr className="border-y border-border">
                  <th className="text-left px-3 py-2 text-[11px] font-semibold text-muted-foreground uppercase">Product</th>
                  <th className="text-right px-3 py-2 text-[11px] font-semibold text-muted-foreground uppercase">This wk</th>
                  <th className="text-right px-3 py-2 text-[11px] font-semibold text-muted-foreground uppercase" title="Average weekly sales over active selling weeks (last 90 days, excluding this week)">Avg/wk</th>
                  <th className="text-right px-3 py-2 text-[11px] font-semibold text-muted-foreground uppercase">Trend</th>
                  <th className="text-right px-3 py-2 text-[11px] font-semibold text-muted-foreground uppercase">Cover</th>
                  <th className="text-right px-3 py-2 text-[11px] font-semibold text-muted-foreground uppercase">Par</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((r) => {
                  const lowCover = r.days_of_cover !== null && r.days_of_cover < 7;
                  const suggestBump = Number(r.suggested_par) > Number(r.par_level || 0);
                  const isActive = r.sku === activeSku;
                  return (
                    <tr
                      key={r.product_id}
                      onClick={() => setSelectedSku(r.sku)}
                      className={`cursor-pointer transition-colors ${isActive ? 'bg-primary/5' : 'hover:bg-muted/30'}`}
                    >
                      <td className="px-3 py-2">
                        <p className="text-sm font-medium leading-tight">{r.name}</p>
                        <p className="text-[10px] font-mono text-muted-foreground">{r.sku}</p>
                      </td>
                      <td className="px-3 py-2 text-right text-sm font-semibold tabular-nums">{r.units_week}</td>
                      <td className="px-3 py-2 text-right text-sm text-muted-foreground tabular-nums">{r.weekly_baseline}</td>
                      <td className="px-3 py-2 text-right"><MomentumPill pct={r.momentum_pct} /></td>
                      <td className="px-3 py-2 text-right text-sm tabular-nums">
                        {r.days_of_cover === null ? (
                          <span className="text-muted-foreground">—</span>
                        ) : (
                          <span className={lowCover ? 'text-status-bad font-semibold' : 'text-muted-foreground'}>
                            {r.days_of_cover}d
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right">
                        {suggestBump ? (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 gap-1 text-xs"
                            disabled={applyingId === r.product_id}
                            onClick={(e) => { e.stopPropagation(); applyBump(r); }}
                          >
                            {applyingId === r.product_id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
                            {r.par_level || 0} → {r.suggested_par}
                          </Button>
                        ) : (
                          <span className="text-sm text-muted-foreground tabular-nums">{r.par_level || '—'}</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Trend chart for selected product */}
      <div className="lg:col-span-2 bg-card border border-border rounded-lg shadow-sm overflow-hidden">
        <div className="px-5 pt-5 pb-3">
          <h3 className="text-sm font-semibold text-foreground">{activeRow ? activeRow.name : '13-Week Sales'}</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            {activeRow ? `${activeRow.sku} · complete weeks · dashed = avg/wk` : 'Select a product'}
          </p>
        </div>
        <div className="px-3 pb-4">
          {chartData.length === 0 ? (
            <div className="h-[240px] flex items-center justify-center text-sm text-muted-foreground">No data</div>
          ) : (
            <ResponsiveContainer width="100%" height={240}>
              <AreaChart data={chartData} margin={{ top: 5, right: 10, bottom: 5, left: -12 }}>
                <defs>
                  <linearGradient id="velGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.25} />
                    <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                <XAxis dataKey="week" tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} interval="preserveStartEnd" />
                <YAxis tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} allowDecimals={false} width={32} />
                <Tooltip
                  contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid hsl(var(--border))', background: 'hsl(var(--card))' }}
                  labelStyle={{ color: 'hsl(var(--foreground))' }}
                />
                {activeRow?.weekly_baseline > 0 && (
                  <ReferenceLine y={Number(activeRow.weekly_baseline)} stroke="hsl(var(--muted-foreground))" strokeDasharray="4 4" strokeOpacity={0.6} />
                )}
                <Area type="monotone" dataKey="units" stroke="hsl(var(--primary))" strokeWidth={2} fill="url(#velGrad)" dot={{ r: 2 }} />
              </AreaChart>
            </ResponsiveContainer>
          )}
          {activeRow && (
            <div className="grid grid-cols-3 gap-2 mt-3 px-2 text-center">
              <div>
                <p className="text-[10px] text-muted-foreground uppercase tracking-wide">This wk</p>
                <p className="text-sm font-bold tabular-nums">{activeRow.units_week}</p>
              </div>
              <div>
                <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Avg/wk</p>
                <p className="text-sm font-bold tabular-nums">{activeRow.weekly_baseline}</p>
              </div>
              <div>
                <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Trend</p>
                <div className="flex justify-center"><MomentumPill pct={activeRow.momentum_pct} /></div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
