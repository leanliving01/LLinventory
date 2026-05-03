import React, { useState, useMemo, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  ClipboardCheck, Sun, CheckCircle2, AlertTriangle, CookingPot,
  Loader2, ChevronDown, ChevronUp
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
import CookingRequirementsGrid from '@/components/wip-planning/CookingRequirementsGrid';

const HELP_ITEMS = [
  { title: 'Morning Quality Check', text: 'Every morning, review each active WIP batch before production starts. Approve batches that pass inspection; decline those that don\'t. Declined batches are staged for write-off.' },
  { title: 'Cooking requirements', text: 'The system automatically reads today\'s scheduled production runs, identifies every bulk cooked component needed from the portion recipes, and calculates how much needs to be cooked.' },
  { title: 'Release cooking runs', text: 'Click "Release Cooking Runs" to auto-create draft cooking runs for every bulk product that needs cooking. Kitchen staff then execute those runs — they never need to create runs manually.' },
  { title: 'Rest time enforcement', text: 'Some bulk products (e.g. brisket) require a minimum rest period after cooking. Batches that haven\'t rested long enough show a warning and require a PIN override from a Production Manager.' },
];

const today = () => format(new Date(), 'yyyy-MM-dd');

export default function WipPlanning() {
  const { user } = useAuth();
  const customRoles = useCustomRoles();
  const perms = getUserPermissions(user || {}, customRoles);
  const queryClient = useQueryClient();

  // QC flow state
  const [decisions, setDecisions] = useState({}); // batchId → 'approved' | 'declined'
  const [overrideBatch, setOverrideBatch] = useState(null);
  const [confirming, setConfirming] = useState(false);
  const [showQCSection, setShowQCSection] = useState(true);

  // ── Data queries ──

  // WIP batches for QC and available inventory
  const { data: batches = [], isLoading: loadingBatches } = useQuery({
    queryKey: ['wip-batches-planning'],
    queryFn: () => base44.entities.WipBatch.list('-created_date', 500),
  });

  const { data: sessions = [] } = useQuery({
    queryKey: ['qc-sessions-today'],
    queryFn: () => base44.entities.QualityCheckSession.filter({ session_date: today() }, '-created_date', 5),
  });

  // Bulk cooked products (wip_bulk)
  const { data: wipProducts = [] } = useQuery({
    queryKey: ['wip-bulk-products-planning'],
    queryFn: () => base44.entities.Product.filter({ type: 'wip_bulk', status: 'active' }, 'name', 100),
  });

  // Today's production runs (scheduled or in_progress)
  const { data: todaysRuns = [] } = useQuery({
    queryKey: ['todays-production-runs'],
    queryFn: async () => {
      const all = await base44.entities.ProductionRun.list('-created_date', 100);
      return all.filter(r => r.run_date === today() && ['scheduled', 'in_progress'].includes(r.status));
    },
  });

  // All production run lines (for today's runs)
  const todayRunIds = useMemo(() => new Set(todaysRuns.map(r => r.id)), [todaysRuns]);
  const { data: allRunLines = [] } = useQuery({
    queryKey: ['todays-run-lines', ...Array.from(todayRunIds)],
    queryFn: () => base44.entities.ProductionRunLine.list('run_id', 2000),
    enabled: todayRunIds.size > 0,
  });
  const todayRunLines = useMemo(() => allRunLines.filter(l => todayRunIds.has(l.run_id)), [allRunLines, todayRunIds]);

  // Portion BOMs and their components (to traverse meal → bulk product)
  const { data: portionBoms = [] } = useQuery({
    queryKey: ['portion-boms-planning'],
    queryFn: () => base44.entities.Bom.filter({ bom_type: 'portion', is_active: true }, 'product_name', 200),
  });

  const { data: bomComponents = [] } = useQuery({
    queryKey: ['bom-components-planning'],
    queryFn: () => base44.entities.BomComponent.list('bom_id', 2000),
  });

  // Cook BOMs (for linking to CookingRun)
  const { data: cookBoms = [] } = useQuery({
    queryKey: ['cook-boms-planning'],
    queryFn: () => base44.entities.Bom.filter({ bom_type: 'cook', is_active: true }, 'product_name', 200),
  });

  // All products for type lookups
  const { data: allProducts = [] } = useQuery({
    queryKey: ['all-products-planning'],
    queryFn: () => base44.entities.Product.filter({ status: 'active' }, 'name', 500),
  });

  // Today's already-released cooking runs
  const { data: todaysCookingRuns = [] } = useQuery({
    queryKey: ['todays-cooking-runs'],
    queryFn: async () => {
      const all = await base44.entities.CookingRun.list('-created_date', 100);
      return all.filter(r => r.run_date === today());
    },
  });

  // Product lookup for rest time
  const productById = useMemo(() => {
    const map = {};
    wipProducts.forEach(p => { map[p.id] = p; });
    return map;
  }, [wipProducts]);

  // Today's session
  const todaySession = sessions.find(s => s.session_date === today());
  const isSessionConfirmed = todaySession?.status === 'confirmed';

  // Active batches for QC (fresh or use_today with qty > 0)
  const activeBatches = useMemo(() => {
    return batches.filter(b =>
      ['fresh', 'use_today'].includes(b.quality_status) && (b.qty_kg || 0) > 0
    ).sort((a, b) => (a.bulk_product_name || '').localeCompare(b.bulk_product_name || ''));
  }, [batches]);

  // Split by decision
  const declinedBatches = useMemo(() => {
    return activeBatches.filter(b => decisions[b.id] === 'declined');
  }, [activeBatches, decisions]);

  const approvedBatches = useMemo(() => {
    return activeBatches.filter(b => decisions[b.id] === 'approved');
  }, [activeBatches, decisions]);

  const undecidedCount = activeBatches.length - Object.keys(decisions).length;
  const allDecided = undecidedCount === 0 && activeBatches.length > 0;

  // ── Decision handler ──
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

  // ── Rest time override ──
  const handleRestOverride = useCallback((batch) => {
    setOverrideBatch(batch);
  }, []);

  const handleRestOverrideConfirm = useCallback(async ({ reason, pin }) => {
    if (!overrideBatch) return;
    // Log the override
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

    // Mark batch rest as overridden in local state and approve
    setDecisions(prev => ({ ...prev, [overrideBatch.id]: 'approved' }));
    toast.success(`Rest time override approved for ${overrideBatch.batch_number}`);
    setOverrideBatch(null);
  }, [overrideBatch, productById, user]);

  // ── Confirm QC Session ──
  const handleConfirmSession = async () => {
    if (!allDecided) { toast.error('Check all batches before confirming'); return; }
    setConfirming(true);

    const todayStr = today();

    // 1. Create WipQualityCheck records for each batch
    const qcRecords = activeBatches.map(b => ({
      wip_batch_id: b.id,
      check_date: todayStr,
      check_time: new Date().toISOString(),
      checked_by_name: user?.full_name || '',
      result: decisions[b.id],
      notes: null,
    }));
    if (qcRecords.length > 0) {
      for (let i = 0; i < qcRecords.length; i += 25) {
        await base44.entities.WipQualityCheck.bulkCreate(qcRecords.slice(i, i + 25));
      }
    }

    // 2. Handle declined batches → bulk write-off
    let writeOffId = null;
    if (declinedBatches.length > 0) {
      const lines = declinedBatches.map(b => ({
        wip_batch_id: b.id,
        bulk_product_name: b.bulk_product_name,
        qty_kg: b.qty_kg,
        carrying_cost_per_kg: b.carrying_cost_per_kg || 0,
        total_value: (b.qty_kg || 0) * (b.carrying_cost_per_kg || 0),
      }));
      const totalKg = lines.reduce((s, l) => s + l.qty_kg, 0);
      const totalValue = lines.reduce((s, l) => s + l.total_value, 0);

      // Generate write-off number
      const existingWOs = await base44.entities.WipWriteOff.list('-created_date', 1);
      const nextWO = existingWOs.length > 0
        ? (parseInt((existingWOs[0].write_off_number || '').replace(/\D/g, '') || '0') + 1) : 1;
      const woNumber = `WO-${new Date().getFullYear()}-${String(nextWO).padStart(4, '0')}`;

      const wo = await base44.entities.WipWriteOff.create({
        write_off_number: woNumber,
        write_off_type: 'bulk_qc',
        status: 'confirmed',
        write_off_date: todayStr,
        total_qty_kg: totalKg,
        total_value: totalValue,
        reason: 'quality_deterioration',
        notes: `Morning QC write-off — ${declinedBatches.length} batches`,
        approved_by_name: user?.full_name || '',
        confirmed_at: new Date().toISOString(),
        lines: JSON.stringify(lines),
      });
      writeOffId = wo.id;

      // Update declined batches to written_off
      for (const b of declinedBatches) {
        await base44.entities.WipBatch.update(b.id, {
          quality_status: 'written_off',
          qty_kg: 0,
          total_carrying_value: 0,
        });
      }
    }

    // 3. Update approved batches' last QC date
    for (const b of approvedBatches) {
      await base44.entities.WipBatch.update(b.id, {
        last_qc_date: todayStr,
        last_qc_by: user?.full_name || '',
      });
    }

    // 4. Create or update QC session
    const sessionData = {
      session_date: todayStr,
      status: 'confirmed',
      total_batches_checked: activeBatches.length,
      approved_count: approvedBatches.length,
      declined_count: declinedBatches.length,
      write_off_id: writeOffId,
      write_off_confirmed: !!writeOffId,
      confirmed_by_name: user?.full_name || '',
      confirmed_at: new Date().toISOString(),
    };

    if (todaySession) {
      await base44.entities.QualityCheckSession.update(todaySession.id, sessionData);
    } else {
      await base44.entities.QualityCheckSession.create(sessionData);
    }

    writeAuditLog({
      action: 'create',
      entity_type: 'QualityCheckSession',
      description: `Morning QC: ${approvedBatches.length} approved, ${declinedBatches.length} declined${writeOffId ? ` (write-off ${declinedBatches.reduce((s, b) => s + b.qty_kg, 0).toFixed(1)} kg)` : ''}`,
    });

    queryClient.invalidateQueries({ queryKey: ['wip-batches-planning'] });
    queryClient.invalidateQueries({ queryKey: ['qc-sessions-today'] });
    queryClient.invalidateQueries({ queryKey: ['wip-batches'] });
    toast.success('Morning QC confirmed — cooking runs can now proceed');
    setConfirming(false);
    setDecisions({});
  };

  // ── Build product type lookup ──
  const productTypeById = useMemo(() => {
    const map = {};
    allProducts.forEach(p => { map[p.id] = p.type; });
    return map;
  }, [allProducts]);

  // ── Calculate bulk cooking requirements from today's production run lines ──
  // Step 1: For each meal in today's runs, find its portion BOM
  // Step 2: For each portion BOM component that is a wip_bulk product (or has a cook BOM), sum the kg needed
  const wipRequirements = useMemo(() => {
    if (todayRunLines.length === 0) return {};

    // Build BOM lookups
    const bomByProductId = {};
    portionBoms.forEach(b => { bomByProductId[b.product_id] = b; });
    const compsByBomId = {};
    bomComponents.forEach(c => {
      if (!compsByBomId[c.bom_id]) compsByBomId[c.bom_id] = [];
      compsByBomId[c.bom_id].push(c);
    });
    const cookBomProductIds = new Set(cookBoms.map(b => b.product_id));

    const bulkReq = {};
    for (const line of todayRunLines) {
      const portionBom = bomByProductId[line.product_id];
      if (!portionBom) continue;
      const comps = compsByBomId[portionBom.id] || [];
      for (const comp of comps) {
        // Only count components that are WIP bulk products (have a cook BOM or type=wip_bulk)
        const isWipBulk = productTypeById[comp.input_product_id] === 'wip_bulk' || cookBomProductIds.has(comp.input_product_id);
        if (!isWipBulk) continue;

        const qtyPerMeal = comp.qty || 0;
        const uom = (comp.uom || 'g').toLowerCase();
        const perMealKg = uom === 'kg' ? qtyPerMeal : uom === 'g' ? qtyPerMeal / 1000 : qtyPerMeal;
        const totalKgNeeded = perMealKg * (line.planned_qty || 0);

        if (!bulkReq[comp.input_product_id]) {
          bulkReq[comp.input_product_id] = { name: comp.input_product_name, sku: comp.input_product_sku, requiredKg: 0 };
        }
        bulkReq[comp.input_product_id].requiredKg += totalKgNeeded;
      }
    }
    return bulkReq;
  }, [todayRunLines, portionBoms, bomComponents, cookBoms, productTypeById]);

  // ── Available WIP from batches ──
  const wipAvailable = useMemo(() => {
    const relevant = batches.filter(b => ['fresh', 'use_today'].includes(b.quality_status) && b.qty_kg > 0);
    const map = {};
    relevant.forEach(b => {
      if (!map[b.bulk_product_id]) map[b.bulk_product_id] = { name: b.bulk_product_name, sku: b.bulk_product_sku, totalKg: 0, batches: 0 };
      map[b.bulk_product_id].totalKg += b.qty_kg;
      map[b.bulk_product_id].batches += 1;
    });
    return map;
  }, [batches]);

  // ── Cooking requirements grid rows ──
  const cookingRows = useMemo(() => {
    const allIds = new Set([...Object.keys(wipRequirements), ...Object.keys(wipAvailable)]);
    // Only include products that are actually required today
    return Array.from(allIds)
      .filter(id => wipRequirements[id])
      .map(id => {
        const req = wipRequirements[id];
        const wip = wipAvailable[id] || { name: req.name, sku: req.sku, totalKg: 0, batches: 0 };
        const netToCookKg = Math.max(0, req.requiredKg - wip.totalKg);
        return {
          id, name: req.name || wip.name, sku: req.sku || wip.sku,
          requiredKg: req.requiredKg, availableKg: wip.totalKg, batchCount: wip.batches,
          netToCookKg, needsCooking: netToCookKg > 0,
        };
      })
      .sort((a, b) => b.netToCookKg - a.netToCookKg);
  }, [wipRequirements, wipAvailable]);

  const needsCookingCount = cookingRows.filter(r => r.needsCooking).length;
  const isLoading = loadingBatches;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <ClipboardCheck className="w-6 h-6 text-primary" /> WIP Planning
        </h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Morning QC → cooking requirements from today's production runs → release cooking runs
        </p>
      </div>

      <PageHelp items={HELP_ITEMS} />

      {/* ═══════════════════════════════════════════ */}
      {/* MORNING QC SECTION                          */}
      {/* ═══════════════════════════════════════════ */}
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
                  : `${activeBatches.length} batches to check • ${Object.keys(decisions).length} decided`
                }
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {isSessionConfirmed && (
              <Badge className="bg-green-100 text-green-700 text-xs gap-1">
                <CheckCircle2 className="w-3 h-3" /> Confirmed
              </Badge>
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
                {/* Batch list */}
                <div className="max-h-[50vh] overflow-y-auto">
                  {activeBatches.map(b => (
                    <QCBatchRow
                      key={b.id}
                      batch={b}
                      decision={decisions[b.id]}
                      onDecide={handleDecide}
                      onRestOverride={handleRestOverride}
                      product={productById[b.bulk_product_id]}
                    />
                  ))}
                </div>

                {/* Declined batches write-off preview */}
                {declinedBatches.length > 0 && (
                  <div className="px-4 py-3 border-t border-border">
                    <WriteOffConfirmPanel
                      declinedBatches={declinedBatches}
                      onConfirm={handleConfirmSession}
                      confirming={confirming}
                    />
                  </div>
                )}

                {/* Confirm button (when all decided but no declines) */}
                {allDecided && declinedBatches.length === 0 && (
                  <div className="px-4 py-3 border-t border-border">
                    <Button
                      onClick={handleConfirmSession}
                      disabled={confirming}
                      className="w-full gap-2 h-11 bg-green-600 hover:bg-green-700"
                    >
                      {confirming ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                      Confirm QC — All {approvedBatches.length} Batches Approved
                    </Button>
                  </div>
                )}

                {/* Summary bar */}
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

      {/* ═══════════════════════════════════════════ */}
      {/* COOKING REQUIREMENTS (from today's runs)    */}
      {/* ═══════════════════════════════════════════ */}
      <div className="flex items-center gap-6 bg-card border border-border rounded-xl px-6 py-4 flex-wrap">
        <div>
          <p className="text-[10px] text-muted-foreground uppercase font-semibold">Today's Runs</p>
          <p className="text-lg font-bold">{todaysRuns.length}</p>
        </div>
        <div className="w-px h-8 bg-border" />
        <div>
          <p className="text-[10px] text-muted-foreground uppercase font-semibold">Meals Planned</p>
          <p className="text-lg font-bold">{todayRunLines.reduce((s, l) => s + (l.planned_qty || 0), 0)}</p>
        </div>
        <div className="w-px h-8 bg-border" />
        <div>
          <p className="text-[10px] text-muted-foreground uppercase font-semibold">Bulk Products Needed</p>
          <p className="text-lg font-bold">{cookingRows.length}</p>
        </div>
        <div className="w-px h-8 bg-border" />
        <div>
          <p className="text-[10px] text-muted-foreground uppercase font-semibold">Need Cooking</p>
          <p className={`text-lg font-bold ${needsCookingCount > 0 ? 'text-red-600' : 'text-green-600'}`}>{needsCookingCount}</p>
        </div>
        <div className="w-px h-8 bg-border" />
        <div>
          <p className="text-[10px] text-muted-foreground uppercase font-semibold">WIP Available</p>
          <p className="text-lg font-bold">{Object.values(wipAvailable).reduce((s, w) => s + w.totalKg, 0).toFixed(1)} kg</p>
        </div>
        <div className="w-px h-8 bg-border" />
        <div>
          <p className="text-[10px] text-muted-foreground uppercase font-semibold">Runs Released</p>
          <p className="text-lg font-bold">{todaysCookingRuns.length}</p>
        </div>
      </div>

      <CookingRequirementsGrid
        rows={cookingRows}
        wipProducts={wipProducts}
        cookBoms={cookBoms}
        todaysCookingRuns={todaysCookingRuns}
        canRelease={perms.cooking_runs_release}
        onReleased={() => queryClient.invalidateQueries({ queryKey: ['todays-cooking-runs'] })}
      />

      {/* Rest override dialog */}
      {overrideBatch && (
        <RestOverrideDialog
          open={!!overrideBatch}
          onOpenChange={(open) => { if (!open) setOverrideBatch(null); }}
          batch={overrideBatch}
          product={productById[overrideBatch.bulk_product_id]}
          onConfirm={handleRestOverrideConfirm}
        />
      )}
    </div>
  );
}