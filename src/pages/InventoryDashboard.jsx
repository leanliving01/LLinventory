import React, { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/api/supabaseClient';
import KpiRow from '@/components/inventory-dashboard/KpiRow';
import ReorderSignalsPanel from '@/components/inventory-dashboard/ReorderSignalsPanel';
import VelocityTrendPanel from '@/components/inventory-dashboard/VelocityTrendPanel';
import WatchlistPanel from '@/components/inventory-dashboard/WatchlistPanel';

const TYPE_OPTIONS = [
  { value: 'all', label: 'All Categories' },
  { value: 'finished_meal', label: 'Finished Meals' },
  { value: 'supplement', label: 'Supplements' },
  { value: 'packaging', label: 'Packaging' },
  { value: 'raw', label: 'Raw Materials' },
  { value: 'sauce', label: 'Sauces' },
  { value: 'wip_bulk', label: 'WIP Bulk' },
];

/**
 * Inventory Dashboard ("Inventory Command Center").
 * Answers the three operator questions at a glance:
 *   1. What do I need to reorder?      → ReorderSignalsPanel
 *   2. What's selling / trending up?   → VelocityTrendPanel
 *   3. What's about to run out?        → WatchlistPanel
 * Background math lives in migration 081 (snapshot + trends + alerts).
 */
export default function InventoryDashboard() {
  const queryClient = useQueryClient();
  const [typeFilter, setTypeFilter] = useState('all');
  const [refreshing, setRefreshing] = useState(false);

  const refresh = async () => {
    setRefreshing(true);
    try {
      // Re-snapshot + regenerate alerts on demand, then refetch everything.
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
            What to reorder, what's trending, and what's about to run out — calculated in the background.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
            <SelectContent>
              {TYPE_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" className="gap-1.5" onClick={refresh} disabled={refreshing}>
            <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} /> Refresh
          </Button>
        </div>
      </div>

      {/* KPIs */}
      <KpiRow typeFilter={typeFilter} />

      {/* Reorder + Watchlist */}
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <ReorderSignalsPanel typeFilter={typeFilter} />
        </div>
        <div className="lg:col-span-1">
          <WatchlistPanel typeFilter={typeFilter} />
        </div>
      </div>

      {/* Velocity / trend intelligence */}
      <VelocityTrendPanel typeFilter={typeFilter} />
    </div>
  );
}
