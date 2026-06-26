import React, { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { supabase } from '@/api/supabaseClient';
import { Badge } from '@/components/ui/badge';
import { Clock, ArrowRight } from 'lucide-react';
import { typeInGroup } from '@/lib/inventoryCategories';

async function fetchTrends() {
  const { data, error } = await supabase.rpc('inventory_trends');
  if (error) { console.error('[inventory_trends]', error.message); return []; }
  return data || [];
}

/**
 * Risk watchlist — items whose stock will run out soonest given the forecast
 * sales rate (GREATEST of 90-day baseline and this week). Reads the same
 * inventory_trends cache as the velocity panel (no extra fetch).
 */
export default function WatchlistPanel({ types = null, limit = 10 }) {
  const { data: trends = [] } = useQuery({
    queryKey: ['inventory-trends'],
    queryFn: fetchTrends,
    staleTime: 60000,
  });

  const atRisk = useMemo(() => {
    return trends
      .filter((t) => typeInGroup(t.type, types))
      .filter((t) => t.days_of_cover !== null && t.weekly_rate > 0)
      .sort((a, b) => a.days_of_cover - b.days_of_cover)
      .slice(0, limit);
  }, [trends, types, limit]);

  return (
    <div className="bg-card border border-border rounded-lg shadow-sm overflow-hidden">
      <div className="flex items-center justify-between px-5 pt-5 pb-3">
        <div>
          <h3 className="text-sm font-semibold text-foreground">Running Out Soonest</h3>
          <p className="text-xs text-muted-foreground mt-0.5">Days of cover at the forecast sales rate</p>
        </div>
        <Link to="/reports" className="text-xs text-primary hover:underline inline-flex items-center gap-1">
          Dead stock <ArrowRight className="w-3.5 h-3.5" />
        </Link>
      </div>

      {atRisk.length === 0 ? (
        <div className="py-10 text-center text-sm text-muted-foreground">No at-risk items.</div>
      ) : (
        <ul className="divide-y divide-border">
          {atRisk.map((r) => {
            const critical = r.days_of_cover < 7;
            return (
              <li key={r.product_id} className="flex items-center justify-between px-5 py-2.5 hover:bg-muted/30 transition-colors">
                <div className="min-w-0">
                  <p className="text-sm font-medium leading-tight truncate">{r.name}</p>
                  <p className="text-[10px] font-mono text-muted-foreground">{r.sku} · {r.qty_available} on hand · {r.weekly_rate}/wk</p>
                </div>
                <Badge className={`text-[11px] gap-1 ${critical ? 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300' : 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300'}`}>
                  <Clock className="w-3 h-3" /> {r.days_of_cover}d
                </Badge>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
