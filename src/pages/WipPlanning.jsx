import React, { useState, useMemo, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  ClipboardCheck, Sun, CheckCircle2, XCircle, Loader2, ChevronDown, ChevronUp, SquareCheck
} from 'lucide-react';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { useAuth } from '@/lib/AuthContext';
import { getUserPermissions } from '@/lib/permissions';
import { useCustomRoles } from '@/components/settings/CustomRolesManager';
import { writeAuditLog } from '@/lib/auditLog';
import PageHelp from '@/components/help/PageHelp';
import QCBatchRow from '@/components/wip-planning/QCBatchRow';
import RestOverrideDialog from '@/components/wip-planning/RestOverrideDialog';
import WriteOffConfirmPanel from '@/components/wip-planning/WriteOffConfirmPanel';
import RunSelector from '@/components/wip-planning/RunSelector';
import ConsolidatedCookingGrid from '@/components/wip-planning/ConsolidatedCookingGrid';

const HELP_ITEMS = [
  { title: 'Select production runs', text: 'Start by choosing which production runs to plan for. You can include today\'s runs, tomorrow\'s, or any combination. The system will consolidate bulk cooking requirements across all selected runs.' },
  { title: 'Consolidated cooking requirements', text: 'When the same bulk product (e.g. Bulk Chicken Breast) is needed by multiple runs, the quantities are summed into one row. You can choose to keep it combined (one cooking run) or split it back per production run.' },
  { title: 'Morning Quality Check', text: 'Review each active WIP batch before production starts. Approve batches that pass inspection; decline those that don\'t. Declined batches are staged for write-off.' },
  { title: 'Release cooking runs', text: 'Click "Release Cooking Runs" to create cooking runs for the kitchen. Combined rows create one run; split rows create separate runs per production run.' },
  { title: 'Rest time enforcement', text: 'Some bulk products (e.g. brisket) require a minimum rest period after cooking. Batches that haven\'t rested long enough show a warning and require a PIN override from a Production Manager.' },
];

const today = () => format(new Date(), 'yyyy-MM-dd');

export default function WipPlanning() {
  const { user } = useAuth();
  const customRoles = useCustomRoles();
  const perms = getUserPermissions(user || {}, customRoles);
  const queryClient = useQueryClient();

  // Run selection state
  const [selectedRunIds, setSelectedRunIds] = useState(new Set());

  // QC flow state
  const [decisions, setDecisions] = useState({});
  const [qcSelected, setQcSelected] = useState(new Set());
  const [overrideBatch, setOverrideBatch] = useState(null);
  const [confirming, setConfirming] = useState(false);
  const [showQCSection, setShowQCSection] = useState(true);

  // ── Data queries ──

  const { data: batches = [], isLoading: loadingBatches } = useQuery({
    queryKey: ['wip-batches-planning'],
    queryFn: () => base44.entities.WipBatch.list('-created_date', 500),
  });

  const { data: sessions = [] } = useQuery({
    queryKey: ['qc-sessions-today'],
    queryFn: () => base44.entities.QualityCheckSession.filter({ session_date: today() }, '-created_date', 5),
  });

  const { data: wipProducts = [] } = useQuery({
    queryKey: ['wip-bulk-products-planning'],
    queryFn: () => base44.entities.Product.filter({ type: 'wip_bulk', status: 'active' }, 'name', 100),
  });

  // All production run lines (bulk load)
  const { data: allRunLines = [] } = useQuery({
    queryKey: ['all-run-lines-planning'],
    queryFn: () => base44.entities.ProductionRunLine.list('run_id', 2000),
  });

  // All production runs for lookup
  const { data: allProductionRuns = [] } = useQuery({
    queryKey: ['plannable-production-runs'],
    queryFn: async () => {
      const runs = await base44.entities.ProductionRun.list('-run_date', 200);
      return runs.filter(r => ['scheduled', 'in_progress', 'draft'].includes(r.status));
    },
  });

  const { data: portionBoms = [] } = useQuery({
    queryKey: ['portion-boms-planning'],
    queryFn: () => base44.entities.Bom.filter({ bom_type: 'portion', is_active: true }, 'product_name', 200),
  });

  const { data: bomComponents = [] } = useQuery({
    queryKey: ['bom-components-planning'],
    queryFn: () => base44.entities.BomComponent.list('bom_id', 2000),
  });

  const { data: cookBoms = [] } = useQuery({
    queryKey: ['cook-boms-planning'],
    queryFn: () => base44.entities.Bom.filter({ bom_type: 'cook', is_active: true }, 'product_name', 200),
  });

  const { data: allProducts = [] } = useQuery({
    queryKey: ['all-products-planning'],
    queryFn: () => base44.entities.Product.filter({ status: 'active' }, 'name', 500),
  });

  // Existing cooking runs (for release status check)
  const { data: existingCookingRuns = [] } = useQuery({
    queryKey: ['wip-cooking-runs'],
    queryFn: () => base44.entities.CookingRun.list('-created_date', 200),
  });

  // ── Lookups ──
  const productById = useMemo(() => {
    const map = {};
    wipProducts.forEach(p => { map[p.id] = p; });
    return map;
  }, [wipProducts]);

  const productTypeById = useMemo(() => {
    const map = {};
    allProducts.forEach(p => { map[p.id] = p.type; });
    return map;
  }, [allProducts]);

  const runById = useMemo(() => {
    const map = {};
    allProductionRuns.forEach(r => { map[r.id] = r; });
    return map;
  }, [allProductionRuns]);

  // ── Auto-select today's runs on first load ──
  React.useEffect(() => {
    if (selectedRunIds.size === 0 && allProductionRuns.length > 0) {
      const todayStr = today();
      const todayIds = allProductionRuns
        .filter(r => r.run_date === todayStr && ['scheduled', 'in_progress'].includes(r.status))
        .map(r => r.id);
      if (todayIds.length > 0) setSelectedRunIds(new Set(todayIds));
    }
  }, [allProductionRuns]);

  // ── Filter run lines by selected runs ──
  const selectedRunLines = useMemo(() => {
    return allRunLines.filter(l => selectedRunIds.has(l.run_id));
  }, [allRunLines, selectedRunIds]);

  // ── Calculate consolidated bulk requirements ──
  // Now tracks per-run contributions for combined/split
  const consolidatedRows = useMemo(() => {
    if (selectedRunLines.length === 0) return [];

    const bomByProductId = {};
    portionBoms.forEach(b => { bomByProductId[b.product_id] = b; });
    const compsByBomId = {};
    bomComponents.forEach(c => {
      if (!compsByBomId[c.bom_id]) compsByBomId[c.bom_id] = [];
      compsByBomId[c.bom_id].push(c);
    });
    const cookBomProductIds = new Set(cookBoms.map(b => b.product_id));

    // bulkReq[productId] = { name, sku, contributions: { [runId]: kgNeeded } }
    const bulkReq = {};
    for (const line of selectedRunLines) {
      const portionBom = bomByProductId[line.product_id];
      if (!portionBom) continue;
      const comps = compsByBomId[portionBom.id] || [];
      const bomYield = portionBom.yield_qty || 1;
      for (const comp of comps) {
        const isWipBulk = productTypeById[comp.input_product_id] === 'wip_bulk' || cookBomProductIds.has(comp.input_product_id);
        if (!isWipBulk) continue;

        // comp.qty is the amount needed for `bomYield` meals (the BOM's yield_qty)
        // So per-meal = comp.qty / bomYield
        const qtyPerBomYield = comp.qty || 0;
        const uom = (comp.uom || 'g').toLowerCase();
        const qtyInKg = uom === 'kg' ? qtyPerBomYield : uom === 'g' ? qtyPerBomYield / 1000 : qtyPerBomYield;
        const perMealKg = qtyInKg / bomYield;
        const totalKgNeeded = perMealKg * (line.planned_qty || 0);

        if (!bulkReq[comp.input_product_id]) {
          bulkReq[comp.input_product_id] = { name: comp.input_product_name, sku: comp.input_product_sku, contributions: {} };
        }
        const entry = bulkReq[comp.input_product_id];
        entry.contributions[line.run_id] = (entry.contributions[line.run_id] || 0) + totalKgNeeded;
      }
    }

    // Build available WIP
    const wipAvail = {};
    batches.filter(b => ['fresh', 'use_today'].includes(b.quality_status) && b.qty_kg > 0).forEach(b => {
      wipAvail[b.bulk_product_id] = (wipAvail[b.bulk_product_id] || 0) + b.qty_kg;
    });

    return Object.entries(bulkReq).map(([pid, data]) => {
      const totalRequired = Object.values(data.contributions).reduce((s, v) => s + v, 0);
      const available = wipAvail[pid] || 0;
      const netToCook = Math.max(0, totalRequired - available);
      const contributions = Object.entries(data.contributions).map(([runId, kg]) => ({
        runId,
        runNumber: runById[runId]?.run_number || runId,
        runDate: runById[runId]?.run_date || '',
        kgNeeded: kg,
      })).sort((a, b) => a.runNumber.localeCompare(b.runNumber));

      return {
        id: pid,
        name: data.name,
        sku: data.sku,
        requiredKg: totalRequired,
        availableKg: available,
        netToCookKg: netToCook,
        needsCooking: netToCook > 0,
        contributions,
      };
    }).sort((a, b) => b.netToCookKg - a.netToCookKg);
  }, [selectedRunLines, portionBoms, bomComponents, cookBoms, productTypeById, batches, runById]);

  // Ad-hoc draft cooking runs (not linked to any selected production run)
  const draftAdHocRuns = useMemo(() => {
    return existingCookingRuns.filter(r => r.status === 'draft');
  }, [existingCookingRuns]);

  // ── Stats ──
  const selectedRuns = useMemo(() => allProductionRuns.filter(r => selectedRunIds.has(r.id)), [allProductionRuns, selectedRunIds]);
  const totalMealsPlanned = selectedRunLines.reduce((s, l) => s + (l.planned_qty || 0), 0);
  const needsCookingCount = consolidatedRows.filter(r => r.needsCooking).length;
  const wipAvailableTotal = useMemo(() => {
    return batches.filter(b => ['fresh', 'use_today'].includes(b.quality_status) && b.qty_kg > 0)
      .reduce((s, b) => s + b.qty_kg, 0);
  }, [batches]);
  const releasedCount = existingCookingRuns.filter(r => r.status !== 'draft').length;

  // ── QC Logic (unchanged) ──
  const todaySession = sessions.find(s => s.session_date === today());
  const isSessionConfirmed = todaySession?.status === 'confirmed';

  const activeBatches = useMemo(() => {
    return batches.filter(b =>
      ['fresh', 'use_today'].includes(b.quality_status) && (b.qty_kg || 0) > 0
    ).sort((a, b) => (a.bulk_product_name || '').localeCompare(b.bulk_product_name || ''));
  }, [batches]);

  // Which bulk product IDs are components of the selected production runs?
  const componentProductIds = useMemo(() => {
    return new Set(consolidatedRows.map(r => r.id));
  }, [consolidatedRows]);

  // Tag each active batch as component or leftover
  // Only flag as "not a component" when runs are actually selected — otherwise don't flag at all
  const batchIsComponent = useMemo(() => {
    const map = {};
    const hasSelectedRuns = selectedRunIds.size > 0;
    activeBatches.forEach(b => {
      if (!hasSelectedRuns) {
        map[b.id] = undefined; // no runs selected, don't flag anything
      } else {
        map[b.id] = componentProductIds.has(b.bulk_product_id);
      }
    });
    return map;
  }, [activeBatches, componentProductIds, selectedRunIds]);

  // Batches that ARE components but haven't been QC'd yet (no decision made)
  const unqcComponentBatches = useMemo(() => {
    return activeBatches.filter(b => batchIsComponent[b.id] === true && !decisions[b.id]);
  }, [activeBatches, batchIsComponent, decisions]);

  const declinedBatches = useMemo(() => activeBatches.filter(b => decisions[b.id] === 'declined'), [activeBatches, decisions]);
  const approvedBatches = useMemo(() => activeBatches.filter(b => decisions[b.id] === 'approved'), [activeBatches, decisions]);
  const undecidedCount = activeBatches.length - Object.keys(decisions).length;
  const allDecided = undecidedCount === 0 && activeBatches.length > 0;

  const handleDecide = useCallback((batchId, decision) => {
    setDecisions(prev => {
      if (prev[batchId] === decision) {
        const next = { ...prev };
        delete next[batchId];
        return next;
      }
      return { ...prev, [batchId]: decision };
    });
  }, []);

  const handleRestOverride = useCallback((batch) => setOverrideBatch(batch), []);

  const handleRestOverrideConfirm = useCallback(async ({ reason, pin }) => {
    if (!overrideBatch) return;
    await base44.entities.RestTimeOverrideLog.create({
      wip_batch_id: overrideBatch.id,
      bulk_product_name: overrideBatch.bulk_product_name,
      batch_age_hours: overrideBatch.rest_ready_at
        ? Math.max(0, (new Date() - new Date(new Date(overrideBatch.rest_ready_at).getTime() - (productById[overrideBatch.bulk_product_id]?.minimum_rest_time_hours || 0) * 3600000)) / 3600000)
        : 0,
      required_rest_hours: productById[overrideBatch.bulk_product_id]?.minimum_rest_time_hours || 0,
      authorising_user_name: user?.full_name || 'Unknown',
      authorising_user_role: user?.role || 'unknown',
      reason,
      override_timestamp: new Date().toISOString(),
    });
    setDecisions(prev => ({ ...prev, [overrideBatch.id]: 'approved' }));
    toast.success(`Rest time override approved for ${overrideBatch.batch_number}`);
    setOverrideBatch(null);
  }, [overrideBatch, productById, user]);

  const handleConfirmSession = async () => {
    if (!allDecided) { toast.error('Check all batches before confirming'); return; }
    setConfirming(true);
    const todayStr = today();

    const qcRecords = activeBatches.map(b => ({
      wip_batch_id: b.id, check_date: todayStr, check_time: new Date().toISOString(),
      checked_by_name: user?.full_name || '', result: decisions[b.id], notes: null,
    }));
    if (qcRecords.length > 0) {
      for (let i = 0; i < qcRecords.length; i += 25)
        await base44.entities.WipQualityCheck.bulkCreate(qcRecords.slice(i, i + 25));
    }

    let writeOffId = null;
    if (declinedBatches.length > 0) {
      const lines = declinedBatches.map(b => ({
        wip_batch_id: b.id, bulk_product_name: b.bulk_product_name, qty_kg: b.qty_kg,
        carrying_cost_per_kg: b.carrying_cost_per_kg || 0, total_value: (b.qty_kg || 0) * (b.carrying_cost_per_kg || 0),
      }));
      const totalKg = lines.reduce((s, l) => s + l.qty_kg, 0);
      const totalValue = lines.reduce((s, l) => s + l.total_value, 0);
      const existingWOs = await base44.entities.WipWriteOff.list('-created_date', 1);
      const nextWO = existingWOs.length > 0
        ? (parseInt((existingWOs[0].write_off_number || '').replace(/\D/g, '') || '0') + 1) : 1;
      const woNumber = `WO-${new Date().getFullYear()}-${String(nextWO).padStart(4, '0')}`;
      const wo = await base44.entities.WipWriteOff.create({
        write_off_number: woNumber, write_off_type: 'bulk_qc', status: 'confirmed', write_off_date: todayStr,
        total_qty_kg: totalKg, total_value: totalValue, reason: 'quality_deterioration',
        notes: `Morning QC write-off — ${declinedBatches.length} batches`,
        approved_by_name: user?.full_name || '', confirmed_at: new Date().toISOString(), lines: JSON.stringify(lines),
      });
      writeOffId = wo.id;
      for (const b of declinedBatches) {
        await base44.entities.WipBatch.update(b.id, { quality_status: 'written_off', qty_kg: 0, total_carrying_value: 0 });
      }
    }

    for (const b of approvedBatches) {
      await base44.entities.WipBatch.update(b.id, { last_qc_date: todayStr, last_qc_by: user?.full_name || '' });
    }

    const sessionData = {
      session_date: todayStr, status: 'confirmed', total_batches_checked: activeBatches.length,
      approved_count: approvedBatches.length, declined_count: declinedBatches.length,
      write_off_id: writeOffId, write_off_confirmed: !!writeOffId,
      confirmed_by_name: user?.full_name || '', confirmed_at: new Date().toISOString(),
    };
    if (todaySession) await base44.entities.QualityCheckSession.update(todaySession.id, sessionData);
    else await base44.entities.QualityCheckSession.create(sessionData);

    writeAuditLog({
      action: 'create', entity_type: 'QualityCheckSession',
      description: `Morning QC: ${approvedBatches.length} approved, ${declinedBatches.length} declined${writeOffId ? ` (write-off ${declinedBatches.reduce((s, b) => s + b.qty_kg, 0).toFixed(1)} kg)` : ''}`,
    });

    queryClient.invalidateQueries({ queryKey: ['wip-batches-planning'] });
    queryClient.invalidateQueries({ queryKey: ['qc-sessions-today'] });
    queryClient.invalidateQueries({ queryKey: ['wip-batches'] });
    toast.success('Morning QC confirmed — cooking runs can now proceed');
    setConfirming(false);
    setDecisions({});
  };

  const isLoading = loadingBatches;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <ClipboardCheck className="w-6 h-6 text-primary" /> WIP Planning
        </h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Select runs → consolidate bulk requirements → QC check → release cooking runs
        </p>
      </div>

      <PageHelp items={HELP_ITEMS} />

      {/* ═══════════════════════════════════ */}
      {/* STEP 1: SELECT PRODUCTION RUNS      */}
      {/* ═══════════════════════════════════ */}
      <RunSelector selectedRunIds={selectedRunIds} onSelectionChange={setSelectedRunIds} />

      {/* ═══════════════════════════════════ */}
      {/* STEP 2: CONSOLIDATED REQUIREMENTS   */}
      {/* ═══════════════════════════════════ */}
      {selectedRunIds.size > 0 && (
        <>
          {/* KPI strip */}
          <div className="flex items-center gap-6 bg-card border border-border rounded-xl px-6 py-4 flex-wrap">
            <div>
              <p className="text-[10px] text-muted-foreground uppercase font-semibold">Selected Runs</p>
              <p className="text-lg font-bold">{selectedRuns.length}</p>
            </div>
            <div className="w-px h-8 bg-border" />
            <div>
              <p className="text-[10px] text-muted-foreground uppercase font-semibold">Meals Planned</p>
              <p className="text-lg font-bold">{totalMealsPlanned}</p>
            </div>
            <div className="w-px h-8 bg-border" />
            <div>
              <p className="text-[10px] text-muted-foreground uppercase font-semibold">Bulk Products</p>
              <p className="text-lg font-bold">{consolidatedRows.length}</p>
            </div>
            <div className="w-px h-8 bg-border" />
            <div>
              <p className="text-[10px] text-muted-foreground uppercase font-semibold">Need Cooking</p>
              <p className={`text-lg font-bold ${needsCookingCount > 0 ? 'text-red-600' : 'text-green-600'}`}>{needsCookingCount}</p>
            </div>
            <div className="w-px h-8 bg-border" />
            <div>
              <p className="text-[10px] text-muted-foreground uppercase font-semibold">WIP Available</p>
              <p className="text-lg font-bold">{wipAvailableTotal.toFixed(1)} kg</p>
            </div>
            <div className="w-px h-8 bg-border" />
            <div>
              <p className="text-[10px] text-muted-foreground uppercase font-semibold">Runs Released</p>
              <p className="text-lg font-bold">{releasedCount}</p>
            </div>
          </div>

          <ConsolidatedCookingGrid
            rows={consolidatedRows}
            wipProducts={wipProducts}
            cookBoms={cookBoms}
            existingCookingRuns={existingCookingRuns}
            canRelease={perms.cooking_runs_release}
            onReleased={() => queryClient.invalidateQueries({ queryKey: ['wip-cooking-runs'] })}
            draftAdHocRuns={draftAdHocRuns}
            isQcConfirmed={isSessionConfirmed}
            unqcComponentBatches={unqcComponentBatches}
          />
        </>
      )}

      {selectedRunIds.size === 0 && (
        <div className="bg-card border border-border rounded-xl p-8 text-center text-sm text-muted-foreground">
          Select one or more production runs above to see consolidated cooking requirements.
        </div>
      )}

      {/* ═══════════════════════════════════ */}
      {/* STEP 3: MORNING QC                  */}
      {/* ═══════════════════════════════════ */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <button
          onClick={() => setShowQCSection(!showQCSection)}
          className="w-full flex items-center justify-between px-5 py-4 hover:bg-muted/30 transition-colors"
        >
          <div className="flex items-center gap-3">
            <Sun className="w-5 h-5 text-amber-500" />
            <div className="text-left">
              <h2 className="text-base font-semibold">Morning Quality Check</h2>
              <p className="text-xs text-muted-foreground">
                {isSessionConfirmed
                  ? `✓ Completed — ${todaySession?.approved_count || 0} approved, ${todaySession?.declined_count || 0} declined`
                  : `${activeBatches.length} batches to check • ${Object.keys(decisions).length} decided`}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {isSessionConfirmed && (
              <Badge className="bg-green-100 text-green-700 text-xs gap-1"><CheckCircle2 className="w-3 h-3" /> Confirmed</Badge>
            )}
            {!isSessionConfirmed && allDecided && (
              <Badge className="bg-amber-100 text-amber-700 text-xs">Ready to confirm</Badge>
            )}
            {showQCSection ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
          </div>
        </button>

        {showQCSection && !isSessionConfirmed && (
          <div className="border-t border-border">
            {isLoading ? (
              <div className="text-center py-12 text-sm text-muted-foreground">Loading batches...</div>
            ) : activeBatches.length === 0 ? (
              <div className="text-center py-12 text-sm text-muted-foreground">
                No active WIP batches to check. Complete cooking runs first.
              </div>
            ) : (
              <>
                {/* Selection toolbar */}
                {activeBatches.length > 1 && (
                  <div className="flex items-center gap-2 px-4 py-3 border-b border-border bg-muted/20 flex-wrap">
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-1.5 h-8"
                      onClick={() => {
                        if (qcSelected.size === activeBatches.length) {
                          setQcSelected(new Set());
                        } else {
                          setQcSelected(new Set(activeBatches.map(b => b.id)));
                        }
                      }}
                    >
                      <SquareCheck className="w-3.5 h-3.5" />
                      {qcSelected.size === activeBatches.length ? 'Deselect All' : 'Select All'}
                    </Button>
                    {qcSelected.size > 0 && (
                      <span className="text-xs font-semibold text-primary tabular-nums">{qcSelected.size} selected</span>
                    )}
                    <div className="flex-1" />
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-1.5 h-8 text-green-700 border-green-300 hover:bg-green-50 dark:text-green-400 dark:border-green-800 dark:hover:bg-green-950"
                      disabled={qcSelected.size === 0}
                      onClick={() => {
                        const next = { ...decisions };
                        activeBatches.filter(b => qcSelected.has(b.id)).forEach(b => {
                          const prod = productById[b.bulk_product_id];
                          const restMet = !prod?.minimum_rest_time_hours || prod.minimum_rest_time_hours <= 0
                            || (b.rest_ready_at && new Date() >= new Date(b.rest_ready_at))
                            || b.rest_time_met !== false;
                          if (restMet) next[b.id] = 'approved';
                        });
                        setDecisions(next);
                        setQcSelected(new Set());
                        toast.success('Selected batches approved');
                      }}
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" /> Approve Selected
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-1.5 h-8 text-red-700 border-red-300 hover:bg-red-50 dark:text-red-400 dark:border-red-800 dark:hover:bg-red-950"
                      disabled={qcSelected.size === 0}
                      onClick={() => {
                        const next = { ...decisions };
                        activeBatches.filter(b => qcSelected.has(b.id)).forEach(b => {
                          next[b.id] = 'declined';
                        });
                        setDecisions(next);
                        setQcSelected(new Set());
                        toast.success('Selected batches declined');
                      }}
                    >
                      <XCircle className="w-3.5 h-3.5" /> Decline Selected
                    </Button>
                  </div>
                )}
                <div className="max-h-[50vh] overflow-y-auto">
                  {activeBatches.map(b => (
                    <QCBatchRow key={b.id} batch={b} decision={decisions[b.id]} onDecide={handleDecide}
                      onRestOverride={handleRestOverride} product={productById[b.bulk_product_id]}
                      selected={qcSelected.has(b.id)}
                      isComponent={batchIsComponent[b.id]}
                      onToggleSelect={(id) => setQcSelected(prev => {
                        const next = new Set(prev);
                        next.has(id) ? next.delete(id) : next.add(id);
                        return next;
                      })} />
                  ))}
                </div>
                {declinedBatches.length > 0 && (
                  <div className="px-4 py-3 border-t border-border">
                    <WriteOffConfirmPanel declinedBatches={declinedBatches} onConfirm={handleConfirmSession} confirming={confirming} />
                  </div>
                )}
                {allDecided && declinedBatches.length === 0 && (
                  <div className="px-4 py-3 border-t border-border">
                    <Button onClick={handleConfirmSession} disabled={confirming} className="w-full gap-2 h-11 bg-green-600 hover:bg-green-700">
                      {confirming ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                      Confirm QC — All {approvedBatches.length} Batches Approved
                    </Button>
                  </div>
                )}
                <div className="flex items-center gap-4 px-4 py-2.5 border-t border-border bg-muted/30 text-xs text-muted-foreground">
                  <span>{activeBatches.length} total</span>
                  <span className="text-green-600 font-medium">{approvedBatches.length} approved</span>
                  <span className="text-red-600 font-medium">{declinedBatches.length} declined</span>
                  <span>{undecidedCount} remaining</span>
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {overrideBatch && (
        <RestOverrideDialog open={!!overrideBatch} onOpenChange={open => { if (!open) setOverrideBatch(null); }}
          batch={overrideBatch} product={productById[overrideBatch.bulk_product_id]} onConfirm={handleRestOverrideConfirm} />
      )}
    </div>
  );
}