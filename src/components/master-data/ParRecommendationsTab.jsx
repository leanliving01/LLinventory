import React, { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { RefreshCw, Check, X, TrendingUp, TrendingDown, Minus, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

const FAMILY_COLORS = {
  MWL: 'bg-blue-100 text-blue-700',
  MLM: 'bg-green-100 text-green-700',
  WWL: 'bg-pink-100 text-pink-700',
  WLM: 'bg-orange-100 text-orange-700',
  LOW_CARB: 'bg-yellow-100 text-yellow-700',
};

/**
 * Normalize a SKU code from the SKU entity format to the Product entity format.
 * "WLM-006" → "WLM6", "MLM-015" → "MLM15", "MWL-001" → "MWL1"; descriptive
 * (BYO) codes are returned as-is. Mirrors src/lib/demandBridge.js so a
 * recommendation (keyed by SKU.id) resolves to its products.sku row.
 */
function normalizeSKUCode(skuCode) {
  if (!skuCode) return null;
  const match = skuCode.match(/^([A-Z]+)-(\d+)$/);
  if (match) return `${match[1]}${parseInt(match[2], 10)}`;
  return skuCode;
}

export default function ParRecommendationsTab() {
  const queryClient = useQueryClient();
  const [calculating, setCalculating] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [applyingId, setApplyingId] = useState(null);
  const [dismissingId, setDismissingId] = useState(null);

  const { data: recommendations = [], isLoading } = useQuery({
    queryKey: ['parRecommendations'],
    queryFn: () => base44.entities.ParLevelRecommendation.filter({ status: 'pending' }, '-created_date', 200),
  });

  // Canonical par store: products.par_level (the single source of truth Production
  // Planning and the Par Levels tab read). Loaded so we can map a recommendation →
  // product and apply / display against the real column.
  const { data: products = [] } = useQuery({
    queryKey: ['finished-meals'],
    queryFn: () => base44.entities.Product.filter({ type: 'finished_meal', status: 'active' }, '-sku', 500),
  });

  // Legacy linkage — only used to resolve a recommendation's SKU.id → sku_code,
  // which we then normalize to products.sku. (par_levels itself is no longer written.)
  const { data: skus = [] } = useQuery({
    queryKey: ['skus'],
    queryFn: () => base44.entities.SKU.list('-sku_code', 500),
  });

  // SKU.id → products.sku (normalized), then products.sku → product row.
  const productSkuBySkuId = {};
  skus.forEach(s => {
    const norm = normalizeSKUCode(s.sku_code);
    if (norm) productSkuBySkuId[s.id] = norm;
  });
  const productBySku = {};
  products.forEach(p => { if (p.sku) productBySku[p.sku] = p; });

  // Resolve a recommendation to its canonical Product (via SKU.id → sku_code → products.sku).
  const productForRec = (rec) => {
    const productSku = productSkuBySkuId[rec.sku_id];
    return productSku ? productBySku[productSku] : undefined;
  };

  const handleSyncHistorical = async () => {
    setSyncing(true);
    try {
      const res = await base44.functions.invoke('syncHistoricalOrders', {});
      toast.success(`Synced ${res.data.new_orders_archived} new orders (${res.data.total_in_archive} total in archive)`);
    } catch (err) {
      toast.error('Failed to sync historical data: ' + (err.message || 'Unknown error'));
    }
    setSyncing(false);
  };

  const handleCalculate = async () => {
    setCalculating(true);
    try {
      const res = await base44.functions.invoke('calculateParRecommendations', {});
      toast.success(`Generated ${res.data.recommendations_generated} recommendations from ${res.data.orders_in_window} orders (${res.data.effective_weeks} weeks)`);
      queryClient.invalidateQueries({ queryKey: ['parRecommendations'] });
    } catch (err) {
      toast.error('Failed to calculate recommendations: ' + (err.message || 'Unknown error'));
    }
    setCalculating(false);
  };

  const handleApply = async (rec) => {
    setApplyingId(rec.id);
    try {
      // Write the canonical column directly — products.par_level is the single
      // source of truth Production Planning + the Par Levels tab read (the legacy
      // par_levels mirror is gone, see migration 071_drop_par_level_sync.sql).
      const product = productForRec(rec);
      if (!product) {
        toast.error(`Couldn't match "${rec.sku_display_name}" to a product — skipped`);
        return;
      }
      await base44.entities.Product.update(product.id, { par_level: rec.recommended_par_level });
      await base44.entities.ParLevelRecommendation.update(rec.id, { status: 'applied', notes: `Applied on ${new Date().toISOString().split('T')[0]}. ${rec.notes}` });
      queryClient.invalidateQueries({ queryKey: ['parRecommendations'] });
      queryClient.invalidateQueries({ queryKey: ['finished-meals'] });
      toast.success(`Applied par level ${rec.recommended_par_level} for ${rec.sku_display_name}`);
    } finally {
      setApplyingId(null);
    }
  };

  const handleDismiss = async (rec) => {
    setDismissingId(rec.id);
    await base44.entities.ParLevelRecommendation.update(rec.id, { status: 'dismissed', notes: `Dismissed on ${new Date().toISOString().split('T')[0]}. ${rec.notes}` });
    queryClient.invalidateQueries({ queryKey: ['parRecommendations'] });
    toast.info(`Dismissed recommendation for ${rec.sku_display_name}`);
    setDismissingId(null);
  };

  const handleApplyAll = async () => {
    for (const rec of recommendations) {
      await handleApply(rec);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <Button onClick={handleSyncHistorical} disabled={syncing} variant="outline" size="sm" className="gap-2">
            {syncing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
            {syncing ? 'Syncing...' : 'Sync Historical Data'}
          </Button>
          <Button onClick={handleCalculate} disabled={calculating} size="sm" className="gap-2">
            {calculating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <TrendingUp className="w-3.5 h-3.5" />}
            {calculating ? 'Calculating...' : 'Recalculate Recommendations'}
          </Button>
          {recommendations.length > 0 && (
            <Button onClick={handleApplyAll} variant="outline" size="sm" className="gap-2">
              <Check className="w-3.5 h-3.5" />
              Apply All ({recommendations.length})
            </Button>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          Rolling 6-month demand (always excl. December) + 15% safety buffer
        </p>
      </div>

      {isLoading ? (
        <div className="text-center py-12 text-muted-foreground text-sm">Loading recommendations...</div>
      ) : recommendations.length === 0 ? (
        <div className="bg-card border border-border rounded-xl p-8 text-center">
          <TrendingUp className="w-10 h-10 mx-auto mb-3 text-muted-foreground/40" />
          <p className="text-sm text-muted-foreground">No pending recommendations</p>
          <p className="text-xs text-muted-foreground mt-1">Click "Recalculate Now" to generate fresh recommendations based on historical demand.</p>
        </div>
      ) : (
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="bg-muted/50 border-b border-border">
                <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase">SKU</th>
                <th className="text-center px-4 py-3 text-xs font-semibold text-muted-foreground uppercase">Type</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-muted-foreground uppercase">Current</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-muted-foreground uppercase">Recommended</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-muted-foreground uppercase">Avg/Week</th>
                <th className="text-center px-4 py-3 text-xs font-semibold text-muted-foreground uppercase">Change</th>
                <th className="text-center px-4 py-3 text-xs font-semibold text-muted-foreground uppercase">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {recommendations.map(rec => {
                // "Current" = the canonical products.par_level (what production reads),
                // not the legacy par_levels snapshot baked into the recommendation.
                const product = productForRec(rec);
                const currentPar = product ? (product.par_level || 0) : (rec.current_par_level || 0);
                const diff = rec.recommended_par_level - currentPar;
                const isIncrease = diff > 0;
                const isDecrease = diff < 0;
                return (
                  <RecommendationRow
                    key={rec.id}
                    rec={rec}
                    currentPar={currentPar}
                    diff={diff}
                    isIncrease={isIncrease}
                    isDecrease={isDecrease}
                    applyingId={applyingId}
                    dismissingId={dismissingId}
                    onApply={handleApply}
                    onDismiss={handleDismiss}
                  />
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function RecommendationRow({ rec, currentPar, diff, isIncrease, isDecrease, applyingId, dismissingId, onApply, onDismiss }) {
  return (
    <tr className="hover:bg-muted/30 transition-colors">
      <td className="px-4 py-2.5 text-sm font-medium">{rec.sku_display_name}</td>
      <td className="px-4 py-2.5 text-center">
        <Badge className={cn("text-[10px]", FAMILY_COLORS[rec.package_type] || 'bg-gray-100 text-gray-700')}>
          {rec.package_type}
        </Badge>
      </td>
      <td className="px-4 py-2.5 text-right text-sm tabular-nums text-muted-foreground">{currentPar || '—'}</td>
      <td className="px-4 py-2.5 text-right text-sm tabular-nums font-semibold">{rec.recommended_par_level}</td>
      <td className="px-4 py-2.5 text-right text-sm tabular-nums text-muted-foreground">{rec.avg_weekly_demand}</td>
      <td className="px-4 py-2.5 text-center">
        <span className={cn(
          "inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full",
          isIncrease && "bg-emerald-100 text-emerald-700",
          isDecrease && "bg-red-100 text-red-700",
          !isIncrease && !isDecrease && "bg-gray-100 text-gray-600"
        )}>
          {isIncrease ? <TrendingUp className="w-3 h-3" /> : isDecrease ? <TrendingDown className="w-3 h-3" /> : <Minus className="w-3 h-3" />}
          {isIncrease ? '+' : ''}{diff}
        </span>
      </td>
      <td className="px-4 py-2.5 text-center">
        <div className="flex items-center justify-center gap-1">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => onApply(rec)}
            disabled={applyingId === rec.id}
            className="h-7 w-7 p-0 text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50"
          >
            {applyingId === rec.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => onDismiss(rec)}
            disabled={dismissingId === rec.id}
            className="h-7 w-7 p-0 text-red-500 hover:text-red-600 hover:bg-red-50"
          >
            {dismissingId === rec.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <X className="w-3.5 h-3.5" />}
          </Button>
        </div>
      </td>
    </tr>
  );
}