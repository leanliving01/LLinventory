import React, { useState, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ArrowLeft, CheckCircle2, Play, ClipboardList, LayoutGrid, Package, FileText, BarChart3, RefreshCw, Trash2, XCircle, RotateCcw, ShieldAlert } from 'lucide-react';
import { formatDateSAST, formatTimeSAST } from '@/lib/dateUtils';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import RunLineTable from '@/components/production/RunLineTable';
import StockGuardrailModal from '@/components/production/StockGuardrailModal';
import SurplusModal from '@/components/production/SurplusModal';
import ProductionSummaryModal from '@/components/production/ProductionSummaryModal';
import HelpDrawer from '@/components/help/HelpDrawer';
import VarianceReport from '@/components/production/VarianceReport';
import RecalculateRunModal from '@/components/production/RecalculateRunModal';
import RunActionDialog from '@/components/production/RunActionDialog';
import { writeAuditLog } from '@/lib/auditLog';
import { splitTasksByEquipment } from '@/lib/equipmentSplitter';
import { useAuth } from '@/lib/AuthContext';
import { getUserPermissions } from '@/lib/permissions';
import { useCustomRoles } from '@/components/settings/CustomRolesManager';
import { generatePickList } from '@/lib/pickListGenerator';
import { clearProductionFloorForRun } from '@/lib/productionFloorStock.js';
import CookingGateModal from '@/components/production/CookingGateModal';

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
  const { user } = useAuth();
  const customRoles = useCustomRoles();
  const perms = getUserPermissions(user || {}, customRoles);
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
  const [showRecalculate, setShowRecalculate] = useState(false);
  const [plannedEdits, setPlannedEdits] = useState({});
  const [savingPlanned, setSavingPlanned] = useState(false);
  const [showCancelDialog, setShowCancelDialog] = useState(false);
  const [showRevertDialog, setShowRevertDialog] = useState(false);
  const [cookingGate, setCookingGate] = useState(null); // { title, description, items, itemLabel }

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

  // Check if a persisted PickList already exists for this run
  const { data: existingPickLists = [] } = useQuery({
    queryKey: ['pick-list-for-run', runId],
    queryFn: () => base44.entities.PickList.filter({ production_run_id: runId }, '-created_date', 1),
    enabled: !!runId,
  });
  const existingPickList = existingPickLists[0] || null;
  const [generatingPickList, setGeneratingPickList] = useState(false);

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

    // ── Gate B: Cooking runs must be completed & WIP available ──
    const [allCookRuns, wipBatches, boms_gate, bomComponents_gate, products_gate] = await Promise.all([
      base44.entities.CookingRun.list('-created_date', 500),
      base44.entities.WipBatch.list('-created_date', 500),
      base44.entities.Bom.filter({ is_active: true }, '-created_date', 500),
      base44.entities.BomComponent.list('-created_date', 2000),
      base44.entities.Product.filter({ status: 'active' }, 'name', 500),
    ]);

    // Find cooking runs linked to this production run
    const linkedCookRuns = allCookRuns.filter(cr => {
      if (cr.production_run_id === runId) return true;
      if (cr.contributing_run_ids) {
        try {
          const ids = JSON.parse(cr.contributing_run_ids);
          return Array.isArray(ids) && ids.includes(runId);
        } catch { return false; }
      }
      return false;
    });

    // Determine which WIP bulk products this run needs
    const productMap_gate = {};
    products_gate.forEach(p => { productMap_gate[p.id] = p; });
    const compsByBom_gate = {};
    bomComponents_gate.forEach(c => {
      if (!compsByBom_gate[c.bom_id]) compsByBom_gate[c.bom_id] = [];
      compsByBom_gate[c.bom_id].push(c);
    });
    const cookBomProductIds = new Set(boms_gate.filter(b => b.bom_type === 'cook').map(b => b.product_id));

    const wipNeeded = {}; // { productId: { name, sku, requiredKg } }
    for (const line of lines) {
      const portionBom = boms_gate.find(b => b.product_id === line.product_id && b.bom_type === 'portion');
      if (!portionBom) continue;
      const comps = compsByBom_gate[portionBom.id] || [];
      for (const c of comps) {
        if (!cookBomProductIds.has(c.input_product_id)) continue;
        const perUnit = c.qty / (portionBom.yield_qty || 1);
        const uom = (c.uom || 'g').toLowerCase();
        const perUnitKg = uom === 'kg' ? perUnit : uom === 'g' ? perUnit / 1000 : perUnit;
        const totalKg = perUnitKg * (line.planned_qty || 0);
        if (!wipNeeded[c.input_product_id]) {
          wipNeeded[c.input_product_id] = { name: c.input_product_name || productMap_gate[c.input_product_id]?.name || '?', sku: c.input_product_sku || '', requiredKg: 0 };
        }
        wipNeeded[c.input_product_id].requiredKg += totalKg;
      }
    }

    // Check 1: All linked cooking runs must be completed
    const incompleteCookRuns = linkedCookRuns.filter(cr => !['completed', 'cancelled'].includes(cr.status));
    if (incompleteCookRuns.length > 0) {
      setCookingGate({
        title: 'Cooking Runs Not Complete',
        description: 'The following cooking runs linked to this production run are not yet completed. Complete them before starting the production run.',
        itemLabel: 'Incomplete cooking runs',
        items: incompleteCookRuns.map(cr => ({
          name: `${cr.run_number} — ${cr.bulk_product_name}`,
          detail: `Target: ${cr.target_output_kg} kg · Status: ${cr.status?.replace('_', ' ')}`,
          badge: cr.status?.replace('_', ' '),
          badgeClass: cr.status === 'in_progress' ? 'bg-amber-100 text-amber-700' : cr.status === 'released' ? 'bg-blue-100 text-blue-700' : 'bg-muted text-muted-foreground',
        })),
      });
      setStarting(false);
      return;
    }

    // Check 2: Sufficient WIP batches available for each bulk product
    const wipAvail = {};
    wipBatches.filter(b => ['fresh', 'use_today'].includes(b.quality_status) && (b.qty_kg || 0) > 0)
      .forEach(b => { wipAvail[b.bulk_product_id] = (wipAvail[b.bulk_product_id] || 0) + b.qty_kg; });

    const wipShortages = [];
    for (const [pid, info] of Object.entries(wipNeeded)) {
      const available = wipAvail[pid] || 0;
      if (available < info.requiredKg * 0.9) { // 10% tolerance
        wipShortages.push({
          name: info.name,
          detail: `Need ${info.requiredKg.toFixed(1)} kg · Available ${available.toFixed(1)} kg · Short ${(info.requiredKg - available).toFixed(1)} kg`,
          badge: `${available.toFixed(1)} / ${info.requiredKg.toFixed(1)} kg`,
          badgeClass: 'bg-red-100 text-red-700',
        });
      }
    }

    if (wipShortages.length > 0) {
      setCookingGate({
        title: 'Insufficient Bulk Cooked Stock',
        description: 'Not enough cooked bulk (WIP) is available for this production run. Ensure cooking runs are completed and yielded sufficient output.',
        itemLabel: 'Bulk products short',
        items: wipShortages,
      });
      setStarting(false);
      return;
    }

    // ── Original stock guardrail (raw materials) ──
    // If pick list is already confirmed, ingredients have been physically picked
    // and stock already consumed — skip the stock guardrail entirely
    if (run?.pick_list_confirmed) {
      await doStartRun();
      return;
    }

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

    // Calculate total RAW ingredient needs — drill through Portion → Cook BOM
    // Any ingredient that has a Cook BOM is made during the run (WIP), so check its
    // raw inputs instead. This works regardless of product type.
    // Exclude packaging materials — they're at the machines and auto-deducted on run completion
    const ingredientNeeds = {};
    for (const line of lines) {
      const portionBom = boms.find(b => b.product_id === line.product_id && b.bom_type === 'portion');
      if (!portionBom) continue;
      const comps = compsByBom[portionBom.id] || [];
      for (const c of comps) {
        const inputProduct = productMap[c.input_product_id];
        if (!inputProduct || inputProduct.type === 'packaging') continue;

        const perUnit = c.qty / (portionBom.yield_qty || 1);
        const total = perUnit * line.planned_qty;

        // Check if this ingredient has a Cook BOM — if so, it's made during the run
        const cookBom = boms.find(b => b.product_id === c.input_product_id && b.bom_type === 'cook');
        if (cookBom) {
          // Drill into Cook BOM — check raw ingredients instead
          const cookComps = compsByBom[cookBom.id] || [];
          const cookYield = cookBom.yield_qty || 1;
          for (const cc of cookComps) {
            if (cc.is_consumable) continue;
            const rawProd = productMap[cc.input_product_id];
            if (!rawProd || rawProd.type === 'packaging') continue;
            const rawTotal = (cc.qty / cookYield) * total;
            if (!ingredientNeeds[cc.input_product_id]) ingredientNeeds[cc.input_product_id] = 0;
            ingredientNeeds[cc.input_product_id] += rawTotal;
          }
        } else {
          // No Cook BOM — check stock of this ingredient directly
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

    // §5.1.4/5 Generate tasks from BOM operations + equipment capacity splitting
    const [boms, bomOps, bomComponents, products, equipmentList, capacityRules] = await Promise.all([
      base44.entities.Bom.filter({ is_active: true }, '-created_date', 500),
      base44.entities.BomOperation.list('-created_date', 2000),
      base44.entities.BomComponent.list('-created_date', 2000),
      base44.entities.Product.filter({ status: 'active' }, 'name', 500),
      base44.entities.Equipment.filter({ status: 'active' }, 'name', 200),
      base44.entities.EquipmentCapacity.list('-created_date', 2000),
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

    // Aggregate total WIP qty needed per bulk product across ALL lines.
    // Key = WIP product_id, value = total kg/L needed (in WIP's stock_uom).
    // Walks every Portion BOM component that has a Cook BOM, then sums
    // (comp.qty ÷ portionBom.yield_qty) × line.planned_qty across lines.
    const wipQtyNeeded = {};
    for (const line of lines) {
      const portionBom = boms.find(b => b.product_id === line.product_id && b.bom_type === 'portion');
      if (!portionBom) continue;
      const portionComps = compsByBom[portionBom.id] || [];
      for (const comp of portionComps) {
        // Only WIP ingredients that have their own Cook BOM
        const hasCookBom = boms.some(b => b.product_id === comp.input_product_id && b.bom_type === 'cook');
        if (!hasCookBom) continue;
        const perUnit = comp.qty / (portionBom.yield_qty || 1);
        const totalForLine = perUnit * line.planned_qty;
        wipQtyNeeded[comp.input_product_id] = (wipQtyNeeded[comp.input_product_id] || 0) + totalForLine;
      }
    }

    console.log('[TaskGen] WIP qty needed:', JSON.stringify(wipQtyNeeded));

    // Collect unique WIP products from all lines' Portion BOMs to generate Cook tasks
    const wipTasksCreated = new Set();
    const baseTasks = [];

    for (const line of lines) {
      const portionBom = boms.find(b => b.product_id === line.product_id && b.bom_type === 'portion');
      if (!portionBom) continue;

      const portionComps = compsByBom[portionBom.id] || [];
      for (const comp of portionComps) {
        const inputProduct = productMap[comp.input_product_id];
        if (!inputProduct) continue;

        const cookBom = boms.find(b => b.product_id === inputProduct.id && b.bom_type === 'cook');
        if (!cookBom || wipTasksCreated.has(cookBom.id)) continue;
        wipTasksCreated.add(cookBom.id);

        // Total qty for this WIP across all lines (in the WIP's stock_uom).
        // Use the aggregated value — NEVER fall back to line.planned_qty (that's meal count, not kg).
        // Do NOT round here — rounding causes variance between pick list and cook task "Required".
        // The pick list sums raw ingredients from the unrounded WIP qty; if we round the task qty,
        // the ConsumeTab re-derives a different raw total. Full precision flows through instead.
        const totalWipQty = wipQtyNeeded[inputProduct.id] || 0;
        const wipUom = inputProduct.stock_uom || cookBom.yield_uom || 'kg';

        if (totalWipQty <= 0) {
          console.warn(`[TaskGen] Skipping ${inputProduct.sku}: wipQtyNeeded=0`);
          continue;
        }

        console.log(`[TaskGen] ${inputProduct.sku} (${inputProduct.name}): ${totalWipQty} ${wipUom}`);

        const cookOps = opsByBom[cookBom.id] || [];
        if (cookOps.length > 0) {
          for (const op of cookOps) {
            baseTasks.push({
              run_id: runId,
              line_id: line.id,
              product_id: inputProduct.id,
              product_sku: inputProduct.sku,
              meal_name: inputProduct.name,
              name: op.name,
              station: op.station,
              step_no: op.step_no,
              qty: totalWipQty,
              qty_uom: wipUom,
              status: 'pending',
              notes: op.notes || '',
              _equipment_id: op.equipment_id || null,
            });
          }
        } else {
          baseTasks.push({
            run_id: runId,
            line_id: line.id,
            product_id: inputProduct.id,
            product_sku: inputProduct.sku,
            meal_name: inputProduct.name,
            name: `Cook ${inputProduct.name}`,
            station: 'cook',
            step_no: 1,
            qty: totalWipQty,
            qty_uom: wipUom,
            status: 'pending',
            _equipment_id: null,
          });
        }
      }

      // Portion BOM operations
      const portionOps = opsByBom[portionBom.id] || [];
      if (portionOps.length > 0) {
        for (const op of portionOps) {
          baseTasks.push({
            run_id: runId,
            line_id: line.id,
            product_id: line.product_id,
            product_sku: line.product_sku,
            meal_name: line.product_name,
            name: op.name,
            station: op.station,
            step_no: op.step_no,
            qty: line.planned_qty,
            qty_uom: 'pcs',
            status: 'pending',
            notes: op.notes || '',
            _equipment_id: op.equipment_id || null,
          });
        }
      } else {
        baseTasks.push({
          run_id: runId,
          line_id: line.id,
          product_id: line.product_id,
          product_sku: line.product_sku,
          meal_name: line.product_name,
          name: `Portion ${line.product_name}`,
          station: 'portion',
          step_no: 1,
          qty: line.planned_qty,
          qty_uom: 'pcs',
          status: 'pending',
          _equipment_id: null,
        });
      }
    }

    // Split tasks by equipment capacity
    const finalTasks = splitTasksByEquipment(baseTasks, equipmentList, capacityRules);

    if (finalTasks.length > 0) {
      for (let i = 0; i < finalTasks.length; i += 25) {
        await base44.entities.ProductionTask.bulkCreate(finalTasks.slice(i, i + 25));
      }
    }

    const splitCount = finalTasks.length - baseTasks.length;
    queryClient.invalidateQueries({ queryKey: ['production-run', runId] });
    writeAuditLog({ action: 'update', entity_type: 'ProductionRun', entity_id: runId, description: `Started production run ${run?.run_number} — ${finalTasks.length} tasks created${splitCount > 0 ? ` (${splitCount} extra from equipment splits)` : ''}` });
    toast.success(`Run started — ${finalTasks.length} kitchen tasks created${splitCount > 0 ? ` (${splitCount} split by equipment capacity)` : ''}`);
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
        ref_number: run?.run_number || '',
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

    // 4. Clear Production floor SOH for this run's pick list
    if (existingPickList) {
      await clearProductionFloorForRun(existingPickList.id);
    }

    // 5. Archive all production tasks for this run
    const runTasks = await base44.entities.ProductionTask.filter({ run_id: runId }, 'step_no', 500);
    for (let i = 0; i < runTasks.length; i++) {
      await base44.entities.ProductionTask.update(runTasks[i].id, { archived: true });
    }

    // 6. Mark run as completed
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
          ref_number: run?.run_number || '',
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

  // ── Cancel Run ──
  const handleCancelRun = async (reason) => {
    const voidSummary = [];

    // 1. Archive all production tasks for this run
    const runTasks = await base44.entities.ProductionTask.filter({ run_id: runId }, 'step_no', 500);
    if (runTasks.length > 0) {
      for (const t of runTasks) await base44.entities.ProductionTask.update(t.id, { archived: true });
      voidSummary.push(`${runTasks.length} tasks archived`);
    }

    // 2. Cancel linked cooking runs (production_run_id or contributing_run_ids containing this run)
    const allCookingRuns = await base44.entities.CookingRun.list('-created_date', 500);
    const linkedCookingRuns = allCookingRuns.filter(cr => {
      if (cr.status === 'cancelled' || cr.status === 'completed') return false;
      if (cr.production_run_id === runId) return true;
      if (cr.contributing_run_ids) {
        try {
          const ids = JSON.parse(cr.contributing_run_ids);
          return Array.isArray(ids) && ids.includes(runId);
        } catch { return false; }
      }
      return false;
    });
    for (const cr of linkedCookingRuns) {
      await base44.entities.CookingRun.update(cr.id, {
        status: 'cancelled',
        notes: `${cr.notes ? cr.notes + '\n' : ''}Auto-cancelled: production run ${run?.run_number} was voided`,
      });
    }
    if (linkedCookingRuns.length > 0) {
      voidSummary.push(`${linkedCookingRuns.length} cooking run(s) cancelled`);
    }

    // 3. Reverse pick list stock if it was confirmed (return released ingredients to SOH)
    if (run?.pick_list_confirmed) {
      // Find movements from both the new system (production_pick via PickList) and legacy (production_consume via ProductionRun)
      const [pickMvNew, pickMvLegacy] = await Promise.all([
        existingPickList ? base44.entities.StockMovement.filter({ ref_id: existingPickList.id, reason: 'production_pick' }, '-created_date', 500) : [],
        base44.entities.StockMovement.filter({ ref_id: runId, reason: 'production_consume' }, '-created_date', 500),
      ]);
      const pickMovements = [...pickMvNew, ...pickMvLegacy];

      if (pickMovements.length > 0) {
        const sohRecords = await base44.entities.StockOnHand.list('-updated_date', 2000);
        const sohByProduct = {};
        sohRecords.forEach(s => {
          if (!sohByProduct[s.product_id]) sohByProduct[s.product_id] = [];
          sohByProduct[s.product_id].push(s);
        });

        for (const mv of pickMovements) {
          await base44.entities.StockMovement.create({
            product_id: mv.product_id,
            product_sku: mv.product_sku,
            product_name: mv.product_name,
            qty: mv.qty,
            uom: mv.uom,
            reason: 'production_return',
            ref_type: mv.ref_type || 'production_run',
            ref_id: mv.ref_id,
            ref_number: run?.run_number || '',
            notes: `Reversal: run ${run?.run_number} cancelled — returning ${mv.qty} ${mv.uom} of ${mv.product_sku}`,
          });

          const productSoh = sohByProduct[mv.product_id];
          if (productSoh && productSoh.length > 0) {
            const soh = productSoh[0];
            const newOnHand = (soh.qty_on_hand || 0) + (mv.qty || 0);
            await base44.entities.StockOnHand.update(soh.id, {
              qty_on_hand: newOnHand,
              qty_available: newOnHand - (soh.qty_committed || 0),
              last_updated_at: new Date().toISOString(),
            });
          }
        }
        voidSummary.push(`${pickMovements.length} pick list items returned to stock`);
      }
    }

    // 4. Clear Production floor SOH
    if (existingPickList) {
      await clearProductionFloorForRun(existingPickList.id);
      voidSummary.push('Production floor stock cleared');
    }

    // 5. Delete TaskConsumption records for this run
    const consumptions = await base44.entities.TaskConsumption.filter({ run_id: runId }, '-created_date', 500);
    if (consumptions.length > 0) {
      for (const tc of consumptions) await base44.entities.TaskConsumption.delete(tc.id);
      voidSummary.push(`${consumptions.length} task consumption records removed`);
    }

    // 6. Mark production run as cancelled and reset picking flags
    await base44.entities.ProductionRun.update(runId, {
      status: 'cancelled',
      pick_list_confirmed: false,
      notes: `${run?.notes ? run.notes + '\n' : ''}CANCELLED: ${reason}${voidSummary.length > 0 ? '\nVoided: ' + voidSummary.join(', ') : ''}`,
    });

    writeAuditLog({
      action: 'cancel', entity_type: 'ProductionRun', entity_id: runId,
      description: `Cancelled run ${run?.run_number} — ${reason}. ${voidSummary.join('; ')}`,
    });

    queryClient.invalidateQueries({ queryKey: ['production-run', runId] });
    queryClient.invalidateQueries({ queryKey: ['production-runs'] });
    queryClient.invalidateQueries({ queryKey: ['cooking-runs'] });
    queryClient.invalidateQueries({ queryKey: ['wip-cooking-runs'] });
    queryClient.invalidateQueries({ queryKey: ['stock-on-hand'] });
    toast.success(`Run ${run?.run_number} cancelled — ${voidSummary.length > 0 ? voidSummary.join(', ') : 'no linked data to void'}`);
  };

  // ── Revert to Draft ──
  const handleRevertToDraft = async (reason) => {
    await base44.entities.ProductionRun.update(runId, {
      status: 'draft',
      notes: `${run?.notes ? run.notes + '\n' : ''}REVERTED TO DRAFT: ${reason || 'Plan change'}`,
    });
    writeAuditLog({
      action: 'update', entity_type: 'ProductionRun', entity_id: runId,
      description: `Reverted run ${run?.run_number} to draft — ${reason || 'Plan change'}`,
    });
    queryClient.invalidateQueries({ queryKey: ['production-run', runId] });
    queryClient.invalidateQueries({ queryKey: ['production-runs'] });
    toast.success(`Run ${run?.run_number} reverted to draft — you can now edit and re-schedule`);
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

  const isDraft = run.status === 'draft';
  const isScheduled = run.status === 'scheduled';
  const isInProgress = run.status === 'in_progress';
  const isEditable = isScheduled || isInProgress || isDraft;
  const canComplete = isInProgress;
  const canStart = isScheduled;
  const canCancel = isScheduled || isInProgress;
  const canRevertToDraft = isScheduled;
  const filledCount = lines.filter(l => actuals[l.id] !== undefined && actuals[l.id] !== '').length;

  // Recalculate handler — updates existing lines AND creates new ones
  const handleRecalcConfirm = async (diff) => {
    let updated = 0;
    let added = 0;

    for (const d of diff) {
      if (d.isNew && d.newRecommended > 0) {
        // Create new line
        await base44.entities.ProductionRunLine.create({
          run_id: runId,
          product_id: d.product_id,
          product_name: d.product_name,
          product_sku: d.product_sku,
          planned_qty: d.newRecommended,
          soh_at_plan: d.soh,
          committed_at_plan: d.committed,
          par_at_plan: d.par,
          status: 'pending',
        });
        added++;
      } else if (!d.isNew && d.change !== 0) {
        if (d.newRecommended === 0) {
          await base44.entities.ProductionRunLine.delete(d.id);
        } else {
          await base44.entities.ProductionRunLine.update(d.id, {
            planned_qty: d.newRecommended,
            soh_at_plan: d.soh,
            committed_at_plan: d.committed,
            par_at_plan: d.par,
          });
        }
        updated++;
      }
    }

    // Update run totals
    const remaining = diff.filter(d => d.newRecommended > 0);
    const newTotal = remaining.reduce((s, d) => s + d.newRecommended, 0);
    await base44.entities.ProductionRun.update(runId, {
      total_lines: remaining.length,
      total_units: newTotal,
    });
    writeAuditLog({
      action: 'update', entity_type: 'ProductionRun', entity_id: runId,
      description: `Recalculated run ${run?.run_number} — ${updated} updated, ${added} added, new total ${newTotal} units`,
    });
    queryClient.invalidateQueries({ queryKey: ['production-run', runId] });
    queryClient.invalidateQueries({ queryKey: ['production-run-lines', runId] });
    queryClient.invalidateQueries({ queryKey: ['production-runs'] });
    setShowRecalculate(false);
    toast.success(`Run recalculated — ${updated} updated, ${added} new, ${newTotal.toLocaleString()} total meals`);
  };

  // Handle inline planned qty editing
  const handlePlannedQtyChange = (lineId, value) => {
    setPlannedEdits(prev => ({ ...prev, [lineId]: value }));
  };

  // Save all planned qty changes at once
  const handleSavePlannedChanges = async () => {
    const edits = Object.entries(plannedEdits);
    if (edits.length === 0) {
      toast.info('No changes to save');
      return;
    }
    setSavingPlanned(true);
    for (const [lineId, value] of edits) {
      const qty = Number(value);
      if (qty >= 0) {
        await base44.entities.ProductionRunLine.update(lineId, { planned_qty: qty });
      }
    }
    // Recalculate run totals
    const updatedLines = lines.map(l => {
      const editedQty = plannedEdits[l.id];
      return editedQty !== undefined ? { ...l, planned_qty: Number(editedQty) } : l;
    });
    const newTotal = updatedLines.reduce((s, l) => s + l.planned_qty, 0);
    await base44.entities.ProductionRun.update(runId, {
      total_units: newTotal,
      total_lines: updatedLines.filter(l => l.planned_qty > 0).length,
    });
    queryClient.invalidateQueries({ queryKey: ['production-run', runId] });
    queryClient.invalidateQueries({ queryKey: ['production-run-lines', runId] });
    queryClient.invalidateQueries({ queryKey: ['production-runs'] });
    setPlannedEdits({});
    setSavingPlanned(false);
    toast.success(`Saved changes — ${edits.length} line${edits.length > 1 ? 's' : ''} updated`);
  };

  // Generate persisted pick list (§10 Step 1)
  const handleGeneratePickList = async () => {
    if (existingPickList) {
      toast.info('Pick list already exists — opening it');
      return;
    }
    setGeneratingPickList(true);
    try {
      const { pickList, pickLines } = await generatePickList(runId, run);
      writeAuditLog({
        action: 'create', entity_type: 'PickList', entity_id: pickList.id,
        description: `Generated pick list for run ${run?.run_number} — ${pickLines.length} ingredients`,
      });
      queryClient.invalidateQueries({ queryKey: ['pick-list-for-run', runId] });
      toast.success(`Pick list generated — ${pickLines.length} ingredients`);
    } catch (err) {
      toast.error(err.message || 'Failed to generate pick list');
    }
    setGeneratingPickList(false);
  };

  // Delete a line from the run
  const handleDeleteLine = async (lineId) => {
    await base44.entities.ProductionRunLine.delete(lineId);
    const remaining = lines.filter(l => l.id !== lineId);
    const newTotal = remaining.reduce((s, l) => s + l.planned_qty, 0);
    await base44.entities.ProductionRun.update(runId, {
      total_lines: remaining.length,
      total_units: newTotal,
    });
    queryClient.invalidateQueries({ queryKey: ['production-run', runId] });
    queryClient.invalidateQueries({ queryKey: ['production-run-lines', runId] });
    queryClient.invalidateQueries({ queryKey: ['production-runs'] });
    toast.success('Line removed from run');
  };

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
            <span className="text-sm text-muted-foreground">{run.run_date ? formatDateSAST(run.run_date) : '—'}</span>
            <span className="text-sm text-muted-foreground">·</span>
            <span className="text-sm text-muted-foreground">{lines.length} meals · {run.total_units} planned units</span>
            {run.started_at && (
              <>
                <span className="text-sm text-muted-foreground">·</span>
                <Badge variant="outline" className="text-xs font-mono gap-1">
                  Started {formatTimeSAST(run.started_at)}
                </Badge>
              </>
            )}
            {run.completed_at && (
              <>
                <Badge variant="outline" className="text-xs font-mono gap-1 bg-green-50 text-green-700 border-green-200">
                  Finished {formatTimeSAST(run.completed_at)}
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
          {canRevertToDraft && perms.runs_create && (
            <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setShowRevertDialog(true)}>
              <RotateCcw className="w-4 h-4" /> Revert to Draft
            </Button>
          )}
          {canCancel && perms.runs_start_complete && (
            <Button variant="outline" size="sm" className="gap-1.5 text-destructive border-destructive/30 hover:bg-destructive/10" onClick={() => setShowCancelDialog(true)}>
              <XCircle className="w-4 h-4" /> Cancel Run
            </Button>
          )}
          {(isScheduled || isInProgress || run.status === 'completed') && perms.pick_lists && (
            existingPickList ? (
              <Link to={`/production/run/${runId}/pick-list`}>
                <Button variant="outline" size="sm" className="gap-1.5">
                  <ClipboardList className="w-4 h-4" /> Pick List
                  {existingPickList.status === 'open' && (
                    <Badge variant="secondary" className="ml-1 text-[10px]">{existingPickList.released_lines}/{existingPickList.total_lines}</Badge>
                  )}
                  {existingPickList.status === 'completed' && (
                    <Badge className="ml-1 text-[10px] bg-green-100 text-green-700">Done</Badge>
                  )}
                </Button>
              </Link>
            ) : (
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5"
                onClick={handleGeneratePickList}
                disabled={generatingPickList || isDraft}
              >
                <ClipboardList className="w-4 h-4" />
                {generatingPickList ? 'Generating...' : 'Generate Pick List'}
              </Button>
            )
          )}
          {(isScheduled || isInProgress || run.status === 'completed') && !perms.pick_lists && (
            <Link to={`/production/run/${runId}/pick-list`}>
              <Button variant="outline" size="sm" className="gap-1.5">
                <ClipboardList className="w-4 h-4" /> Pick List
              </Button>
            </Link>
          )}
          {(run.status === 'in_progress') && (
            <Link to={`/floor/tasks?runId=${runId}`}>
              <Button variant="outline" size="sm" className="gap-1.5">
                <LayoutGrid className="w-4 h-4" /> Kitchen Board
              </Button>
            </Link>
          )}
          {(isScheduled || isDraft) && perms.runs_start_complete && (
            <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setShowRecalculate(true)}>
              <RefreshCw className="w-4 h-4" /> Recalculate
            </Button>
          )}
          {isDraft && perms.runs_start_complete && (
            <Button
              onClick={async () => {
                await base44.entities.ProductionRun.update(runId, { status: 'scheduled' });
                writeAuditLog({ action: 'update', entity_type: 'ProductionRun', entity_id: runId, description: `Scheduled run ${run?.run_number}` });
                queryClient.invalidateQueries({ queryKey: ['production-run', runId] });
                queryClient.invalidateQueries({ queryKey: ['production-runs'] });
                toast.success(`Run ${run?.run_number} scheduled`);
              }}
              className="gap-2 bg-blue-600 hover:bg-blue-700"
            >
              <Play className="w-4 h-4" /> Schedule Run
            </Button>
          )}
          {canStart && perms.runs_start_complete && (
            <Button onClick={handleStartRun} disabled={starting} className="gap-2 bg-amber-600 hover:bg-amber-700">
              <Play className="w-4 h-4" />
              {starting ? 'Checking stock...' : 'Start Run'}
            </Button>
          )}
          {isInProgress && perms.runs_start_complete && (
            <Button variant="outline" onClick={handleFillPlanned} size="sm">
              Fill Planned
            </Button>
          )}
          {canComplete && perms.runs_start_complete && (
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

      {run.status === 'cancelled' && (
        <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700 flex items-center gap-2">
          <XCircle className="w-4 h-4 shrink-0" />
          This run has been cancelled. No stock movements were recorded.
        </div>
      )}

      {isDraft && (
        <div className="bg-muted border border-border rounded-lg px-4 py-3 text-sm text-muted-foreground flex items-center gap-2">
          <RotateCcw className="w-4 h-4 shrink-0" />
          This run is in draft. Edit meal lines and quantities, then schedule it when ready.
        </div>
      )}

      {/* Lines table */}
      <RunLineTable
        lines={lines.map(l => ({ ...l, _editedQty: plannedEdits[l.id] }))}
        actuals={actuals}
        reasons={reasons}
        onActualChange={handleActualChange}
        onReasonChange={handleReasonChange}
        isEditable={isEditable}
        isScheduled={isScheduled}
        isDraft={isDraft}
        onPlannedQtyChange={(isScheduled || isDraft) ? handlePlannedQtyChange : undefined}
        onSavePlannedChanges={(isScheduled || isDraft) && Object.keys(plannedEdits).length > 0 ? handleSavePlannedChanges : undefined}
        onDeleteLine={handleDeleteLine}
        savingPlanned={savingPlanned}
      />

      {/* Cooking Gate Modal — blocks until cooking runs complete + WIP sufficient */}
      {cookingGate && (
        <CookingGateModal
          title={cookingGate.title}
          description={cookingGate.description}
          items={cookingGate.items}
          itemLabel={cookingGate.itemLabel}
          onClose={() => { setCookingGate(null); setStarting(false); }}
        />
      )}

      {/* §5.1.8 Stock Guardrail Modal — hard block, no override */}
      {showGuardrail && (
        <StockGuardrailModal
          shortages={shortages}
          onCancel={() => { setShowGuardrail(false); setStarting(false); }}
          onOverride={() => { setShowGuardrail(false); doStartRun(); }}
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

      {/* Recalculate Modal */}
      {showRecalculate && (
        <RecalculateRunModal
          runId={runId}
          existingLines={lines}
          onConfirm={handleRecalcConfirm}
          onCancel={() => setShowRecalculate(false)}
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

      {/* Cancel / Revert Dialogs */}
      <RunActionDialog
        open={showCancelDialog}
        onOpenChange={setShowCancelDialog}
        action="cancel"
        runNumber={run?.run_number}
        onConfirm={handleCancelRun}
      />
      <RunActionDialog
        open={showRevertDialog}
        onOpenChange={setShowRevertDialog}
        action="revert_draft"
        runNumber={run?.run_number}
        onConfirm={handleRevertToDraft}
      />
    </div>
  );
}