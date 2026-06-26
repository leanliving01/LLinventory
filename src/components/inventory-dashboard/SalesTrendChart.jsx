import React, { useMemo } from 'react';
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid,
} from 'recharts';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { useSalesWeeklyByType } from '@/hooks/useSalesWeeklyByType';
import { typeInGroup } from '@/lib/inventoryCategories';

/**
 * Hero trend chart — total weekly units over the last 13 weeks for the selected
 * category group, with a headline "this week vs 90-day average" delta.
 */
export default function SalesTrendChart({ group }) {
  const { data: rows = [], isLoading } = useSalesWeeklyByType(13);
  const types = group?.types || null;

  const { chartData, thisWeek, avgWeekly, deltaPct } = useMemo(() => {
    // Sum the group's types per week.
    const byWeek = new Map();
    for (const r of rows) {
      if (!typeInGroup(r.type, types)) continue;
      const wk = r.week_start;
      byWeek.set(wk, (byWeek.get(wk) || 0) + (Number(r.units) || 0));
    }
    // Ensure every week present in the data (incl. NULL-type anchors) is on the axis.
    for (const r of rows) if (!byWeek.has(r.week_start)) byWeek.set(r.week_start, 0);

    const sorted = [...byWeek.entries()].sort((a, b) => new Date(a[0]) - new Date(b[0]));
    const data = sorted.map(([wk, units]) => ({
      week: new Date(wk).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short' }),
      units,
    }));
    const last = sorted.length ? sorted[sorted.length - 1][1] : 0;
    const total = sorted.reduce((s, [, u]) => s + u, 0);
    const avg = sorted.length ? total / sorted.length : 0;
    const delta = avg > 0 ? Math.round((last - avg) / avg * 100) : null;
    return { chartData: data, thisWeek: last, avgWeekly: avg, deltaPct: delta };
  }, [rows, types]);

  const up = deltaPct !== null && deltaPct >= 0;

  return (
    <div className="bg-card border border-border rounded-lg shadow-sm overflow-hidden h-full">
      <div className="flex items-start justify-between px-5 pt-5 pb-2">
        <div>
          <h3 className="text-sm font-semibold text-foreground">{group?.label || 'All Inventory'} — Weekly Sales</h3>
          <p className="text-xs text-muted-foreground mt-0.5">Units sold per week · last 13 weeks</p>
        </div>
        <div className="text-right">
          <p className="text-2xl font-bold tabular-nums leading-none">{Math.round(thisWeek)}</p>
          <div className="flex items-center justify-end gap-1 mt-1">
            {deltaPct === null ? (
              <span className="text-xs text-muted-foreground inline-flex items-center gap-1"><Minus className="w-3 h-3" /> —</span>
            ) : (
              <span className={`text-xs font-semibold inline-flex items-center gap-1 ${up ? 'text-status-good' : 'text-status-bad'}`}>
                {up ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />}
                {up ? '+' : ''}{deltaPct}% vs avg
              </span>
            )}
          </div>
        </div>
      </div>
      <div className="px-3 pb-4">
        {isLoading ? (
          <div className="h-[220px] flex items-center justify-center text-sm text-muted-foreground">Loading…</div>
        ) : chartData.every((d) => d.units === 0) ? (
          <div className="h-[220px] flex items-center justify-center text-sm text-muted-foreground">No sales in this window yet.</div>
        ) : (
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={chartData} margin={{ top: 5, right: 12, bottom: 5, left: -12 }}>
              <defs>
                <linearGradient id="trendGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="hsl(var(--chart-1))" stopOpacity={0.3} />
                  <stop offset="100%" stopColor="hsl(var(--chart-1))" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
              <XAxis dataKey="week" tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} interval="preserveStartEnd" />
              <YAxis tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} allowDecimals={false} width={32} />
              <Tooltip
                contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid hsl(var(--border))', background: 'hsl(var(--card))' }}
                labelStyle={{ color: 'hsl(var(--foreground))' }}
              />
              <Area type="monotone" dataKey="units" stroke="hsl(var(--chart-1))" strokeWidth={2} fill="url(#trendGrad)" />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}
