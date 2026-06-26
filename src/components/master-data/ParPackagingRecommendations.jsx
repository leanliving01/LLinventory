import React, { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { supabase } from '@/api/supabaseClient';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Check, TrendingUp, TrendingDown, Minus, Loader2, Boxes, Info } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { getSubcategoryColor } from '@/lib/productClassification';

/**
 * Packaging par recommendations — sales-driven, derived from each meal's recipe.
 *
 * Calls the packaging_par_recommendations() RPC (migration 079), which explodes
 * the trailing 6-/12-month meal sales through every meal BOM's packaging
 * components (sleeve, sticker, plate, vacuum bag, pouch, film…) and returns a
 * suggested par = max(6-mo, 12-mo) weekly rate × cover weeks × (1 + safety).
 * Apply writes products.par_level (same canonical store the Par Levels tab and
 * Production Planning read) — propose-only until the user clicks.
 */
export default function ParPackagingRecommendations() {
  const queryClient = useQueryClient();
  const [coverWeeks, setCoverWeeks] = useState(4);
  const [coverInput, setCoverInput] = useState('4');
  const [applyingId, setApplyingId] = useState(null);
  const [applyingAll, setApplyingAll] = useState(false);

  const { data: rows = [], isLoading, isError, error } = useQuery({
    queryKey: ['packaging-par-recs', coverWeeks],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('packaging_par_recommendations', {
        p_cover_weeks: coverWeeks,
        p_safety: 0.15,
      });
      if (error) throw new Error(error.message);
      return data || [];
    },
  });

  const applyCover = () => {
    const n = Number(coverInput);
    if (!Number.isNaN(n) && n > 0) setCoverWeeks(n);
  };

  const applyOne = async (row) => {
    setApplyingId(row.packaging_product_id);
    try {
      await base44.entities.Product.update(row.packaging_product_id, { par_level: Number(row.suggested_par) });
      queryClient.invalidateQueries({ queryKey: ['par-products'] });
      queryClient.invalidateQueries({ queryKey: ['packaging-par-recs'] });
      toast.success(`Set ${row.packaging_name} par to ${row.suggested_par}`);
    } catch (err) {
      toast.error('Apply failed: ' + (err.message || 'Unknown error'));
    } finally {
      setApplyingId(null);
    }
  };

  const applyAll = async () => {
    setApplyingAll(true);
    try {
      for (const row of rows) {
        await base44.entities.Product.update(row.packaging_product_id, { par_level: Number(row.suggested_par) });
      }
      queryClient.invalidateQueries({ queryKey: ['par-products'] });
      queryClient.invalidateQueries({ queryKey: ['packaging-par-recs'] });
      toast.success(`Applied ${rows.length} packaging par levels`);
    } catch (err) {
      toast.error('Apply all failed: ' + (err.message || 'Unknown error'));
    } finally {
      setApplyingAll(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-end gap-3">
          <div>
            <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider block mb-1">Weeks of cover</label>
            <div className="flex items-center gap-2">
              <Input
                type="number"
                min="1"
                value={coverInput}
                onChange={e => setCoverInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') applyCover(); }}
                className="w-24 h-9"
              />
              <Button size="sm" variant="outline" onClick={applyCover} className="h-9">Recalculate</Button>
            </div>
          </div>
          <p className="text-[11px] text-muted-foreground max-w-xs leading-snug pb-1">
            Suggested par = the higher of the 6- and 12-month weekly usage × {coverWeeks} weeks × +15% safety.
          </p>
        </div>
        {rows.length > 0 && (
          <Button onClick={applyAll} disabled={applyingAll} variant="outline" size="sm" className="gap-2">
            {applyingAll ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
            Apply All ({rows.length})
          </Button>
        )}
      </div>

      {/* Body */}
      {isLoading ? (
        <div className="text-center py-12 text-muted-foreground text-sm flex items-center justify-center gap-2">
          <Loader2 className="w-4 h-4 animate-spin" /> Calculating from sales × recipes…
        </div>
      ) : isError ? (
        <div className="bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-900 rounded-xl p-5 text-sm text-red-700 dark:text-red-300">
          <p className="font-semibold mb-1">Couldn't calculate packaging recommendations.</p>
          <p className="text-xs">{error?.message || 'Unknown error'}</p>
          <p className="text-xs mt-2">If this mentions a missing function, run migration <strong>079_packaging_par_recommendations.sql</strong> in the SQL Editor first.</p>
        </div>
      ) : rows.length === 0 ? (
        <div className="bg-card border border-border rounded-xl p-8 text-center">
          <Boxes className="w-10 h-10 mx-auto mb-3 text-muted-foreground/40" />
          <p className="text-sm text-muted-foreground">No packaging consumption found.</p>
          <p className="text-xs text-muted-foreground mt-1">
            This needs meal sales (sales_order_lines) and packaging components on the meal BOMs.
            Make sure orders are synced and demand has been recalculated.
          </p>
        </div>
      ) : (
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="bg-muted/50 border-b border-border">
                <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase">Packaging</th>
                <th className="text-center px-4 py-3 text-xs font-semibold text-muted-foreground uppercase">Used by</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-muted-foreground uppercase">Per Week</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-muted-foreground uppercase">Current</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-muted-foreground uppercase">Suggested</th>
                <th className="text-center px-4 py-3 text-xs font-semibold text-muted-foreground uppercase">Change</th>
                <th className="text-center px-4 py-3 text-xs font-semibold text-muted-foreground uppercase">Apply</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map(row => {
                const current = Number(row.current_par) || 0;
                const suggested = Number(row.suggested_par) || 0;
                const diff = suggested - current;
                const isUp = diff > 0, isDown = diff < 0;
                const perWeek = Math.max(Number(row.weekly_6mo) || 0, Number(row.weekly_12mo) || 0);
                const subColor = getSubcategoryColor(row.subcategory) || 'bg-muted';
                return (
                  <tr key={row.packaging_product_id} className="hover:bg-muted/30 transition-colors">
                    <td className="px-4 py-2.5">
                      <div className="text-sm font-medium text-foreground">{row.packaging_name}</div>
                      <div className="flex items-center gap-2 mt-0.5">
                        {row.packaging_sku && <span className="text-[10px] font-mono text-muted-foreground">{row.packaging_sku}</span>}
                        {row.subcategory && (
                          <Badge className={cn('text-[9px] text-foreground', subColor)}>{row.subcategory}</Badge>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-center text-xs tabular-nums text-muted-foreground">{row.driver_meals} meals</td>
                    <td className="px-4 py-2.5 text-right text-sm tabular-nums text-muted-foreground">{perWeek.toLocaleString()}</td>
                    <td className="px-4 py-2.5 text-right text-sm tabular-nums text-muted-foreground">{current ? current.toLocaleString() : '—'}</td>
                    <td className="px-4 py-2.5 text-right text-sm tabular-nums font-semibold">{suggested.toLocaleString()}</td>
                    <td className="px-4 py-2.5 text-center">
                      <span className={cn(
                        'inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full',
                        isUp && 'bg-emerald-100 text-emerald-700',
                        isDown && 'bg-red-100 text-red-700',
                        !isUp && !isDown && 'bg-gray-100 text-gray-600'
                      )}>
                        {isUp ? <TrendingUp className="w-3 h-3" /> : isDown ? <TrendingDown className="w-3 h-3" /> : <Minus className="w-3 h-3" />}
                        {isUp ? '+' : ''}{diff.toLocaleString()}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-center">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => applyOne(row)}
                        disabled={applyingId === row.packaging_product_id}
                        className="h-7 w-7 p-0 text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50"
                      >
                        {applyingId === row.packaging_product_id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Method note */}
      <div className="flex items-start gap-2 text-[11px] text-muted-foreground bg-muted/30 border border-border rounded-lg px-3 py-2">
        <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />
        <p>
          Consumption is read straight from each meal's recipe (BOM packaging components) × the meals actually sold,
          so every sleeve, sticker, plate, vacuum bag and pouch is mapped automatically. Brand-new ranges
          (e.g. Winter Warmer) will read low until a few weeks of sales build up — keep those manual for now.
        </p>
      </div>
    </div>
  );
}
