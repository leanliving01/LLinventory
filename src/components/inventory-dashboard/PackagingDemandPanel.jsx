import React, { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/api/supabaseClient';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Check, Loader2, Boxes } from 'lucide-react';
import { toast } from 'sonner';

/**
 * Packaging is never sold directly — its demand is DERIVED from how many meals
 * sell, exploded through each meal's BOM. So instead of (empty) sales velocity,
 * the Packaging tab surfaces packaging_par_recommendations() (migration 079),
 * which does exactly that BOM explosion. One-click apply writes products.par_level.
 */
async function fetchPackagingRecs() {
  const { data, error } = await supabase.rpc('packaging_par_recommendations');
  if (error) { console.error('[packaging_par_recommendations]', error.message); return []; }
  return data || [];
}

export default function PackagingDemandPanel() {
  const queryClient = useQueryClient();
  const [applyingId, setApplyingId] = useState(null);

  const { data: recs = [], isLoading, isError } = useQuery({
    queryKey: ['packaging-par-recs'],
    queryFn: fetchPackagingRecs,
    staleTime: 120000,
  });

  const applyPar = async (rec) => {
    setApplyingId(rec.packaging_product_id);
    try {
      await base44.entities.Product.update(rec.packaging_product_id, { par_level: Number(rec.suggested_par) || 0 });
      queryClient.invalidateQueries({ queryKey: ['products-reorder'] });
      queryClient.invalidateQueries({ queryKey: ['packaging-par-recs'] });
      toast.success(`Par for ${rec.packaging_name} set to ${rec.suggested_par}`);
    } catch (err) {
      toast.error('Failed to set par: ' + (err.message || 'Unknown error'));
    } finally {
      setApplyingId(null);
    }
  };

  return (
    <div className="bg-card border border-border rounded-lg shadow-sm overflow-hidden">
      <div className="flex items-start gap-2 px-5 pt-5 pb-3">
        <Boxes className="w-4 h-4 mt-0.5 text-violet-500" />
        <div>
          <h3 className="text-sm font-semibold text-foreground">Packaging Demand (from meal recipes)</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Packaging isn't sold directly — this is derived by exploding meal sales through each meal's BOM.
          </p>
        </div>
      </div>

      {isLoading ? (
        <div className="py-10 text-center text-sm text-muted-foreground">Loading…</div>
      ) : isError || recs.length === 0 ? (
        <div className="py-10 text-center text-sm text-muted-foreground">
          No packaging recommendations. Ensure meal BOMs include packaging components.
        </div>
      ) : (
        <div className="max-h-[440px] overflow-y-auto">
          <table className="w-full">
            <thead className="sticky top-0 bg-muted/80 backdrop-blur">
              <tr className="border-y border-border">
                <th className="text-left px-3 py-2 text-[11px] font-semibold text-muted-foreground uppercase">Packaging</th>
                <th className="text-right px-3 py-2 text-[11px] font-semibold text-muted-foreground uppercase" title="From meals sold in the last 6 / 12 months">6mo / 12mo wk</th>
                <th className="text-center px-3 py-2 text-[11px] font-semibold text-muted-foreground uppercase" title="How many different meals drive this packaging item">Driver meals</th>
                <th className="text-right px-3 py-2 text-[11px] font-semibold text-muted-foreground uppercase">Par</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {recs.map((r) => {
                const suggestBump = Number(r.suggested_par) > Number(r.current_par || 0);
                return (
                  <tr key={r.packaging_product_id} className="hover:bg-muted/30 transition-colors">
                    <td className="px-3 py-2">
                      <p className="text-sm font-medium leading-tight">{r.packaging_name}</p>
                      <p className="text-[10px] font-mono text-muted-foreground">{r.packaging_sku}{r.subcategory ? ` · ${r.subcategory}` : ''}</p>
                    </td>
                    <td className="px-3 py-2 text-right text-sm tabular-nums">
                      <span className="font-semibold">{r.weekly_6mo}</span>
                      <span className="text-muted-foreground"> / {r.weekly_12mo}</span>
                    </td>
                    <td className="px-3 py-2 text-center text-sm tabular-nums text-muted-foreground">{r.driver_meals}</td>
                    <td className="px-3 py-2 text-right">
                      {suggestBump ? (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 gap-1 text-xs"
                          disabled={applyingId === r.packaging_product_id}
                          onClick={() => applyPar(r)}
                        >
                          {applyingId === r.packaging_product_id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
                          {r.current_par || 0} → {r.suggested_par}
                        </Button>
                      ) : (
                        <span className="text-sm text-muted-foreground tabular-nums">{r.current_par || '—'}</span>
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
  );
}
