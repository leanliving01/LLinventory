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
import ShortfallTable from '@/components/wip-planning/ShortfallTable';

const HELP_ITEMS = [
  { title: 'Morning Quality Check', text: 'Every morning, review each active WIP batch before production starts. Approve batches that pass inspection; decline those that don\'t. Declined batches are staged for write-off.' },
  { title: 'Rest time enforcement', text: 'Some bulk products (e.g. brisket) require a minimum rest period after cooking. Batches that haven\'t rested long enough show a warning and require a PIN override from a Production Manager.' },
  { title: 'Confirm & Release', text: 'Once all batches are checked, click "Confirm QC & Release Cooking Runs". Declined batches are written off and the shortfall analysis updates to reflect actual available WIP.' },
  { title: 'Shortfall analysis', text: 'After QC, the table shows how much of each bulk product is available vs required for today\'s meals. Red rows need cooking runs.' },
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

  // Data queries
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

  const { data: portionBoms = [] } = useQuery({
    queryKey: ['portion-boms-planning'],
    queryFn: () => base44.entities.Bom.filter({ bom_type: 'portion', is_active: true }, 'product_name', 200),
  });

  const { data: bomComponents = [] } = useQuery({
    queryKey: ['bom-components-planning'],
    queryFn: () => base44.entities.BomComponent.list('bom_id', 2000),
  });

  const { data: meals = [] } = useQuery({
    queryKey: ['finished-meals-planning'],
    queryFn: () => base44.entities.Product.filter({ type: 'finished_meal', status: 'active' }, 'name', 500),
  });

  const { data: stockRecords = [] } = useQuery({
    queryKey: ['stock-on-hand-planning'],
    queryFn: () => base44.entities.StockOnHand.list('-updated_date', 1000),
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

  // ── WIP shortfall analysis (uses approved batches only when session confirmed) ──
  const stockMap = useMemo(() => {
    const map = {};
    stockRecords.forEach(s => {
      if (!map[s.product_id]) map[s.product_id] = { qty_on_hand: 0, qty_committed: 0 };
      map[s.product_id].qty_on_hand += s.qty_on_hand || 0;
      map[s.product_id].qty_committed += s.qty_committed || 0;
    });
    return map;
  }, [stockRecords]);

  const wipAvailable = useMemo(() => {
    const relevantBatches = isSessionConfirmed
      ? batches.filter(b => ['fresh', 'use_today'].includes(b.quality_status) && b.qty_kg > 0)
      : batches.filter(b => ['fresh', 'use_today'].includes(b.quality_status) && b.qty_kg > 0);
    const map = {};
    relevantBatches.forEach(b => {
      if (!map[b.bulk_product_id]) map[b.bulk_product_id] = { name: b.bulk_product_name, sku: b.bulk_product_sku, totalKg: 0, batches: 0 };
      map[b.bulk_product_id].totalKg += b.qty_kg;
      map[b.bulk_product_id].batches += 1;
    });
    return map;
  }, [batches, isSessionConfirmed]);

  const wipRequirements = useMemo(() => {
    const bulkReq = {};
    portionBoms.forEach(bom => {
      const mealProduct = meals.find(m => m.id === bom.product_id);
      if (!mealProduct) return;
      const stock = stockMap[mealProduct.id] || { qty_on_hand: 0, qty_committed: 0 };
      const available = stock.qty_on_hand - stock.qty_committed;
      const par = mealProduct.par_level || 0;
      const mealsNeeded = Math.max(0, par - available);
      if (mealsNeeded <= 0) return;
      const comps = bomComponents.filter(c => c.bom_id === bom.id);
      comps.forEach(comp => {
        const qtyPerMeal = comp.qty || 0;
        const uom = (comp.uom || 'g').toLowerCase();
        const perMealKg = uom === 'kg' ? qtyPerMeal : uom === 'g' ? qtyPerMeal / 1000 : qtyPerMeal;
        const totalKgNeeded = perMealKg * mealsNeeded;
        if (!bulkReq[comp.input_product_id]) {
          bulkReq[comp.input_product_id] = { name: comp.input_product_name, sku: comp.input_product_sku, requiredKg: 0, mealCount: 0 };
        }
        bulkReq[comp.input_product_id].requiredKg += totalKgNeeded;
        bulkReq[comp.input_product_id].mealCount += mealsNeeded;
      });
    });
    return bulkReq;
  }, [portionBoms, bomComponents, meals, stockMap]);

  const shortfallRows = useMemo(() => {
    const allIds = new Set([...Object.keys(wipAvailable), ...Object.keys(wipRequirements)]);
    return Array.from(allIds).map(id => {
      const wip = wipAvailable[id] || { name: wipRequirements[id]?.name || '?', sku: wipRequirements[id]?.sku || '?', totalKg: 0, batches: 0 };
      const req = wipRequirements[id] || { requiredKg: 0, mealCount: 0 };
      const netKg = wip.totalKg - req.requiredKg;
      return {
        id, name: wip.name, sku: wip.sku, availableKg: wip.totalKg,
        batchCount: wip.batches, requiredKg: req.requiredKg, mealCount: req.mealCount,
        netKg, needsCooking: netKg < 0, cookingNeededKg: Math.max(0, -netKg),
      };
    }).sort((a, b) => a.netKg - b.netKg);
  }, [wipAvailable, wipRequirements]);

  const shortfallCount = shortfallRows.filter(r => r.needsCooking).length;
  const isLoading = loadingBatches;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <ClipboardCheck className="w-6 h-6 text-primary" /> WIP Planning
        </h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Morning quality check → write-offs → shortfall analysis → cooking runs
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
      {/* SHORTFALL ANALYSIS (always visible)         */}
      {/* ═══════════════════════════════════════════ */}
      <div className="flex items-center gap-6 bg-card border border-border rounded-xl px-6 py-4 flex-wrap">
        <div>
          <p className="text-[10px] text-muted-foreground uppercase font-semibold">Bulk Products</p>
          <p className="text-lg font-bold">{shortfallRows.length}</p>
        </div>
        <div className="w-px h-8 bg-border" />
        <div>
          <p className="text-[10px] text-muted-foreground uppercase font-semibold">Need Cooking</p>
          <p className={`text-lg font-bold ${shortfallCount > 0 ? 'text-red-600' : 'text-green-600'}`}>{shortfallCount}</p>
        </div>
        <div className="w-px h-8 bg-border" />
        <div>
          <p className="text-[10px] text-muted-foreground uppercase font-semibold">Total WIP Available</p>
          <p className="text-lg font-bold">{Object.values(wipAvailable).reduce((s, w) => s + w.totalKg, 0).toFixed(1)} kg</p>
        </div>
        {!isSessionConfirmed && (
          <>
            <div className="w-px h-8 bg-border" />
            <div>
              <Badge className="bg-amber-100 text-amber-700 text-[10px]">
                <AlertTriangle className="w-3 h-3 mr-1" /> QC not yet confirmed
              </Badge>
            </div>
          </>
        )}
      </div>

      <ShortfallTable rows={shortfallRows} />

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