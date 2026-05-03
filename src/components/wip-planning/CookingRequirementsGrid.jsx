import React, { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { AlertTriangle, CheckCircle2, CookingPot, Loader2, Flame } from 'lucide-react';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { writeAuditLog } from '@/lib/auditLog';

/**
 * Displays the bulk product cooking requirements grid and the "Release Cooking Runs" button.
 *
 * Props:
 *   rows: [{ id, name, sku, requiredKg, availableKg, netToCookKg, needsCooking, batchCount }]
 *   wipProducts: Product[] (type=wip_bulk) for metadata lookup
 *   cookBoms: Bom[] (bom_type=cook) for linking
 *   todaysCookingRuns: CookingRun[] (already created for today)
 *   canRelease: boolean (permission check)
 *   onReleased: () => void (callback after runs created)
 */
export default function CookingRequirementsGrid({ rows, wipProducts, cookBoms, todaysCookingRuns, canRelease, onReleased }) {
  const queryClient = useQueryClient();
  const [releasing, setReleasing] = useState(false);

  if (rows.length === 0) {
    return (
      <div className="bg-card border border-border rounded-xl p-8 text-center text-sm text-muted-foreground">
        No production runs scheduled for today — no bulk cooking requirements to calculate.
      </div>
    );
  }

  const needsCookingRows = rows.filter(r => r.needsCooking);
  const alreadyReleasedIds = new Set(todaysCookingRuns.map(r => r.bulk_product_id));
  const unreleased = needsCookingRows.filter(r => !alreadyReleasedIds.has(r.id));

  const handleRelease = async () => {
    if (unreleased.length === 0) { toast.info('All cooking runs already released'); return; }
    setReleasing(true);

    // Get the latest run number for sequential numbering
    const existingRuns = await base44.entities.CookingRun.list('-created_date', 1);
    let nextNum = existingRuns.length > 0
      ? (parseInt((existingRuns[0].run_number || '').replace(/\D/g, '') || '0') + 1) : 1;

    const todayStr = format(new Date(), 'yyyy-MM-dd');
    const created = [];

    for (const row of unreleased) {
      const product = wipProducts.find(p => p.id === row.id);
      const bom = cookBoms.find(b => b.product_id === row.id);
      const runNumber = `COOK-${new Date().getFullYear()}-${String(nextNum).padStart(4, '0')}`;
      nextNum++;

      const run = await base44.entities.CookingRun.create({
        run_number: runNumber,
        run_date: todayStr,
        status: 'released',
        run_type: 'standard',
        bulk_product_id: row.id,
        bulk_product_name: row.name,
        bulk_product_sku: row.sku,
        target_output_kg: Math.round(row.netToCookKg * 10) / 10,
        cook_bom_id: bom?.id || null,
        bom_expected_yield_pct: bom?.yield_qty || null,
        raw_product_id: product?.primary_yield_ingredient_id || null,
        raw_product_name: product?.primary_yield_ingredient_name || null,
        raw_cost_per_kg: product?.cost_avg || 0,
      });
      created.push(run);
    }

    writeAuditLog({
      action: 'create',
      entity_type: 'CookingRun',
      description: `Auto-released ${created.length} cooking runs from WIP Planning: ${created.map(r => r.run_number).join(', ')}`,
    });

    queryClient.invalidateQueries({ queryKey: ['cooking-runs'] });
    queryClient.invalidateQueries({ queryKey: ['todays-cooking-runs'] });
    toast.success(`${created.length} cooking run${created.length > 1 ? 's' : ''} released to kitchen`);
    setReleasing(false);
    onReleased?.();
  };

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      <div className="flex items-center justify-between bg-muted/50 px-4 py-3 border-b border-border">
        <div className="flex items-center gap-2">
          <Flame className="w-4 h-4 text-orange-500" />
          <h3 className="text-xs font-semibold uppercase text-muted-foreground">
            Cooking Requirements — From Today's Production Runs
          </h3>
        </div>
        {canRelease && unreleased.length > 0 && (
          <Button
            onClick={handleRelease}
            disabled={releasing}
            className="gap-2 bg-orange-600 hover:bg-orange-700"
            size="sm"
          >
            {releasing ? <Loader2 className="w-4 h-4 animate-spin" /> : <CookingPot className="w-4 h-4" />}
            Release {unreleased.length} Cooking Run{unreleased.length > 1 ? 's' : ''}
          </Button>
        )}
        {unreleased.length === 0 && needsCookingRows.length > 0 && (
          <Badge className="bg-green-100 text-green-700 text-xs gap-1">
            <CheckCircle2 className="w-3 h-3" /> All runs released
          </Badge>
        )}
      </div>

      <table className="w-full">
        <thead>
          <tr className="border-b border-border">
            <th className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase">Bulk Product</th>
            <th className="text-right px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase">Required</th>
            <th className="text-right px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase">Available WIP</th>
            <th className="text-right px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase">Net to Cook</th>
            <th className="text-center px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase">Status</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map(r => {
            const alreadyReleased = alreadyReleasedIds.has(r.id);
            return (
              <tr key={r.id} className={r.needsCooking ? 'bg-red-50/50 dark:bg-red-950/10' : ''}>
                <td className="px-4 py-2.5">
                  <p className="text-sm font-medium">{r.name}</p>
                  <p className="text-[10px] font-mono text-muted-foreground">{r.sku}</p>
                </td>
                <td className="px-4 py-2.5 text-sm text-right tabular-nums font-medium">{r.requiredKg.toFixed(1)} kg</td>
                <td className="px-4 py-2.5 text-sm text-right tabular-nums">{r.availableKg.toFixed(1)} kg</td>
                <td className={`px-4 py-2.5 text-sm text-right tabular-nums font-bold ${r.needsCooking ? 'text-red-600' : 'text-green-600'}`}>
                  {r.needsCooking ? r.netToCookKg.toFixed(1) : '—'}
                </td>
                <td className="px-4 py-2.5 text-center">
                  {r.needsCooking ? (
                    alreadyReleased ? (
                      <Badge className="bg-blue-100 text-blue-700 text-[10px] gap-1">
                        <CookingPot className="w-3 h-3" /> Released
                      </Badge>
                    ) : (
                      <Badge className="bg-red-100 text-red-700 text-[10px] gap-1">
                        <AlertTriangle className="w-3 h-3" /> Needs cooking
                      </Badge>
                    )
                  ) : (
                    <Badge className="bg-green-100 text-green-700 text-[10px] gap-1">
                      <CheckCircle2 className="w-3 h-3" /> Covered
                    </Badge>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}