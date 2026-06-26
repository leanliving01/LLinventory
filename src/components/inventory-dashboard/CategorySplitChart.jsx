import React, { useMemo } from 'react';
import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip } from 'recharts';
import { useSalesWeeklyByType } from '@/hooks/useSalesWeeklyByType';
import { CATEGORY_GROUPS, groupForType } from '@/lib/inventoryCategories';

/**
 * This-week sales split across category groups — a donut so you can see at a
 * glance whether meals, supplements, raw, or packaging is driving demand.
 * Always shows all categories (independent of the selected tab).
 */
export default function CategorySplitChart({ onSelect }) {
  const { data: rows = [], isLoading } = useSalesWeeklyByType(13);

  const slices = useMemo(() => {
    // Latest week present in the data.
    const weeks = [...new Set(rows.map((r) => r.week_start))].sort((a, b) => new Date(b) - new Date(a));
    const lastWeek = weeks[0];
    const totals = new Map(CATEGORY_GROUPS.map((g) => [g.key, 0]));
    for (const r of rows) {
      if (r.week_start !== lastWeek) continue;
      const g = groupForType(r.type);
      if (!g) continue;
      totals.set(g.key, (totals.get(g.key) || 0) + (Number(r.units) || 0));
    }
    return CATEGORY_GROUPS
      .map((g) => ({ key: g.key, name: g.short, value: totals.get(g.key) || 0, color: g.chart }))
      .filter((s) => s.value > 0);
  }, [rows]);

  const total = slices.reduce((s, x) => s + x.value, 0);

  return (
    <div className="bg-card border border-border rounded-lg shadow-sm overflow-hidden h-full">
      <div className="px-5 pt-5 pb-2">
        <h3 className="text-sm font-semibold text-foreground">This Week by Category</h3>
        <p className="text-xs text-muted-foreground mt-0.5">Share of units sold</p>
      </div>
      <div className="px-3 pb-4">
        {isLoading ? (
          <div className="h-[220px] flex items-center justify-center text-sm text-muted-foreground">Loading…</div>
        ) : slices.length === 0 ? (
          <div className="h-[220px] flex items-center justify-center text-sm text-muted-foreground">No sales this week yet.</div>
        ) : (
          <div className="flex items-center gap-3">
            <ResponsiveContainer width="55%" height={200}>
              <PieChart>
                <Pie
                  data={slices}
                  dataKey="value"
                  nameKey="name"
                  innerRadius={48}
                  outerRadius={80}
                  paddingAngle={2}
                  onClick={(d) => onSelect?.(d?.key)}
                >
                  {slices.map((s) => (
                    <Cell key={s.key} fill={s.color} className="cursor-pointer" />
                  ))}
                </Pie>
                <Tooltip
                  formatter={(v, n) => [`${v} units`, n]}
                  contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid hsl(var(--border))', background: 'hsl(var(--card))' }}
                />
              </PieChart>
            </ResponsiveContainer>
            <ul className="flex-1 space-y-1.5">
              {slices.map((s) => (
                <li key={s.key}>
                  <button
                    onClick={() => onSelect?.(s.key)}
                    className="flex items-center justify-between w-full text-left hover:bg-muted/40 rounded px-2 py-1 transition-colors"
                  >
                    <span className="flex items-center gap-2 text-xs">
                      <span className="w-2.5 h-2.5 rounded-sm" style={{ background: s.color }} />
                      {s.name}
                    </span>
                    <span className="text-xs font-semibold tabular-nums">
                      {total ? Math.round((s.value / total) * 100) : 0}%
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
