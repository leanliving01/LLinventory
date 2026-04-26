import React, { useState, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ArrowLeft, CheckCircle2, Play, ClipboardList, LayoutGrid, Package, FileText, BarChart3 } from 'lucide-react';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import RunLineTable from '@/components/production/RunLineTable';
import StockGuardrailModal from '@/components/production/StockGuardrailModal';
import SurplusModal from '@/components/production/SurplusModal';
import ProductionSummaryModal from '@/components/production/ProductionSummaryModal';
import HelpDrawer from '@/components/help/HelpDrawer';
import VarianceReport from '@/components/production/VarianceReport';
import { writeAuditLog } from '@/lib/auditLog';

const STATUS_STYLES = {
  draft: 'bg-muted text-muted-foreground',
  scheduled: 'bg-blue-100 text-blue-700',
  in_progress: 'bg-amber-100 text-amber-700',
  completed: 'bg-green-100 text-green-700',
  cancelled: 'bg-red-100 text-red-700',
};

export default function ProductionRunDetail() {
  const urlParams = new URLSearchParams(window.location.search);
  const runId = window.location.pathname.split('/').pop();
  const queryClient = useQueryClient();
  const [actuals, setActuals] = useState({});
  const [reasons, setReasons] = useState({});
  const [completing, setCompleting] = useState(false);
  const [starting, setStarting] = useState(false);
  const [showGuardrail, setShowGuardrail] = useState(false);
  const [shortages, setShortages] = useState([]);
  const [showSurplus, setShowSurplus] = useState(false);
  const [surplusLines, setSurplusLines] = useState([]);
  const [showSummary, setShowSummary] = useState(false);
  const [showVariance, setShowVariance] = useState(false);

  const { data: run, isLoading: loadingRun } = useQuery({
    queryKey: ['production-run', runId],
    queryFn: () => base44.entities.ProductionRun.filter({ id: runId }).then(r => r[0]),
    enabled: !!runId,
  });

  const { data: lines = [], isLoading: loadingLines } = useQuery({
    queryKey: ['production-run-lines', runId],
    queryFn: () => base44.entities.ProductionRunLine.filter({ run_id: runId }, 'product_sku', 200),
    enabled: !!runId,
  });

  // Pre-fill actuals from lines that already have actual_qty
  useMemo(() => {
    const prefilled = {};
    lines.forEach(l => {
      if (l.actual_qty > 0 && actuals[l.id] === undefined) {
        prefilled[l.id] = l.actual_qty;
      }
    });
    if (Object.keys(prefilled).length > 0) {
      setActuals(prev => ({ ...prefilled, ...prev }));
    }
  }, [lines]);

  const handleActualChange = (lineId, value) => {
    setActuals(prev => ({ ...prev, [lineId]: value }));
  };

  const handleReasonChange = (lineId, value) => {
    setReasons(prev => ({ ...prev, [lineId]: value }));
  };

  // Pre-fill all actuals = planned
  const handleFillPlanned = () => {
    const filled = {};
    lines.forEach(l => { filled[l.id] = l.planned_qty; });
    setActuals(filled);
  };

  // §5.1.8 Not-Enough-Stock Guardrail — check before starting
  const handleStartRun = async () => {
    setStarting(true);
    // Check stock availability
    const [stockRecords, boms, bomComponents, products] = await Promise.all([
      base44.entities.StockOnHand.list('-updated_date', 2000),
      base44.entities.Bom.filter({ is_active: true }, '-created_date', 500),
      base44.entities.BomComponent.list('-created_date', 2000),
      base44.entities.Product.filter({ status: 'active' }, 'name', 500),
    ]);

    const productMap = {};
    products.forEach(p => { productMap[p.id] = p; });
    const stockMap = {};
    stockRecords.forEach(s => {
      if (!stockMap[s.product_id]) stockMap[s.product_id] = 0;
      stockMap[s.product_id] += s.qty_on_hand || 0;
    });
    const compsByBom = {};
    bomComponents.forEach(c => {
      if (!compsByBom[c.bom_id]) compsByBom[c.bom_id] = [];
      compsByBom[c.bom_id].push(c);
    });

    // Calculate total RAW ingredient needs — drill through Portion → WIP → Cook BOM
    // WIP items are made during the run from raw ingredients, so check raw stock, not WIP stock.
    const ingredientNeeds = {};
    for (const line of lines) {
      const portionBom = boms.find(b => b.product_id === line.product_id && b.bom_type === 'portion');
      if (!portionBom) continue;
      const comps = compsByBom[portionBom.id] || [];
      for (const c of comps) {
        const perUnit = c.qty / (portionBom.yield_qty || 1);
        const total = perUnit * line.planned_qty;
        const inputProduct = productMap[c.input_product_id];

        if (inputProduct?.type === 'wip_bulk') {
          // WIP = made during the run. Drill into its Cook BOM for raw ingredients.
          const cookBom = boms.find(b => b.product_id === inputProduct.id && b.bom_type === 'cook');
          if (cookBom) {
            const cookComps = compsByBom[cookBom.id] || [];
            const cookYield = cookBom.yield_qty || 1;
            for (const cc of cookComps) {
              if (cc.is_consumable) continue;
              const rawTotal = (cc.qty / cookYield) * total;
              if (!ingredientNeeds[cc.input_product_id]) ingredientNeeds[cc.input_product_id] = 0;
              ingredientNeeds[cc.input_product_id] += rawTotal;
            }
          } else {
            // No Cook BOM — treat WIP itself as needed
            if (!ingredientNeeds[c.input_product_id]) ingredientNeeds[c.input_product_id] = 0;
            ingredientNeeds[c.input_product_id] += total;
          }
        } else {
          // Raw/packaging/other — check directly
          if (!ingredientNeeds[c.input_product_id]) ingredientNeeds[c.input_product_id] = 0;
          ingredientNeeds[c.input_product_id] += total;
        }
      }
    }

    const foundShortages = [];
    for (const [pid, needed] of Object.entries(ingredientNeeds)) {
      const available = stockMap[pid] || 0;
      if (available < needed) {
        const p = productMap[pid];
        foundShortages.push({
          name: p?.name || pid,
          uom: p?.stock_uom || 'pcs',
          needed: Math.round(needed * 100) / 100,
          available: Math.round(available * 100) / 100,
          short: Math.round((needed - available) * 100) / 100,
        });
      }
    }

    if (foundShortages.length > 0) {
      setShortages(foundShortages);
      setShowGuardrail(true);
      setStarting(false);
      return;
    }

    await doStartRun();
  };

  const doStartRun = async () => {
    setStarting(true);
    await base44.entities.ProductionRun.update(runId, {
      status: 'in_progress',
      started_at: new Date().toISOString(),
    });

    // §5.1.4/5 Generate tasks from BOM operations
    // Look at Cook BOM operations (bulk cooking tasks) + Portion BOM operations
    const [boms, bomOps, bomComponents, products] = await Promise.all([
      base44.entities.Bom.filter({ is_active: true }, '-created_date', 500),
      base44.entities.BomOperation.list('-created_date', 2000),
      base44.entities.BomComponent.list('-created_date', 2000),
      base44.entities.Product.filter({ status: 'active' }, 'name', 500),
    ]);

    const opsByBom = {};
    bomOps.forEach(op => {
      if (!opsByBom[op.bom_id]) opsByBom[op.bom_id] = [];
      opsByBom[op.bom_id].push(op);
    });

    const compsByBom = {};
    bomComponents.forEach(c => {
      if (!compsByBom[c.bom_id]) compsByBom[c.bom_id] = [];
      compsByBom[c.bom_id].push(c);
    });

    const productMap = {};
    products.forEach(p => { productMap[p.id] = p; });

    // Collect unique WIP products from all lines' Portion BOMs to generate Cook tasks
    const wipTasksCreated = new Set(); // track by cook BOM id to avoid duplicates
    const tasksToCreate = [];

    for (const line of lines) {
      const portionBom = boms.find(b => b.product_id === line.product_id && b.bom_type === 'portion');
      if (!portionBom) continue;

      // Find WIP inputs in the Portion BOM → get their Cook BOM operations
      const portionComps = compsByBom[portionBom.id] || [];
      for (const comp of portionComps) {
        const inputProduct = productMap[comp.input_product_id];
        if (!inputProduct || inputProduct.type !== 'wip_bulk') continue;

        const cookBom = boms.find(b => b.product_id === inputProduct.id && b.bom_type === 'cook');
        if (!cookBom || wipTasksCreated.has(cookBom.id)) continue;
        wipTasksCreated.add(cookBom.id);

        const cookOps = opsByBom[cookBom.id] || [];
        if (cookOps.length > 0) {
          for (const op of cookOps) {
            tasksToCreate.push({
              run_id: runId,
              line_id: line.id,
              product_id: inputProduct.id,
              product_sku: inputProduct.sku,
              meal_name: inputProduct.name,
              name: op.name,
              station: op.station,
              step_no: op.step_no,
              qty: line.planned_qty,
              status: 'pending',
              notes: op.notes || '',
            });
          }
        } else {
          // Default cook task for this WIP
          tasksToCreate.push({
            run_id: runId,
            line_id: line.id,
            product_id: inputProduct.id,
            product_sku: inputProduct.sku,
            meal_name: inputProduct.name,
            name: `Cook ${inputProduct.name}`,
            station: 'cook',
            step_no: 1,
            qty: line.planned_qty,
            status: 'pending',
          });
        }
      }

      // Also add Portion BOM operations (portioning step)
      const portionOps = opsByBom[portionBom.id] || [];
      if (portionOps.length > 0) {
        for (const op of portionOps) {
          tasksToCreate.push({
            run_id: runId,
            line_id: line.id,
            product_id: line.product_id,
            product_sku: line.product_sku,
            meal_name: line.product_name,
            name: op.name,
            station: op.station,
            step_no: op.step_no,
            qty: line.planned_qty,
            status: 'pending',
            notes: op.notes || '',
          });
        }
      } else {
        // Default portion task
        tasksToCreate.push({
          run_id: runId,
          line_id: line.id,
          product_id: line.product_id,
          product_sku: line.product_sku,
          meal_name: line.product_name,
          name: `Portion ${line.product_name}`,
          station: 'portion',
          step_no: 1,
          qty: line.planned_qty,
          status: 'pending',
        });
      }
    }

    if (tasksToCreate.length > 0) {
      // Bulk create in batches of 25
      for (let i = 0; i < tasksToCreate.length; i += 25) {
        await base44.entities.ProductionTask.bulkCreate(tasksToCreate.slice(i, i + 25));
      }
    }

    queryClient.invalidateQueries({ queryKey: ['production-run', runId] });
    writeAuditLog({ action: 'update', entity_type: 'ProductionRun', entity_id: runId, description: `Started production run ${run?.run_number} — ${tasksToCreate.length} tasks created` });
    toast.success(`Run started — ${tasksToCreate.length} kitchen tasks created`);
    setStarting(false);
    setShowGuardrail(false);
  };

  const handleCompleteRun = async () => {
    // Validate all lines have actuals
    const missingLines = lines.filter(l => actuals[l.id] === undefined || actuals[l.id] === '');
    if (missingLines.length > 0) {
      toast.error(`${missingLines.length} meals still need actual quantities`);
      return;
    }

    // Validate variance lines have reasons
    const varianceWithoutReason = lines.filter(l => {
      const actual = Number(actuals[l.id]) || 0;
      const hasVariance = actual !== l.planned_qty;
      return hasVariance && !reasons[l.id] && !l.variance_reason;
    });
    if (varianceWithoutReason.length > 0) {
      toast.error(`${varianceWithoutReason.length} meals with variance still need a reason`);
      return;
    }

    setCompleting(true);

    // 1. Update each run line with actual_qty, reason, and status=done
    for (const line of lines) {
      const actualQty = Number(actuals[line.id]) || 0;
      const variance = actualQty - line.planned_qty;
      const reason = variance === 0 ? 'as_planned' : (reasons[line.id] || line.variance_reason || 'as_planned');
      await base44.entities.ProductionRunLine.update(line.id, {
        actual_qty: actualQty,
        variance_reason: reason,
        variance_notes: '',
        status: 'done',
      });
    }

    // 2. Create StockMovement records (production_yield) for each line
    const movements = lines
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
        notes: `Run ${run?.run_number}: produced ${actuals[l.id]} of ${l.product_sku}`,
      }));

    if (movements.length > 0) {
      await base44.entities.StockMovement.bulkCreate(movements);
    }

    // 3. Update StockOnHand — increment qty_on_hand for each product
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

    // 4. Archive all production tasks for this run
    const runTasks = await base44.entities.ProductionTask.filter({ run_id: runId }, 'step_no', 500);
    for (let i = 0; i < runTasks.length; i++) {
      await base44.entities.ProductionTask.update(runTasks[i].id, { archived: true });
    }

    // 5. Mark run as completed
    const totalActual = lines.reduce((s, l) => s + (Number(actuals[l.id]) || 0), 0);
    await base44.entities.ProductionRun.update(runId, {
      status: 'completed',
      total_units: totalActual,
      completed_at: new Date().toISOString(),
    });

    queryClient.invalidateQueries({ queryKey: ['production-run', runId] });
    queryClient.invalidateQueries({ queryKey: ['production-run-lines', runId] });
    queryClient.invalidateQueries({ queryKey: ['production-runs'] });
    queryClient.invalidateQueries({ queryKey: ['stock-on-hand'] });
    queryClient.invalidateQueries({ queryKey: ['production-tasks', runId] });
    writeAuditLog({
      action: 'finalize',
      entity_type: 'ProductionRun',
      entity_id: runId,
      description: `Completed run ${run?.run_number} — ${totalActual} units produced (${lines.length} meals)`,
      new_value: { total_actual: totalActual, lines_count: lines.length },
    });
    toast.success(`Run completed — ${totalActual} units produced, stock updated`);
    setCompleting(false);
    setShowSummary(true);

    // §5.1.6 Check for surplus lines
    const surplus = lines.filter(l => {
      const actual = Number(actuals[l.id]) || 0;
      return actual > l.planned_qty;
    }).map(l => ({
      ...l,
      surplus: (Number(actuals[l.id]) || 0) - l.planned_qty,
    }));
    if (surplus.length > 0) {
      setSurplusLines(surplus);
      setShowSurplus(true);
    }
  };

  const handleSurplusConfirm = async (dispositions) => {
    setCompleting(true);
    for (const line of surplusLines) {
      const disposition = dispositions[line.id];
      if (!disposition || disposition === 'reuse_tomorrow') continue; // kept in stock, no action needed
      if (disposition === 'waste') {
        await base44.entities.StockMovement.create({
          product_id: line.product_id,
          product_sku: line.product_sku,
          product_name: line.product_name,
          qty: line.surplus,
          uom: 'pcs',
          reason: 'wastage_usable',
          ref_type: 'production_run',
          ref_id: runId,
          notes: `Surplus waste from run ${run?.run_number}: ${line.surplus} units of ${line.product_sku}`,
        });
      }
      // replate_today = keep in stock as-is (already counted in actuals)
    }
    setShowSurplus(false);
    setSurplusLines([]);
    setCompleting(false);
    toast.success('Surplus dispositions recorded');
  };

  if (loadingRun || loadingLines) {
    return <div className="text-center py-12 text-sm text-muted-foreground">Loading run...</div>;
  }

  if (!run) {
    return (
      <div className="text-center py-16">
        <p className="text-muted-foreground">Run not found</p>
        <Link to="/production/runs" className="text-primary text-sm mt-2 inline-block">← Back to runs</Link>
      </div>
    );
  }

  const isEditable = run.status === 'scheduled' || run.status === 'in_progress';
  const canComplete = run.status === 'in_progress';
  const canStart = run.status === 'scheduled';
  const filledCount = lines.filter(l => actuals[l.id] !== undefined && actuals[l.id] !== '').length;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link to="/production/runs">
          <Button variant="ghost" size="icon"><ArrowLeft className="w-4 h-4" /></Button>
        </Link>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold">{run.run_number || 'Production Run'}</h1>
            <Badge className={cn(STATUS_STYLES[run.status])}>{run.status?.replace('_', ' ')}</Badge>
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-0.5">
            <span className="text-sm text-muted-foreground">{run.run_date ? format(new Date(run.run_date), 'dd MMM yyyy') : '—'}</span>
            <span className="text-sm text-muted-foreground">·</span>
            <span className="text-sm text-muted-foreground">{lines.length} meals · {run.total_units} planned units</span>
            {run.started_at && (
              <>
                <span className="text-sm text-muted-foreground">·</span>
                <Badge variant="outline" className="text-xs font-mono gap-1">
                  Started {format(new Date(run.started_at), 'HH:mm')}
                </Badge>
              </>
            )}
            {run.completed_at && (
              <>
                <Badge variant="outline" className="text-xs font-mono gap-1 bg-green-50 text-green-700 border-green-200">
                  Finished {format(new Date(run.completed_at), 'HH:mm')}
                </Badge>
                <Badge variant="outline" className="text-xs font-mono gap-1">
                  Duration: {(() => {
                    const ms = new Date(run.completed_at) - new Date(run.started_at);
                    const h = Math.floor(ms / 3600000);
                    const m = Math.floor((ms % 3600000) / 60000);
                    return h > 0 ? `${h}h ${m}m` : `${m}m`;
                  })()}
                </Badge>
              </>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <HelpDrawer pageKey="production-run-detail" />
          {(run.status === 'scheduled' || run.status === 'in_progress' || run.status === 'completed') && (
            <Link to={`/production/run/${runId}/pick-list`}>
              <Button variant="outline" size="sm" className="gap-1.5">
                <ClipboardList className="w-4 h-4" /> Pick List
              </Button>
            </Link>
          )}
          {(run.status === 'in_progress') && (
            <Link to={`/production/run/${runId}/kanban`}>
              <Button variant="outline" size="sm" className="gap-1.5">
                <LayoutGrid className="w-4 h-4" /> Kitchen Board
              </Button>
            </Link>
          )}
          {canStart && (
            <Button onClick={handleStartRun} disabled={starting} className="gap-2 bg-amber-600 hover:bg-amber-700">
              <Play className="w-4 h-4" />
              {starting ? 'Checking stock...' : 'Start Run'}
            </Button>
          )}
          {isEditable && (
            <Button variant="outline" onClick={handleFillPlanned} size="sm">
              Fill Planned
            </Button>
          )}
          {canComplete && (
            <Button
              onClick={handleCompleteRun}
              disabled={completing || filledCount === 0}
              className="gap-2 bg-green-600 hover:bg-green-700"
              size="lg"
            >
              <CheckCircle2 className="w-5 h-5" />
              {completing ? 'Completing...' : `Confirm Complete (${filledCount}/${lines.length})`}
            </Button>
          )}
        </div>
      </div>

      {run.status === 'completed' && (
        <div className="bg-green-50 border border-green-200 rounded-lg px-4 py-3 text-sm text-green-700 flex items-center justify-between">
          <span>✓ This run is completed. Stock movements have been recorded.</span>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 border-green-300 text-green-700 hover:bg-green-100"
              onClick={() => setShowSummary(true)}
            >
              <FileText className="w-4 h-4" /> View Summary
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 border-green-300 text-green-700 hover:bg-green-100"
              onClick={() => setShowVariance(true)}
            >
              <BarChart3 className="w-4 h-4" /> Variance Report
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 border-green-300 text-green-700 hover:bg-green-100"
              onClick={() => {
                const surplus = lines.filter(l => (l.actual_qty || 0) > l.planned_qty).map(l => ({
                  ...l,
                  surplus: (l.actual_qty || 0) - l.planned_qty,
                }));
                if (surplus.length === 0) {
                  toast.info('No surplus lines on this run — all actuals matched or were below planned.');
                  return;
                }
                setSurplusLines(surplus);
                setShowSurplus(true);
              }}
            >
              <Package className="w-4 h-4" /> Review Leftover Stock
            </Button>
          </div>
        </div>
      )}

      {/* Lines table */}
      <RunLineTable
        lines={lines}
        actuals={actuals}
        reasons={reasons}
        onActualChange={handleActualChange}
        onReasonChange={handleReasonChange}
        isEditable={isEditable}
      />

      {/* §5.1.8 Stock Guardrail Modal — hard block, no override */}
      {showGuardrail && (
        <StockGuardrailModal
          shortages={shortages}
          onCancel={() => { setShowGuardrail(false); setStarting(false); }}
        />
      )}

      {/* §5.1.6 Surplus Modal */}
      {showSurplus && (
        <SurplusModal
          surplusLines={surplusLines}
          onConfirm={handleSurplusConfirm}
          onCancel={() => { setShowSurplus(false); setSurplusLines([]); }}
          loading={completing}
        />
      )}

      {/* Production Summary Modal */}
      {showSummary && (
        <ProductionSummaryModal
          runId={runId}
          runNumber={run?.run_number}
          lines={lines}
          onClose={() => setShowSummary(false)}
        />
      )}

      {/* Variance Report Modal */}
      {showVariance && (
        <VarianceReport
          runId={runId}
          runNumber={run?.run_number}
          lines={lines}
          onClose={() => setShowVariance(false)}
        />
      )}
    </div>
  );
}