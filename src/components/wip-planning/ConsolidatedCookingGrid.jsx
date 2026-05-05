import React, { useState, useMemo, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import {
  AlertTriangle, CheckCircle2, CookingPot, Loader2, Flame,
  Merge, Split, ChevronDown, Play, RotateCcw
} from 'lucide-react';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { writeAuditLog } from '@/lib/auditLog';

/**
 * Releases cooking runs for requirement rows.
 * If an existing draft cooking run exists for the same bulk product, re-use it
 * (update target + status → released) instead of creating a duplicate.
 * Uses cookPlanOverrides to determine target_output_kg when available.
 */
async function releaseOrCreateCookingRuns(rowsToRelease, splitRows, wipProducts, cookBoms, cookPlanOverrides, existingDraftRuns) {
  const allRuns = await base44.entities.CookingRun.list('-created_date', 1);
  let nextNum = 1;
  if (allRuns.length > 0) {
    const parts = (allRuns[0].run_number || '').split('-');
    const seq = parseInt(parts[parts.length - 1] || '0', 10);
    nextNum = (isNaN(seq) ? 0 : seq) + 1;
  }

  // Index existing draft runs by bulk_product_id for re-use
  const draftsByProduct = {};
  (existingDraftRuns || []).forEach(dr => {
    if (!draftsByProduct[dr.bulk_product_id]) draftsByProduct[dr.bulk_product_id] = [];
    draftsByProduct[dr.bulk_product_id].push(dr);
  });

  const todayStr = format(new Date(), 'yyyy-MM-dd');
  const released = [];

  for (const row of rowsToRelease) {
    const product = wipProducts.find(p => p.id === row.id);
    const bom = cookBoms.find(b => b.product_id === row.id);
    const overriddenKg = cookPlanOverrides[row.id];
    const targetKg = overriddenKg !== undefined ? Number(overriddenKg) : row.netToCookKg;
    const allRunIds = row.contributions.map(c => c.runId);

    if (splitRows.has(row.id)) {
      const totalNet = row.contributions.reduce((s, c) => s + c.kgNeeded, 0);
      for (const contrib of row.contributions) {
        const proportion = totalNet > 0 ? contrib.kgNeeded / totalNet : 1 / row.contributions.length;
        const splitTarget = Math.round(targetKg * proportion * 10) / 10;

        const runNumber = `COOK-${new Date().getFullYear()}-${String(nextNum).padStart(4, '0')}`;
        nextNum++;
        const run = await base44.entities.CookingRun.create({
          run_number: runNumber, run_date: todayStr, status: 'released', run_type: 'standard',
          bulk_product_id: row.id, bulk_product_name: row.name, bulk_product_sku: row.sku,
          target_output_kg: splitTarget,
          cook_bom_id: bom?.id || null, bom_expected_yield_pct: bom?.yield_qty || null,
          raw_product_id: product?.primary_yield_ingredient_id || null,
          raw_product_name: product?.primary_yield_ingredient_name || null,
          raw_cost_per_kg: product?.cost_avg || 0,
          production_run_id: contrib.runId,
          contributing_run_ids: JSON.stringify([contrib.runId]),
        });
        released.push(run);
      }
    } else {
      // Check if there's an existing draft cooking run for this product we can re-use
      const existingDrafts = draftsByProduct[row.id] || [];
      const draftToReuse = existingDrafts.shift(); // take the first available draft

      if (draftToReuse) {
        // Re-use: update the existing draft run with new target and release it
        await base44.entities.CookingRun.update(draftToReuse.id, {
          status: 'released',
          target_output_kg: Math.round(targetKg * 10) / 10,
          run_date: todayStr,
          production_run_id: allRunIds[0],
          contributing_run_ids: JSON.stringify(allRunIds),
          cook_bom_id: bom?.id || null,
          bom_expected_yield_pct: bom?.yield_qty || null,
          raw_product_id: product?.primary_yield_ingredient_id || null,
          raw_product_name: product?.primary_yield_ingredient_name || null,
          raw_cost_per_kg: product?.cost_avg || 0,
        });
        released.push({ ...draftToReuse, run_number: draftToReuse.run_number });
      } else {
        // No existing draft — create a new one
        const runNumber = `COOK-${new Date().getFullYear()}-${String(nextNum).padStart(4, '0')}`;
        nextNum++;
        const run = await base44.entities.CookingRun.create({
          run_number: runNumber, run_date: todayStr, status: 'released', run_type: 'standard',
          bulk_product_id: row.id, bulk_product_name: row.name, bulk_product_sku: row.sku,
          target_output_kg: Math.round(targetKg * 10) / 10,
          cook_bom_id: bom?.id || null, bom_expected_yield_pct: bom?.yield_qty || null,
          raw_product_id: product?.primary_yield_ingredient_id || null,
          raw_product_name: product?.primary_yield_ingredient_name || null,
          raw_cost_per_kg: product?.cost_avg || 0,
          production_run_id: allRunIds[0],
          contributing_run_ids: JSON.stringify(allRunIds),
        });
        released.push(run);
      }
    }
  }

  return released;
}

export default function ConsolidatedCookingGrid({
  rows, wipProducts, cookBoms, existingCookingRuns, canRelease, onReleased, draftAdHocRuns = [],
  isQcConfirmed = false, selectedRunIds = new Set()
}) {
  const queryClient = useQueryClient();
  const [releasing, setReleasing] = useState(false);
  const [releasingRowId, setReleasingRowId] = useState(null);
  const [revertingRowId, setRevertingRowId] = useState(null);
  const [splitRows, setSplitRows] = useState(new Set());
  const [selectedRows, setSelectedRows] = useState(new Set());
  const [expandedRow, setExpandedRow] = useState(null);
  // Cook Plan overrides: { [bulkProductId]: number string }
  const [cookPlanOverrides, setCookPlanOverrides] = useState({});

  // Already released = active cooking runs (not draft or cancelled)
  const releasedOrActiveRuns = existingCookingRuns.filter(r => r.status !== 'draft' && r.status !== 'cancelled');
  const alreadyReleasedIds = new Set(releasedOrActiveRuns.map(r => r.bulk_product_id));

  // All draft cooking runs (for re-use when releasing)
  const allDraftCookingRuns = existingCookingRuns.filter(r => r.status === 'draft');

  // Map released cooking runs by bulk_product_id for revert
  const releasedRunsByProduct = useMemo(() => {
    const map = {};
    releasedOrActiveRuns.forEach(r => {
      if (!map[r.bulk_product_id]) map[r.bulk_product_id] = [];
      map[r.bulk_product_id].push(r);
    });
    return map;
  }, [releasedOrActiveRuns]);

  const needsCookingRows = rows.filter(r => r.needsCooking);
  const unreleased = needsCookingRows.filter(r => !alreadyReleasedIds.has(r.id));

  const selectedUnreleased = unreleased.filter(r => selectedRows.has(r.id));
  const allSelected = unreleased.length > 0 && unreleased.every(r => selectedRows.has(r.id));
  const someSelected = selectedUnreleased.length > 0;

  // Check if any released rows can be reverted (only "released" status, not in_progress/completed)
  const revertableReleased = needsCookingRows.filter(r => {
    const runs = releasedRunsByProduct[r.id] || [];
    return runs.length > 0 && runs.every(cr => cr.status === 'released');
  });

  const toggleSplit = (bulkProductId) => {
    setSplitRows(prev => {
      const next = new Set(prev);
      if (next.has(bulkProductId)) next.delete(bulkProductId);
      else next.add(bulkProductId);
      return next;
    });
  };

  const toggleSelect = (id) => {
    setSelectedRows(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (allSelected) {
      setSelectedRows(new Set());
    } else {
      setSelectedRows(new Set(unreleased.map(r => r.id)));
    }
  };

  const handleCookPlanChange = useCallback((rowId, value) => {
    setCookPlanOverrides(prev => ({ ...prev, [rowId]: value }));
  }, []);

  const invalidateAndNotify = (count, action) => {
    queryClient.invalidateQueries({ queryKey: ['cooking-runs'] });
    queryClient.invalidateQueries({ queryKey: ['wip-cooking-runs'] });
    toast.success(`${count} cooking run${count > 1 ? 's' : ''} ${action}`);
    onReleased?.();
  };

  const finishRelease = async (names, releasedRuns) => {
    writeAuditLog({
      action: 'create', entity_type: 'CookingRun',
      description: `Released ${names.length} cooking runs from WIP Planning: ${names.join(', ')}`,
    });

    // Auto-transition linked production runs from draft → scheduled
    const productionRunIds = new Set();
    (releasedRuns || []).forEach(cr => {
      if (cr.production_run_id) productionRunIds.add(cr.production_run_id);
      if (cr.contributing_run_ids) {
        try {
          const ids = JSON.parse(cr.contributing_run_ids);
          if (Array.isArray(ids)) ids.forEach(id => productionRunIds.add(id));
        } catch {}
      }
    });

    if (productionRunIds.size > 0) {
      const allProdRuns = await base44.entities.ProductionRun.list('-created_date', 200);
      const draftRuns = allProdRuns.filter(r => r.status === 'draft' && productionRunIds.has(r.id));
      for (const pr of draftRuns) {
        await base44.entities.ProductionRun.update(pr.id, { status: 'scheduled' });
        writeAuditLog({
          action: 'update', entity_type: 'ProductionRun', entity_id: pr.id,
          description: `Auto-scheduled production run ${pr.run_number} — cooking runs released from WIP Planning`,
        });
      }
      if (draftRuns.length > 0) {
        queryClient.invalidateQueries({ queryKey: ['production-runs'] });
        toast.success(`${draftRuns.length} production run${draftRuns.length > 1 ? 's' : ''} auto-scheduled`);
      }
    }

    invalidateAndNotify(names.length, 'released to kitchen');
    setSelectedRows(new Set());
  };

  // Void (cancel) a single released product's cooking runs
  const handleVoidSingle = async (row) => {
    const runs = releasedRunsByProduct[row.id] || [];
    const voidable = runs.filter(cr => cr.status === 'released');
    if (voidable.length === 0) { toast.info('No released runs to void'); return; }
    setRevertingRowId(row.id);
    for (const cr of voidable) {
      await base44.entities.CookingRun.update(cr.id, {
        status: 'cancelled',
        notes: `${cr.notes ? cr.notes + '\n' : ''}Voided from WIP Planning grid`,
      });
    }
    writeAuditLog({
      action: 'cancel', entity_type: 'CookingRun',
      description: `Voided ${voidable.length} cooking run(s) for ${row.name}: ${voidable.map(r => r.run_number).join(', ')}`,
    });
    invalidateAndNotify(voidable.length, 'voided');
    setRevertingRowId(null);
  };

  // QC gate check — block release until today's QC session is confirmed
  const checkQcGate = () => {
    if (!isQcConfirmed) {
      toast.error('Morning Quality Check must be completed before releasing cooking runs. Go to Step 2 above — approve or decline every WIP batch, then confirm.');
      return false;
    }
    return true;
  };

  // Release ALL unreleased rows + ad-hoc drafts
  const handleReleaseAll = async () => {
    if (!checkQcGate()) return;
    if (unreleased.length === 0 && draftAdHocRuns.length === 0) {
      toast.info('All cooking runs already released');
      return;
    }
    setReleasing(true);
    const updatedAdHoc = [];
    for (const dr of draftAdHocRuns) {
      await base44.entities.CookingRun.update(dr.id, { status: 'released' });
      updatedAdHoc.push(dr);
    }
    const released = await releaseOrCreateCookingRuns(unreleased, splitRows, wipProducts, cookBoms, cookPlanOverrides, allDraftCookingRuns);
    const allNames = [...draftAdHocRuns.map(r => r.run_number), ...released.map(r => r.run_number)];
    const allReleasedRuns = [...updatedAdHoc, ...released];
    await finishRelease(allNames, allReleasedRuns);
    setReleasing(false);
  };

  // Release only SELECTED rows
  const handleReleaseSelected = async () => {
    if (!checkQcGate()) return;
    if (selectedUnreleased.length === 0) { toast.info('No rows selected'); return; }
    setReleasing(true);
    const released = await releaseOrCreateCookingRuns(selectedUnreleased, splitRows, wipProducts, cookBoms, cookPlanOverrides, allDraftCookingRuns);
    await finishRelease(released.map(r => r.run_number), released);
    setReleasing(false);
  };

  // Release a SINGLE row
  const handleReleaseSingle = async (row) => {
    if (!checkQcGate()) return;
    setReleasingRowId(row.id);
    const released = await releaseOrCreateCookingRuns([row], splitRows, wipProducts, cookBoms, cookPlanOverrides, allDraftCookingRuns);
    await finishRelease(released.map(r => r.run_number), released);
    setReleasingRowId(null);
  };

  if (rows.length === 0 && draftAdHocRuns.length === 0) {
    return (
      <div className="bg-card border border-border rounded-xl p-8 text-center text-sm text-muted-foreground">
        No bulk cooking requirements for the selected production runs.
      </div>
    );
  }

  const hasCheckboxCol = canRelease && (unreleased.length > 0 || revertableReleased.length > 0);
  const colCount = hasCheckboxCol ? 9 : 8;

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      {/* Header with release actions */}
      <div className="flex items-center justify-between bg-muted/50 px-4 py-3 border-b border-border flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <Flame className="w-4 h-4 text-orange-500" />
          <h3 className="text-xs font-semibold uppercase text-muted-foreground">
            Consolidated Cooking Requirements
          </h3>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {canRelease && unreleased.length === 0 && rows.length > 0 && (
            <Badge className="bg-green-100 text-green-700 text-xs gap-1">
              <CheckCircle2 className="w-3 h-3" /> All runs released
            </Badge>
          )}
          {canRelease && someSelected && (
            <Button
              onClick={handleReleaseSelected}
              disabled={releasing}
              variant="outline"
              size="sm"
              className="gap-1.5 border-orange-300 text-orange-700 hover:bg-orange-50"
            >
              {releasing ? <Loader2 className="w-4 h-4 animate-spin" /> : <CookingPot className="w-4 h-4" />}
              Release Selected ({selectedUnreleased.length})
            </Button>
          )}
          {canRelease && unreleased.length > 0 && (
            <Button
              onClick={handleReleaseAll}
              disabled={releasing}
              className="gap-2 bg-orange-600 hover:bg-orange-700"
              size="sm"
            >
              {releasing ? <Loader2 className="w-4 h-4 animate-spin" /> : <CookingPot className="w-4 h-4" />}
              Release All ({unreleased.length + draftAdHocRuns.length})
            </Button>
          )}
        </div>
      </div>

      {/* QC gate warning banner */}
      {!isQcConfirmed && canRelease && unreleased.length > 0 && (
        <div className="flex items-center gap-3 px-4 py-3 bg-amber-50 border-b border-amber-200 dark:bg-amber-950/20 dark:border-amber-800">
          <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
          <p className="text-sm text-amber-800 dark:text-amber-300">
            <span className="font-semibold">QC not confirmed.</span> Complete the Morning Quality Check above before releasing any cooking runs.
          </p>
        </div>
      )}

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-border">
              {hasCheckboxCol && (
                <th className="w-10 px-3 py-2.5 text-center">
                  {unreleased.length > 0 && (
                    <Checkbox
                      checked={allSelected}
                      onCheckedChange={toggleSelectAll}
                      aria-label="Select all"
                    />
                  )}
                </th>
              )}
              <th className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase">Bulk Product</th>
              <th className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase">Contributing Runs</th>
              <th className="text-right px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase">Required</th>
              <th className="text-right px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase">Available WIP</th>
              <th className="text-right px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase">Net to Cook</th>
              <th className="text-right px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase">Cook Plan</th>
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
              const isUnreleased = r.needsCooking && !released;
              const isReleasingSingle = releasingRowId === r.id;
              const isRevertingSingle = revertingRowId === r.id;

              // Can this released row be reverted? Only if all its runs are still "released" (not started)
              const releasedRuns = releasedRunsByProduct[r.id] || [];
              const canRevert = released && releasedRuns.length > 0 && releasedRuns.every(cr => cr.status === 'released');

              // Cook plan value: override or net-to-cook
              const cookPlanValue = cookPlanOverrides[r.id] !== undefined
                ? cookPlanOverrides[r.id]
                : r.netToCookKg.toFixed(1);
              const isOverridden = cookPlanOverrides[r.id] !== undefined &&
                Number(cookPlanOverrides[r.id]) !== Math.round(r.netToCookKg * 10) / 10;

              return (
                <React.Fragment key={r.id}>
                  <tr className={r.needsCooking ? 'bg-red-50/50 dark:bg-red-950/10' : ''}>
                    {/* Checkbox column */}
                    {hasCheckboxCol && (
                      <td className="w-10 px-3 py-2.5 text-center">
                        {isUnreleased ? (
                          <Checkbox
                            checked={selectedRows.has(r.id)}
                            onCheckedChange={() => toggleSelect(r.id)}
                            aria-label={`Select ${r.name}`}
                          />
                        ) : null}
                      </td>
                    )}
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
                    {/* Cook Plan — editable for unreleased rows that need cooking */}
                    <td className="px-4 py-2.5 text-right">
                      {!r.needsCooking ? (
                        <span className="text-sm text-muted-foreground">—</span>
                      ) : isUnreleased ? (
                        <Input
                          type="number"
                          min="0"
                          step="0.1"
                          value={cookPlanValue}
                          onChange={e => handleCookPlanChange(r.id, e.target.value)}
                          className={`w-20 h-7 text-xs text-right tabular-nums ml-auto ${isOverridden ? 'border-amber-400 bg-amber-50 dark:bg-amber-950/20 font-bold' : ''}`}
                        />
                      ) : released ? (
                        <span className="text-sm tabular-nums text-muted-foreground">
                          {releasedRuns.reduce((s, cr) => s + (cr.target_output_kg || 0), 0).toFixed(1)} kg
                        </span>
                      ) : (
                        <span className="text-sm text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-center">
                      {isUnreleased && isMultiRun ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => toggleSplit(r.id)}
                          className={`gap-1.5 text-xs h-7 ${isSplit ? 'text-amber-600' : 'text-primary'}`}
                        >
                          {isSplit ? <><Split className="w-3 h-3" /> Split</> : <><Merge className="w-3 h-3" /> Combined</>}
                        </Button>
                      ) : isUnreleased ? (
                        <span className="text-[10px] text-muted-foreground">single run</span>
                      ) : (
                        <span className="text-[10px] text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-center">
                      {r.needsCooking ? (
                        released ? (
                          canRevert && canRelease ? (
                            <div className="flex items-center gap-1 justify-center">
                              <Badge className="bg-blue-100 text-blue-700 text-[10px] gap-1">
                                <CookingPot className="w-3 h-3" /> Released
                              </Badge>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => handleVoidSingle(r)}
                                disabled={isRevertingSingle || releasing}
                                className="gap-1 text-[10px] h-6 px-1.5 text-muted-foreground hover:text-red-700 hover:bg-red-50"
                                title="Void / cancel this cooking run"
                              >
                                {isRevertingSingle ? <Loader2 className="w-3 h-3 animate-spin" /> : <RotateCcw className="w-3 h-3" />}
                              </Button>
                            </div>
                          ) : (
                            <Badge className="bg-blue-100 text-blue-700 text-[10px] gap-1">
                              <CookingPot className="w-3 h-3" /> Released
                            </Badge>
                          )
                        ) : canRelease ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleReleaseSingle(r)}
                            disabled={isReleasingSingle || releasing}
                            className="gap-1.5 text-xs h-7 text-orange-600 hover:text-orange-700 hover:bg-orange-50"
                          >
                            {isReleasingSingle ? (
                              <Loader2 className="w-3 h-3 animate-spin" />
                            ) : (
                              <Play className="w-3 h-3" />
                            )}
                            Release
                          </Button>
                        ) : (
                          <Badge className="bg-red-100 text-red-700 text-[10px] gap-1">
                            <AlertTriangle className="w-3 h-3" /> Needs cooking
                          </Badge>
                        )
                      ) : (
                        isQcConfirmed ? (
                          <Badge className="bg-green-100 text-green-700 text-[10px] gap-1">
                            <CheckCircle2 className="w-3 h-3" /> Covered
                          </Badge>
                        ) : (
                          <Badge className="bg-amber-100 text-amber-700 text-[10px] gap-1">
                            <AlertTriangle className="w-3 h-3" /> Pending QC
                          </Badge>
                        )
                      )}
                    </td>
                  </tr>
                  {/* Expanded contribution detail rows */}
                  {isExpanded && (
                    <tr>
                      <td colSpan={colCount} className="px-8 py-2 bg-muted/30">
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
                  {isSplit && isUnreleased && r.contributions.map(c => (
                    <tr key={`split-${r.id}-${c.runId}`} className="bg-amber-50/30 dark:bg-amber-950/5">
                      {hasCheckboxCol && <td />}
                      <td className="pl-10 pr-4 py-1.5">
                        <p className="text-xs text-muted-foreground">↳ {r.name}</p>
                      </td>
                      <td className="px-4 py-1.5">
                        <Badge variant="outline" className="text-[10px] font-mono">{c.runNumber}</Badge>
                      </td>
                      <td className="px-4 py-1.5 text-xs text-right tabular-nums">{c.kgNeeded.toFixed(1)} kg</td>
                      <td colSpan={3} className="px-4 py-1.5 text-xs text-right tabular-nums text-muted-foreground">separate run</td>
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
                {hasCheckboxCol && <td />}
                <td className="px-4 py-2.5">
                  <p className="text-sm font-medium">{dr.bulk_product_name}</p>
                  <p className="text-[10px] font-mono text-muted-foreground">{dr.bulk_product_sku} · {dr.run_number}</p>
                </td>
                <td className="px-4 py-2.5 text-xs text-muted-foreground">ad-hoc</td>
                <td className="px-4 py-2.5 text-sm text-right tabular-nums text-muted-foreground">ad-hoc</td>
                <td className="px-4 py-2.5 text-sm text-right tabular-nums text-muted-foreground">—</td>
                <td className="px-4 py-2.5 text-sm text-right tabular-nums font-bold text-amber-600">{dr.target_output_kg} kg</td>
                <td className="px-4 py-2.5 text-sm text-right tabular-nums text-muted-foreground">—</td>
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
    </div>
  );
}