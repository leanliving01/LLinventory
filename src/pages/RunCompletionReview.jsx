import React, { useState, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Link, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { ArrowLeft, CheckCircle2, Loader2, ShieldCheck, ChefHat, TrendingDown, TrendingUp, Trash2, RotateCcw, Beef, Warehouse, Package, FileText } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatDateSAST } from '@/lib/dateUtils';
import { toast } from 'sonner';
import { writeAuditLog } from '@/lib/auditLog';
import { clearProductionFloorForRun } from '@/lib/productionFloorStock.js';
import ManagerPinModal from '@/components/production/ManagerPinModal';
import CompletionKPIStrip from '@/components/completion-review/CompletionKPIStrip';
import CompletionYieldTable from '@/components/completion-review/CompletionYieldTable';
import CompletionStockSections from '@/components/completion-review/CompletionStockSections';
import CompletionTaskNotes from '@/components/completion-review/CompletionTaskNotes';

export default function RunCompletionReview() {
  const urlParams = new URLSearchParams(window.location.search);
  const runId = window.location.pathname.split('/').filter(Boolean).pop();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [showPinModal, setShowPinModal] = useState(false);
  const [managerName, setManagerName] = useState('');
  const [completionNotes, setCompletionNotes] = useState('');
  const [completing, setCompleting] = useState(false);

  // Core data
  const { data: run } = useQuery({
    queryKey: ['production-run', runId],
    queryFn: () => base44.entities.ProductionRun.filter({ id: runId }).then(r => r[0]),
    enabled: !!runId,
  });

  const { data: lines = [] } = useQuery({
    queryKey: ['production-run-lines', runId],
    queryFn: () => base44.entities.ProductionRunLine.filter({ run_id: runId }, 'product_sku', 200),
    enabled: !!runId,
  });

  const { data: existingPickLists = [] } = useQuery({
    queryKey: ['pick-list-for-run', runId],
    queryFn: () => base44.entities.PickList.filter({ production_run_id: runId }, '-created_date', 1),
    enabled: !!runId,
  });
  const existingPickList = existingPickLists[0] || null;

  // Stock movements for summary
  const { data: movements = [], isLoading: loadingMovements } = useQuery({
    queryKey: ['completion-movements', runId],
    queryFn: async () => {
      const [runMvs, pickListRecs] = await Promise.all([
        base44.entities.StockMovement.filter({ ref_id: runId, ref_type: 'production_run' }, '-created_date', 500),
        base44.entities.PickList.filter({ production_run_id: runId }, '-created_date', 1),
      ]);
      if (pickListRecs.length > 0) {
        const pickMvs = await base44.entities.StockMovement.filter({ ref_id: pickListRecs[0].id, ref_type: 'pick_list' }, '-created_date', 500);
        return [...runMvs, ...pickMvs];
      }
      return runMvs;
    },
    enabled: !!runId,
  });

  // WIP batches
  const { data: wipBatches = [] } = useQuery({
    queryKey: ['completion-wip-batches', runId],
    queryFn: () => base44.entities.WipBatch.filter({ cooking_run_id: runId }, 'produced_date', 100),
    enabled: !!runId,
  });

  // Products for type mapping
  const { data: products = [] } = useQuery({
    queryKey: ['completion-products'],
    queryFn: () => base44.entities.Product.filter({ status: 'active' }, 'sku', 500),
  });

  // Tasks (for notes)
  const { data: tasks = [] } = useQuery({
    queryKey: ['completion-tasks', runId],
    queryFn: () => base44.entities.ProductionTask.filter({ run_id: runId }, 'step_no', 500),
    enabled: !!runId,
  });

  const productTypeMap = useMemo(() => {
    const map = {};
    products.forEach(p => { map[p.id] = p.type; });
    return map;
  }, [products]);

  // Actuals from lines (task-reported or from the run detail page)
  const actuals = useMemo(() => {
    const map = {};
    lines.forEach(l => { map[l.id] = l.actual_qty ?? l.planned_qty; });
    return map;
  }, [lines]);

  // Validate: all lines must have actuals
  const allLinesHaveActuals = lines.every(l => (l.actual_qty ?? 0) > 0 || actuals[l.id] > 0);

  // Check variance lines have reasons
  const missingReasons = lines.filter(l => {
    const actual = Number(actuals[l.id]) || 0;
    return actual !== l.planned_qty && !l.variance_reason;
  });

  const handleManagerVerified = ({ manager_name }) => {
    setManagerName(manager_name);
    setShowPinModal(false);
  };

  const handleCompleteRun = async () => {
    if (!managerName) {
      toast.error('Manager approval required');
      setShowPinModal(true);
      return;
    }

    setCompleting(true);

    // 1. Update each run line with actual_qty, reason, and status=done
    for (const line of lines) {
      const actualQty = Number(actuals[line.id]) || 0;
      const variance = actualQty - line.planned_qty;
      const reason = variance === 0 ? 'as_planned' : (line.variance_reason || 'as_planned');
      await base44.entities.ProductionRunLine.update(line.id, {
        actual_qty: actualQty,
        variance_reason: reason,
        status: 'done',
      });
    }

    // 2. Create StockMovement records (production_yield) for each line
    const yieldMovements = lines
      .filter(l => Number(actuals[l.id]) > 0)
      .map(l => ({
        product_id: l.product_id,
        product_sku: l.product_sku,
        product_name: l.product_name,
        qty: Number(actuals[l.id]),
        uom: 'pcs',
        reason: 'production_yield',
        ref_type: 'production_run',
        ref_id: runId,
        ref_number: run?.run_number || '',
        notes: `Run ${run?.run_number}: produced ${actuals[l.id]} of ${l.product_sku}`,
      }));

    if (yieldMovements.length > 0) {
      await base44.entities.StockMovement.bulkCreate(yieldMovements);
    }

    // 3. Update StockOnHand
    const stockRecords = await base44.entities.StockOnHand.list('-updated_date', 1000);
    const stockByProduct = {};
    stockRecords.forEach(s => {
      if (!stockByProduct[s.product_id]) stockByProduct[s.product_id] = s;
    });

    for (const line of lines) {
      const actualQty = Number(actuals[line.id]) || 0;
      if (actualQty === 0) continue;
      const existing = stockByProduct[line.product_id];
      if (existing) {
        const newOnHand = (existing.qty_on_hand || 0) + actualQty;
        await base44.entities.StockOnHand.update(existing.id, {
          qty_on_hand: newOnHand,
          qty_available: newOnHand - (existing.qty_committed || 0),
          last_updated_at: new Date().toISOString(),
        });
      } else {
        await base44.entities.StockOnHand.create({
          product_id: line.product_id,
          product_sku: line.product_sku,
          product_name: line.product_name,
          location_id: 'production',
          location_name: 'Production',
          qty_on_hand: actualQty,
          qty_committed: 0,
          qty_available: actualQty,
          uom: 'pcs',
          last_updated_at: new Date().toISOString(),
        });
      }
    }

    // 4. Clear Production floor SOH
    if (existingPickList) {
      await clearProductionFloorForRun(existingPickList.id);
    }

    // 5. Archive production tasks
    const runTasks = await base44.entities.ProductionTask.filter({ run_id: runId }, 'step_no', 500);
    for (const t of runTasks) {
      await base44.entities.ProductionTask.update(t.id, { archived: true });
    }

    // 6. Mark run as completed
    const totalActual = lines.reduce((s, l) => s + (Number(actuals[l.id]) || 0), 0);
    await base44.entities.ProductionRun.update(runId, {
      status: 'completed',
      total_units: totalActual,
      completed_at: new Date().toISOString(),
      notes: `${run?.notes ? run.notes + '\n' : ''}${completionNotes ? 'Completion notes: ' + completionNotes + '\n' : ''}Approved by ${managerName}`,
    });

    // Invalidate caches
    queryClient.invalidateQueries({ queryKey: ['production-run', runId] });
    queryClient.invalidateQueries({ queryKey: ['production-run-lines', runId] });
    queryClient.invalidateQueries({ queryKey: ['production-runs'] });
    queryClient.invalidateQueries({ queryKey: ['stock-on-hand'] });
    queryClient.invalidateQueries({ queryKey: ['production-tasks', runId] });

    writeAuditLog({
      action: 'finalize',
      entity_type: 'ProductionRun',
      entity_id: runId,
      description: `Completed run ${run?.run_number} — ${totalActual} units produced — Approved by ${managerName}`,
      new_value: { total_actual: totalActual, approved_by: managerName, completion_notes: completionNotes || undefined },
    });

    toast.success(`Run completed — ${totalActual} units produced, approved by ${managerName}`);
    setCompleting(false);
    navigate(`/production/run/${runId}`);
  };

  if (!run) {
    return <div className="text-center py-12 text-sm text-muted-foreground">Loading run...</div>;
  }

  if (run.status === 'completed') {
    return (
      <div className="text-center py-16 space-y-3">
        <CheckCircle2 className="w-12 h-12 text-green-600 mx-auto" />
        <p className="text-lg font-semibold">This run is already completed</p>
        <Link to={`/production/run/${runId}`}>
          <Button variant="outline">← Back to Run</Button>
        </Link>
      </div>
    );
  }

  if (run.status !== 'in_progress') {
    return (
      <div className="text-center py-16 space-y-3">
        <p className="text-muted-foreground">Run must be in progress to complete</p>
        <Link to={`/production/run/${runId}`}>
          <Button variant="outline">← Back to Run</Button>
        </Link>
      </div>
    );
  }

  const totalPlanned = lines.reduce((s, l) => s + l.planned_qty, 0);
  const totalActual = lines.reduce((s, l) => s + (Number(actuals[l.id]) || 0), 0);

  return (
    <div className="space-y-6 max-w-4xl mx-auto pb-24">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link to={`/production/run/${runId}`}>
          <Button variant="ghost" size="icon"><ArrowLeft className="w-4 h-4" /></Button>
        </Link>
        <div className="flex-1">
          <h1 className="text-2xl font-bold">Complete Run — {run.run_number}</h1>
          <p className="text-sm text-muted-foreground">
            {formatDateSAST(run.run_date)} · {lines.length} meals · {totalPlanned} planned
          </p>
        </div>
        <Badge className="bg-amber-100 text-amber-700">Review & Approve</Badge>
      </div>

      {/* KPI strip */}
      <CompletionKPIStrip
        lines={lines}
        actuals={actuals}
        movements={movements}
        wipBatches={wipBatches}
        productTypeMap={productTypeMap}
      />

      {/* Yield variance table */}
      <CompletionYieldTable lines={lines} actuals={actuals} />

      {/* Stock sections (leftovers, returns, wastage) */}
      <CompletionStockSections
        movements={movements}
        wipBatches={wipBatches}
        productTypeMap={productTypeMap}
        loading={loadingMovements}
      />

      {/* Task notes */}
      <CompletionTaskNotes tasks={tasks} />

      {/* Completion notes */}
      <div className="bg-card border border-border rounded-xl p-5 space-y-3">
        <div className="flex items-center gap-2">
          <FileText className="w-4 h-4 text-muted-foreground" />
          <h3 className="text-sm font-bold">Completion Notes</h3>
        </div>
        <p className="text-xs text-muted-foreground">Any additional notes about this production run (optional)</p>
        <Textarea
          placeholder="e.g. Equipment ran slow today, rice was slightly overcooked..."
          value={completionNotes}
          onChange={e => setCompletionNotes(e.target.value)}
          className="h-24"
        />
      </div>

      {/* Manager approval section */}
      <div className="bg-card border-2 border-primary/30 rounded-xl p-6 space-y-4">
        <div className="flex items-center gap-3">
          <ShieldCheck className="w-6 h-6 text-primary" />
          <div>
            <h3 className="text-lg font-bold">Manager Approval</h3>
            <p className="text-sm text-muted-foreground">A manager must verify and approve before finalizing this run</p>
          </div>
        </div>

        {managerName ? (
          <div className="bg-green-50 dark:bg-green-950 border border-green-200 dark:border-green-800 rounded-xl px-4 py-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-5 h-5 text-green-600" />
              <span className="text-sm font-semibold text-green-700 dark:text-green-300">
                Approved by {managerName}
              </span>
            </div>
            <Button variant="ghost" size="sm" onClick={() => { setManagerName(''); setShowPinModal(true); }} className="text-xs">
              Change
            </Button>
          </div>
        ) : (
          <Button
            size="lg"
            variant="outline"
            className="w-full h-14 text-lg gap-2 border-2 border-primary/40 hover:border-primary"
            onClick={() => setShowPinModal(true)}
          >
            <ShieldCheck className="w-5 h-5" />
            Enter Manager PIN
          </Button>
        )}
      </div>

      {/* Final confirm button — sticky at bottom */}
      <div className="fixed bottom-0 left-0 right-0 bg-card/95 backdrop-blur-sm border-t border-border px-6 py-4 z-40">
        <div className="max-w-4xl mx-auto flex items-center justify-between gap-4">
          <div className="text-sm">
            <span className="font-semibold">{totalActual}</span>
            <span className="text-muted-foreground"> meals produced</span>
            {totalActual !== totalPlanned && (
              <Badge className={cn("ml-2 text-xs", totalActual >= totalPlanned ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700")}>
                {totalActual >= totalPlanned ? '+' : ''}{totalActual - totalPlanned} variance
              </Badge>
            )}
          </div>
          <Button
            size="lg"
            className="h-12 px-8 gap-2 text-lg font-bold bg-green-600 hover:bg-green-700"
            disabled={completing || !managerName}
            onClick={handleCompleteRun}
          >
            {completing ? (
              <><Loader2 className="w-5 h-5 animate-spin" /> Completing...</>
            ) : (
              <><CheckCircle2 className="w-5 h-5" /> Confirm & Complete Run</>
            )}
          </Button>
        </div>
      </div>

      {/* Manager PIN modal */}
      {showPinModal && (
        <ManagerPinModal
          onVerified={handleManagerVerified}
          onCancel={() => setShowPinModal(false)}
        />
      )}
    </div>
  );
}