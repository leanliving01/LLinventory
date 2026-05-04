import React, { useState, useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { AlertTriangle, CheckCircle2, CookingPot, Loader2, Flame, Merge, Split, ChevronDown } from 'lucide-react';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { writeAuditLog } from '@/lib/auditLog';

/**
 * Consolidated cooking requirements grid.
 * Shows bulk product needs across multiple selected production runs,
 * with per-row combined/split toggle.
 *
 * Props:
 *   rows: [{ id, name, sku, requiredKg, availableKg, netToCookKg, needsCooking,
 *            contributions: [{ runId, runNumber, kgNeeded }] }]
 *   wipProducts, cookBoms, existingCookingRuns, canRelease, onReleased
 *   draftAdHocRuns: CookingRun[] (ad-hoc draft runs to include in release)
 */
export default function ConsolidatedCookingGrid({
  rows, wipProducts, cookBoms, existingCookingRuns, canRelease, onReleased, draftAdHocRuns = []
}) {
  const queryClient = useQueryClient();
  const [releasing, setReleasing] = useState(false);
  const [splitRows, setSplitRows] = useState(new Set()); // bulk product ids where PM chose "split"
  const [expandedRow, setExpandedRow] = useState(null);

  // Already released = not draft
  const releasedOrActiveRuns = existingCookingRuns.filter(r => r.status !== 'draft' && r.status !== 'cancelled');
  const alreadyReleasedIds = new Set(releasedOrActiveRuns.map(r => r.bulk_product_id));

  const needsCookingRows = rows.filter(r => r.needsCooking);
  const unreleased = needsCookingRows.filter(r => !alreadyReleasedIds.has(r.id));

  const totalToRelease = useMemo(() => {
    let count = draftAdHocRuns.length;
    for (const row of unreleased) {
      if (splitRows.has(row.id)) {
        count += row.contributions.length;
      } else {
        count += 1;
      }
    }
    return count;
  }, [unreleased, splitRows, draftAdHocRuns]);

  const toggleSplit = (bulkProductId) => {
    setSplitRows(prev => {
      const next = new Set(prev);
      if (next.has(bulkProductId)) next.delete(bulkProductId);
      else next.add(bulkProductId);
      return next;
    });
  };

  const handleRelease = async () => {
    if (totalToRelease === 0) { toast.info('All cooking runs already released'); return; }
    setReleasing(true);

    // 1. Release existing draft ad-hoc runs
    for (const dr of draftAdHocRuns) {
      await base44.entities.CookingRun.update(dr.id, { status: 'released' });
    }

    // 2. Create new cooking runs for unreleased requirement rows
    let created = [];
    if (unreleased.length > 0) {
      const existingRuns = await base44.entities.CookingRun.list('-created_date', 1);
      let nextNum = existingRuns.length > 0
        ? (parseInt((existingRuns[0].run_number || '').replace(/\D/g, '') || '0') + 1) : 1;

      const todayStr = format(new Date(), 'yyyy-MM-dd');

      for (const row of unreleased) {
        const product = wipProducts.find(p => p.id === row.id);
        const bom = cookBoms.find(b => b.product_id === row.id);

        if (splitRows.has(row.id)) {
          // SPLIT: one cooking run per contributing production run
          for (const contrib of row.contributions) {
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
              target_output_kg: Math.round(contrib.kgNeeded * 10) / 10,
              cook_bom_id: bom?.id || null,
              bom_expected_yield_pct: bom?.yield_qty || null,
              raw_product_id: product?.primary_yield_ingredient_id || null,
              raw_product_name: product?.primary_yield_ingredient_name || null,
              raw_cost_per_kg: product?.cost_avg || 0,
              production_run_id: contrib.runId,
              contributing_run_ids: JSON.stringify([contrib.runId]),
            });
            created.push(run);
          }
        } else {
          // COMBINED: one cooking run for total consolidated quantity
          const runNumber = `COOK-${new Date().getFullYear()}-${String(nextNum).padStart(4, '0')}`;
          nextNum++;
          const allRunIds = row.contributions.map(c => c.runId);
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
            production_run_id: allRunIds[0],
            contributing_run_ids: JSON.stringify(allRunIds),
          });
          created.push(run);
        }
      }
    }

    const allNames = [...draftAdHocRuns.map(r => r.run_number), ...created.map(r => r.run_number)];
    writeAuditLog({
      action: 'create',
      entity_type: 'CookingRun',
      description: `Released ${totalToRelease} cooking runs from WIP Planning (consolidated): ${allNames.join(', ')}`,
    });

    queryClient.invalidateQueries({ queryKey: ['cooking-runs'] });
    queryClient.invalidateQueries({ queryKey: ['wip-cooking-runs'] });
    toast.success(`${totalToRelease} cooking run${totalToRelease > 1 ? 's' : ''} released to kitchen`);
    setReleasing(false);
    onReleased?.();
  };

  if (rows.length === 0 && draftAdHocRuns.length === 0) {
    return (
      <div className="bg-card border border-border rounded-xl p-8 text-center text-sm text-muted-foreground">
        No bulk cooking requirements for the selected production runs.
      </div>
    );
  }

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between bg-muted/50 px-4 py-3 border-b border-border flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <Flame className="w-4 h-4 text-orange-500" />
          <h3 className="text-xs font-semibold uppercase text-muted-foreground">
            Consolidated Cooking Requirements
          </h3>
        </div>
        <div className="flex items-center gap-3">
          {canRelease && totalToRelease > 0 && (
            <Button
              onClick={handleRelease}
              disabled={releasing}
              className="gap-2 bg-orange-600 hover:bg-orange-700"
              size="sm"
            >
              {releasing ? <Loader2 className="w-4 h-4 animate-spin" /> : <CookingPot className="w-4 h-4" />}
              Release {totalToRelease} Cooking Run{totalToRelease > 1 ? 's' : ''}
            </Button>
          )}
          {totalToRelease === 0 && rows.length > 0 && (
            <Badge className="bg-green-100 text-green-700 text-xs gap-1">
              <CheckCircle2 className="w-3 h-3" /> All runs released
            </Badge>
          )}
        </div>
      </div>

      {/* Table */}
      <table className="w-full">
        <thead>
          <tr className="border-b border-border">
            <th className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase">Bulk Product</th>
            <th className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase">Contributing Runs</th>
            <th className="text-right px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase">Required</th>
            <th className="text-right px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase">Available WIP</th>
            <th className="text-right px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase">Net to Cook</th>
            <th className="text-center px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase">Mode</th>
            <th className="text-center px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase">Status</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map(r => {
            const released = alreadyReleasedIds.has(r.id);
            const isSplit = splitRows.has(r.id);
            const isMultiRun = r.contributions.length > 1;
            const isExpanded = expandedRow === r.id;

            return (
              <React.Fragment key={r.id}>
                <tr className={r.needsCooking ? 'bg-red-50/50 dark:bg-red-950/10' : ''}>
                  <td className="px-4 py-2.5">
                    <p className="text-sm font-medium">{r.name}</p>
                    <p className="text-[10px] font-mono text-muted-foreground">{r.sku}</p>
                  </td>
                  <td className="px-4 py-2.5">
                    {r.contributions.length <= 2 ? (
                      <div className="flex flex-wrap gap-1">
                        {r.contributions.map(c => (
                          <Badge key={c.runId} variant="outline" className="text-[10px] font-mono">
                            {c.runNumber}
                          </Badge>
                        ))}
                      </div>
                    ) : (
                      <button
                        onClick={() => setExpandedRow(isExpanded ? null : r.id)}
                        className="flex items-center gap-1 text-xs text-primary hover:underline"
                      >
                        {r.contributions.length} runs
                        <ChevronDown className={`w-3 h-3 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                      </button>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-sm text-right tabular-nums font-medium">{r.requiredKg.toFixed(1)} kg</td>
                  <td className="px-4 py-2.5 text-sm text-right tabular-nums">{r.availableKg.toFixed(1)} kg</td>
                  <td className={`px-4 py-2.5 text-sm text-right tabular-nums font-bold ${r.needsCooking ? 'text-red-600' : 'text-green-600'}`}>
                    {r.needsCooking ? r.netToCookKg.toFixed(1) : '—'}
                  </td>
                  <td className="px-4 py-2.5 text-center">
                    {r.needsCooking && !released && isMultiRun ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => toggleSplit(r.id)}
                        className={`gap-1.5 text-xs h-7 ${isSplit ? 'text-amber-600' : 'text-primary'}`}
                      >
                        {isSplit ? <><Split className="w-3 h-3" /> Split</> : <><Merge className="w-3 h-3" /> Combined</>}
                      </Button>
                    ) : r.needsCooking && !released ? (
                      <span className="text-[10px] text-muted-foreground">single run</span>
                    ) : (
                      <span className="text-[10px] text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-center">
                    {r.needsCooking ? (
                      released ? (
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
                {/* Expanded contribution detail rows */}
                {isExpanded && (
                  <tr>
                    <td colSpan={7} className="px-8 py-2 bg-muted/30">
                      <div className="flex flex-wrap gap-x-6 gap-y-1">
                        {r.contributions.map(c => (
                          <span key={c.runId} className="text-xs text-muted-foreground">
                            <span className="font-mono font-semibold text-foreground">{c.runNumber}</span>
                            {' '}— {c.kgNeeded.toFixed(1)} kg
                            {c.runDate && <span className="ml-1">({c.runDate})</span>}
                          </span>
                        ))}
                      </div>
                    </td>
                  </tr>
                )}
                {/* If split mode, show per-run breakdown below */}
                {isSplit && r.needsCooking && !released && r.contributions.map(c => (
                  <tr key={`split-${r.id}-${c.runId}`} className="bg-amber-50/30 dark:bg-amber-950/5">
                    <td className="pl-10 pr-4 py-1.5">
                      <p className="text-xs text-muted-foreground">↳ {r.name}</p>
                    </td>
                    <td className="px-4 py-1.5">
                      <Badge variant="outline" className="text-[10px] font-mono">{c.runNumber}</Badge>
                    </td>
                    <td className="px-4 py-1.5 text-xs text-right tabular-nums">{c.kgNeeded.toFixed(1)} kg</td>
                    <td colSpan={2} className="px-4 py-1.5 text-xs text-right tabular-nums text-muted-foreground">separate run</td>
                    <td></td>
                    <td></td>
                  </tr>
                ))}
              </React.Fragment>
            );
          })}
          {/* Ad-hoc draft runs */}
          {draftAdHocRuns.filter(dr => !rows.some(r => r.id === dr.bulk_product_id && r.needsCooking)).map(dr => (
            <tr key={`adhoc-${dr.id}`} className="bg-amber-50/50 dark:bg-amber-950/10">
              <td className="px-4 py-2.5">
                <p className="text-sm font-medium">{dr.bulk_product_name}</p>
                <p className="text-[10px] font-mono text-muted-foreground">{dr.bulk_product_sku} · {dr.run_number}</p>
              </td>
              <td className="px-4 py-2.5 text-xs text-muted-foreground">ad-hoc</td>
              <td className="px-4 py-2.5 text-sm text-right tabular-nums text-muted-foreground">ad-hoc</td>
              <td className="px-4 py-2.5 text-sm text-right tabular-nums text-muted-foreground">—</td>
              <td className="px-4 py-2.5 text-sm text-right tabular-nums font-bold text-amber-600">{dr.target_output_kg} kg</td>
              <td></td>
              <td className="px-4 py-2.5 text-center">
                <Badge className="bg-gray-100 text-gray-600 text-[10px] gap-1">
                  <CookingPot className="w-3 h-3" /> Draft
                </Badge>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}