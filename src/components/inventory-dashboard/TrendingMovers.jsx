import React, { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/api/supabaseClient';
import { TrendingUp, TrendingDown } from 'lucide-react';
import { typeInGroup } from '@/lib/inventoryCategories';

async function fetchTrends() {
  const { data, error } = await supabase.rpc('inventory_trends');
  if (error) { console.error('[inventory_trends]', error.message); return []; }
  return data || [];
}

function MoverList({ title, icon: Icon, rows, positive }) {
  return (
    <div className="bg-card border border-border rounded-lg shadow-sm overflow-hidden">
      <div className="flex items-center gap-2 px-5 pt-4 pb-2">
        <Icon className={`w-4 h-4 ${positive ? 'text-status-good' : 'text-status-bad'}`} />
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      </div>
      {rows.length === 0 ? (
        <div className="py-6 text-center text-xs text-muted-foreground">Nothing notable.</div>
      ) : (
        <ul className="divide-y divide-border">
          {rows.map((r) => (
            <li key={r.product_id} className="flex items-center justify-between px-5 py-2">
              <div className="min-w-0">
                <p className="text-sm font-medium leading-tight truncate">{r.name}</p>
                <p className="text-[10px] font-mono text-muted-foreground">
                  {r.units_week}/wk · 90d avg {r.weekly_baseline}
                </p>
              </div>
              <span className={`text-sm font-bold tabular-nums shrink-0 ${positive ? 'text-status-good' : 'text-status-bad'}`}>
                {positive ? '+' : ''}{r.momentum_pct}%
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Two side-by-side cards: products accelerating vs cooling off, measured as
 * this week against their own 90-day average (momentum_pct).
 */
export default function TrendingMovers({ types = null, limit = 5 }) {
  const { data: trends = [] } = useQuery({
    queryKey: ['inventory-trends'],
    queryFn: fetchTrends,
    staleTime: 60000,
  });

  const { up, down } = useMemo(() => {
    const list = trends
      .filter((t) => typeInGroup(t.type, types))
      .filter((t) => t.momentum_pct !== null && t.units_week > 0);
    const sorted = [...list].sort((a, b) => b.momentum_pct - a.momentum_pct);
    return {
      up: sorted.filter((t) => t.momentum_pct > 0).slice(0, limit),
      down: sorted.filter((t) => t.momentum_pct < 0).reverse().slice(0, limit),
    };
  }, [trends, types, limit]);

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <MoverList title="Trending Up" icon={TrendingUp} rows={up} positive />
      <MoverList title="Cooling Down" icon={TrendingDown} rows={down} positive={false} />
    </div>
  );
}
