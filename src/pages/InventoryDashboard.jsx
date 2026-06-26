import React, { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/api/supabaseClient';
import { cn } from '@/lib/utils';
import { CATEGORY_GROUPS, ALL_GROUP, getGroup } from '@/lib/inventoryCategories';
import KpiRow from '@/components/inventory-dashboard/KpiRow';
import SalesTrendChart from '@/components/inventory-dashboard/SalesTrendChart';
import CategorySplitChart from '@/components/inventory-dashboard/CategorySplitChart';
import TrendingMovers from '@/components/inventory-dashboard/TrendingMovers';
import ReorderSignalsPanel from '@/components/inventory-dashboard/ReorderSignalsPanel';
import VelocityTrendPanel from '@/components/inventory-dashboard/VelocityTrendPanel';
import WatchlistPanel from '@/components/inventory-dashboard/WatchlistPanel';

const TABS = [ALL_GROUP, ...CATEGORY_GROUPS];

/**
 * Inventory Dashboard ("Inventory Command Center").
 * Category tabs (All / Meals / Supplements / Raw / Packaging) drive every panel.
 * Answers: what's selling & trending (90d vs this week), what to reorder, and
 * what's about to run out — all read-only; background math lives in migration 081.
 */
export default function InventoryDashboard() {
  const queryClient = useQueryClient();
  const [groupKey, setGroupKey] = useState('all');
  const [refreshing, setRefreshing] = useState(false);

  const group = getGroup(groupKey);
  const types = group.types; // null = all

  const refresh = async () => {
    setRefreshing(true);
    try {
      await supabase.rpc('snapshot_inventory_daily');
      await supabase.rpc('generate_inventory_alerts');
      await queryClient.invalidateQueries();
      toast.success('Inventory data refreshed');
    } catch (err) {
      toast.error('Refresh failed: ' + (err.message || 'Unknown error'));
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Inventory Dashboard</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            What's selling, what to reorder, and what's about to run out — 90-day trends vs this week.
          </p>
        </div>
        <Button variant="outline" size="sm" className="gap-1.5" onClick={refresh} disabled={refreshing}>
          <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} /> Refresh
        </Button>
      </div>

      {/* Category tabs */}
      <div className="flex items-center gap-1.5 flex-wrap border-b border-border pb-px">
        {TABS.map((g) => {
          const active = g.key === groupKey;
          return (
            <button
              key={g.key}
              onClick={() => setGroupKey(g.key)}
              className={cn(
                'flex items-center gap-2 px-3.5 py-2 text-sm font-medium rounded-t-md border-b-2 -mb-px transition-colors',
                active
                  ? 'border-primary text-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground hover:bg-muted/40'
              )}
            >
              {g.dot && <span className={cn('w-2 h-2 rounded-full', g.dot)} />}
              {g.label}
            </button>
          );
        })}
      </div>

      {/* KPIs */}
      <KpiRow types={types} />

      {/* Hero trend + category split */}
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <SalesTrendChart group={group} />
        </div>
        <div className="lg:col-span-1">
          <CategorySplitChart onSelect={(key) => key && setGroupKey(key)} />
        </div>
      </div>

      {/* Trending up / cooling down */}
      <TrendingMovers types={types} />

      {/* Reorder + Watchlist */}
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <ReorderSignalsPanel types={types} />
        </div>
        <div className="lg:col-span-1">
          <WatchlistPanel types={types} />
        </div>
      </div>

      {/* Velocity / trend intelligence */}
      <VelocityTrendPanel types={types} />
    </div>
  );
}
