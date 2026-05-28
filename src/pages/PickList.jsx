import React, { useMemo, useState, useEffect, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44, adjustStockOnHand } from '@/api/base44Client';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { ScanBarcode, Check, Send, Loader2, AlertTriangle } from 'lucide-react';
import PickListHeader from '@/components/pick-list/PickListHeader';
import PickListCategory from '@/components/pick-list/PickListCategory';
import { generatePickListPdf } from '@/components/pick-list/PickListPdfExport';
import PickListPrintView from '@/components/pick-list/PickListPrintView';
import PickListEditModal from '@/components/pick-list/PickListEditModal';
import LiveTimer from '@/components/kitchen/LiveTimer';
import { writeAuditLog } from '@/lib/auditLog';
import { generatePickList } from '@/lib/pickListGenerator';
import { addToProductionFloor, removeFromProductionFloor } from '@/lib/productionFloorStock.js';
import { depleteStock } from '@/lib/fifoDepletion';

const CATEGORY_ORDER = [
  'Meats', 'Vegetables', 'Starches', 'Spices & Seasoning',
  'Sauces & Condiments', 'Dairy & Eggs', 'Oils & Fats',
  'Dry Goods', 'Packaging', 'Other', 'Uncategorized',
];

/**
 * §10 Persisted Pick List — reads from PickList + PickLine entities.
 * Flow: Generate → Start Picking → Pick items → Release to production (creates stock movements).
 */
export default function PickList() {
  const runId = window.location.pathname.split('/').filter(Boolean).find((_, i, arr) => arr[i - 1] === 'run');
  const queryClient = useQueryClient();

  // ── Core data ──
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

  // ── Persisted pick list ──
  const { data: pickLists = [], isLoading: loadingPickList } = useQuery({
    queryKey: ['pick-list-for-run', runId],
    queryFn: () => base44.entities.PickList.filter({ production_run_id: runId }, '-created_date', 1),
    enabled: !!runId,
  });
  const pickList = pickLists[0] || null;

  const { data: pickLines = [], isLoading: loadingPickLines } = useQuery({
    queryKey: ['pick-lines', pickList?.id],
    queryFn: () => base44.entities.PickLine.filter({ pick_list_id: pickList.id }, 'product_name', 500),
    enabled: !!pickList?.id,
  });

  const { data: stockRecords = [] } = useQuery({
    queryKey: ['stock-on-hand'],
    queryFn: () => base44.entities.StockOnHand.list('-updated_date', 1000),
  });

  // ── Derived data ──
  const stockMap = useMemo(() => {
    const map = {};
    stockRecords.forEach(s => {
      if (!map[s.product_id]) map[s.product_id] = 0;
      map[s.product_id] += s.qty_on_hand || 0;
    });
    return map;
  }, [stockRecords]);

  const { categories, itemsByCategory } = useMemo(() => {
    const catSet = new Set();
    const byCategory = {};
    pickLines.forEach(pl => {
      const cat = pl.category_group || 'Uncategorized';
      catSet.add(cat);
      if (!byCategory[cat]) byCategory[cat] = [];
      byCategory[cat].push(pl);
    });
    // Sort each category's items by name
    Object.values(byCategory).forEach(arr => arr.sort((a, b) => (a.product_name || '').localeCompare(b.product_name || '')));
    const cats = [...catSet].sort((a, b) => CATEGORY_ORDER.indexOf(a) - CATEGORY_ORDER.indexOf(b));
    return { categories: cats, itemsByCategory: byCategory };
  }, [pickLines]);

  // ── Local state ──
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState(null);
  const [releasing, setReleasing] = useState(false);
  const [editingLine, setEditingLine] = useState(null);
  const [scanInput, setScanInput] = useState('');
  const [lastScanned, setLastScanned] = useState(null);
  const scanInputRef = useRef(null);
  const bufferRef = useRef('');
  const timerRef = useRef(null);

  // ── Counts ──
  const totalLines = pickLines.length;
  const pickedCount = pickLines.filter(pl => pl.status === 'picked' || pl.status === 'released').length;
  const releasedCount = pickLines.filter(pl => pl.status === 'released').length;
  const allPicked = totalLines > 0 && pickedCount === totalLines;
  const allReleased = totalLines > 0 && releasedCount === totalLines;

  const isPicking = !!run?.picking_started_at && !allReleased;
  const isCompleted = pickList?.status === 'completed' || allReleased;

  // ── Delete empty pick list then regenerate ──
  const handleDeleteAndRegenerate = async () => {
    setGenerating(true);
    setGenerateError(null);
    try {
      if (pickList?.id) {
        await base44.entities.PickList.delete(pickList.id);
        queryClient.setQueryData(['pick-list-for-run', runId], []);
      }
      const { pickList: pl, pickLines: pls } = await generatePickList(runId, run);
      writeAuditLog({
        action: 'create', entity_type: 'PickList', entity_id: pl.id,
        description: `Regenerated pick list for run ${run?.run_number} — ${pls.length} ingredients`,
      });
      queryClient.invalidateQueries({ queryKey: ['pick-list-for-run', runId] });
      toast.success(`Pick list generated — ${pls.length} ingredients`);
    } catch (err) {
      console.error('[PickList] generate failed:', err);
      const msg = err?.message || String(err) || 'Failed to generate pick list';
      setGenerateError(msg);
      toast.error(msg);
    } finally {
      setGenerating(false);
    }
  };

  // ── Generate pick list ──
  const handleGenerate = async () => {
    setGenerating(true);
    setGenerateError(null);
    try {
      const { pickList: pl, pickLines: pls } = await generatePickList(runId, run);
      writeAuditLog({
        action: 'create', entity_type: 'PickList', entity_id: pl.id,
        description: `Generated pick list for run ${run?.run_number} — ${pls.length} ingredients`,
      });
      queryClient.invalidateQueries({ queryKey: ['pick-list-for-run', runId] });
      toast.success(`Pick list generated — ${pls.length} ingredients`);
    } catch (err) {
      console.error('[PickList] generate failed:', err);
      const msg = err?.message || String(err) || 'Failed to generate pick list';
      setGenerateError(msg);
      toast.error(msg);
    } finally {
      setGenerating(false);
    }
  };

  // ── Start picking ──
  const handleStartPicking = async () => {
    await base44.entities.ProductionRun.update(runId, { picking_started_at: new Date().toISOString() });
    queryClient.invalidateQueries({ queryKey: ['production-run', runId] });
    toast.success('Picking timer started');
  };

  // ── Optimistic cache helper ──
  const optimisticUpdateLine = (pickLineId, patch) => {
    queryClient.setQueryData(['pick-lines', pickList?.id], (old) => {
      if (!old) return old;
      return old.map(pl => pl.id === pickLineId ? { ...pl, ...patch } : pl);
    });
  };

  // ── Mark a line as picked (with qty) — optimistic ⚡️
  const handleMarkPicked = async (pickLineId, actualQty) => {
    const patch = { status: 'picked', actual_qty_picked: Number(actualQty), picked_at: new Date().toISOString() };
    const prevData = queryClient.getQueryData(['pick-lines', pickList?.id]);
    optimisticUpdateLine(pickLineId, patch);
    try {
      await base44.entities.PickLine.update(pickLineId, patch);
    } catch (err) {
      toast.error('Failed to save picked status');
      queryClient.setQueryData(['pick-lines', pickList?.id], prevData);
    }
  };

  // ⚡️ Unpick a line — optimistic ⚡️
  const handleUnpick = async (pickLineId) => {
    const patch = { status: 'not_picked', actual_qty_picked: 0, picked_at: null };
    const prevData = queryClient.getQueryData(['pick-lines', pickList?.id]);
    optimisticUpdateLine(pickLineId, patch);
    try {
      await base44.entities.PickLine.update(pickLineId, patch);
    } catch (err) {
      toast.error('Failed to save unpick status');
      queryClient.setQueryData(['pick-lines', pickList?.id], prevData);
    }
  };

  // ⚡️ Mark ALL unpicked lines at once — optimistic batch ⚡️
  const handleMarkAll = async (linesToMark) => {
    const now = new Date().toISOString();
    // Build a lookup for qty overrides
    const qtyMap = {};
    linesToMark.forEach(({ id, qty }) => { qtyMap[id] = Number(qty); });

    const prevData = queryClient.getQueryData(['pick-lines', pickList?.id]);

    // Optimistic: update cache instantly for all lines at once
    queryClient.setQueryData(['pick-lines', pickList?.id], (old) => {
      if (!old) return old;
      return old.map(pl => qtyMap[pl.id] !== undefined
        ? { ...pl, status: 'picked', actual_qty_picked: qtyMap[pl.id], picked_at: now }
        : pl
      );
    });

    try {
      // Execute all DB writes in parallel
      await Promise.all(
        linesToMark.map(({ id }) =>
          base44.entities.PickLine.update(id, {
            status: 'picked',
            actual_qty_picked: qtyMap[id],
            picked_at: now
          })
        )
      );
      toast.success(`Picked ${linesToMark.length} items`);
    } catch (err) {
      toast.error('Failed to bulk pick items');
      queryClient.setQueryData(['pick-lines', pickList?.id], prevData);
    }
  };

  // ── Release all picked lines → production_pick stock movements ──
  const handleReleaseAll = async () => {
    const pickedLines = pickLines.filter(pl => pl.status === 'picked');
    if (pickedLines.length === 0) {
      toast.error('No picked items to release');
      return;
    }

    setReleasing(true);

    // Re-fetch pick lines fresh from DB to avoid stale cache (race condition:
    // user picks last item and immediately releases — cache may not have the
    // latest actual_qty_picked yet).
    const freshPickLines = await base44.entities.PickLine.filter({ pick_list_id: pickList.id }, 'product_name', 500);
    const freshById = {};
    freshPickLines.forEach(fpl => { freshById[fpl.id] = fpl; });

    const releaseBatch = new Date().toISOString();

    // Pre-load products for FIFO costing method check
    const uniqueProductIds = [...new Set(pickedLines.filter(pl => !pl.is_consumable).map(pl => pl.product_id))];
    const productList = uniqueProductIds.length > 0
      ? await base44.entities.Product.filter({ id: { $in: uniqueProductIds } })
      : [];
    const productById = Object.fromEntries(productList.map(p => [p.id, p]));

    for (const pl of pickedLines) {
      // Use fresh DB data for the qty — never stale cache
      const freshLine = freshById[pl.id] || pl;
      const qty = freshLine.actual_qty_picked || freshLine.required_qty;
      if (qty <= 0) continue;

      // Skip consumables — no stock movement
      if (pl.is_consumable) {
        await base44.entities.PickLine.update(pl.id, {
          status: 'released',
          released_at: releaseBatch,
          release_batch: releaseBatch,
        });
        continue;
      }

      // Resolve per-unit cost for this pick — needed for COGS reporting
      const product = productById[pl.product_id];
      let unitCostAtMovement = product?.cost_avg || 0;
      if (product?.costing_method === 'fifo') {
        // Deplete FIFO layers first (only touches CostLayer, not SOH — safe to reorder)
        const { blendedCost } = await depleteStock(pl.product_id, qty);
        unitCostAtMovement = blendedCost;
      }

      // Create production_pick stock movement (storage → production)
      await base44.entities.StockMovement.create({
        product_id: pl.product_id,
        product_sku: pl.product_sku,
        product_name: pl.product_name,
        from_location_id: pl.from_location_id || null,
        qty,
        uom: pl.required_uom,
        reason: 'production_pick',
        ref_type: 'pick_list',
        ref_id: pickList.id,
        ref_number: run?.run_number || '',
        unit_cost_at_movement: unitCostAtMovement,
        notes: `Released ${qty} ${pl.required_uom} of ${pl.product_sku} to production`,
      });

      // Atomically deduct from StockOnHand (uses primary location if set, else null)
      await adjustStockOnHand(pl.product_id, pl.from_location_id || null, -qty);

      // Add to Production floor SOH
      await addToProductionFloor(pl.product_id, pl.product_sku, pl.product_name, qty, pl.required_uom);

      // Mark line as released
      await base44.entities.PickLine.update(pl.id, {
        status: 'released',
        released_at: releaseBatch,
        release_batch: releaseBatch,
      });
    }

    // Check if all lines are now released
    const updatedPickLines = await base44.entities.PickLine.filter({ pick_list_id: pickList.id }, 'product_name', 500);
    const newReleasedCount = updatedPickLines.filter(pl => pl.status === 'released').length;

    // Update PickList counters
    const updates = { released_lines: newReleasedCount };
    if (newReleasedCount >= updatedPickLines.length) {
      updates.status = 'completed';
      updates.completed_at = new Date().toISOString();
      // Also mark run as pick-confirmed and stop timer
      await base44.entities.ProductionRun.update(runId, {
        pick_list_confirmed: true,
        picking_finished_at: new Date().toISOString(),
      });
    }
    await base44.entities.PickList.update(pickList.id, updates);

    writeAuditLog({
      action: 'update', entity_type: 'PickList', entity_id: pickList.id,
      description: `Released ${pickedLines.length} lines to production for run ${run?.run_number}`,
    });

    queryClient.invalidateQueries({ queryKey: ['pick-lines', pickList?.id] });
    queryClient.invalidateQueries({ queryKey: ['pick-list-for-run', runId] });
    queryClient.invalidateQueries({ queryKey: ['production-run', runId] });
    queryClient.invalidateQueries({ queryKey: ['stock-on-hand'] });
    toast.success(`${pickedLines.length} items released to production — stock deducted`);
    setReleasing(false);
  };

  // ── Edit a released line (post-release adjustment) ──
  const handleEditSave = async ({ pickLineId, productId, productName, productSku, oldQty, newQty, reason, notes, uom }) => {
    const diff = newQty - oldQty;
    if (diff !== 0) {
      // Adjustment stock movement
      await base44.entities.StockMovement.create({
        product_id: productId,
        product_sku: productSku,
        product_name: productName,
        qty: Math.abs(diff),
        uom,
        reason: diff > 0 ? 'production_pick' : 'production_return',
        ref_type: 'pick_list',
        ref_id: pickList?.id || '',
        ref_number: run?.run_number || '',
        notes: `Pick edit: ${reason}${notes ? ' — ' + notes : ''} (${oldQty} → ${newQty} ${uom})`,
      });

      // Atomically adjust SOH (diff>0 = more consumed, diff<0 = return to stock)
      // Use the pick line's from_location; fall back to null for any-location adjustment
      const editLine = pickLines.find(l => l.id === pickLineId);
      await adjustStockOnHand(productId, editLine?.from_location_id || null, -diff);

      // Update Production floor SOH
      if (diff > 0) {
        await addToProductionFloor(productId, productSku, productName, Math.abs(diff), uom);
      } else {
        await removeFromProductionFloor(productId, Math.abs(diff));
      }

      // Update PickLine qty
      await base44.entities.PickLine.update(pickLineId, { actual_qty_picked: newQty });
    }

    queryClient.invalidateQueries({ queryKey: ['pick-lines', pickList?.id] });
    queryClient.invalidateQueries({ queryKey: ['stock-on-hand'] });
    toast.success(`Updated ${productName}: ${oldQty} → ${newQty} ${uom}`);
    setEditingLine(null);
  };

  // ── PDF export ──
  const handleExportPdf = () => {
    if (!run || pickLines.length === 0) return;
    // Transform pickLines to the shape the PDF exporter expects
    const pickItems = pickLines.map(pl => ({
      product: { id: pl.product_id, sku: pl.product_sku, name: pl.product_name, barcode: '' },
      totalQty: pl.required_qty,
      uom: pl.required_uom,
      pickCategory: pl.category_group || 'Uncategorized',
    }));
    const pickedState = {};
    pickLines.forEach(pl => {
      pickedState[pl.product_id] = {
        picked: pl.status !== 'not_picked',
        qty: String(pl.actual_qty_picked || 0),
      };
    });
    generatePickListPdf({ run, lines, pickItems, categories, pickedState });
    toast.success('PDF downloaded');
  };

  // ── Barcode scanner ──
  const lookupMap = useMemo(() => {
    const map = {};
    pickLines.forEach(pl => {
      if (pl.product_sku) map[pl.product_sku.toLowerCase()] = pl;
    });
    return map;
  }, [pickLines]);

  const processCode = (code) => {
    const trimmed = code.trim().toLowerCase();
    if (!trimmed) return;
    const found = lookupMap[trimmed];
    if (found) {
      setLastScanned(found);
      if (found.status === 'not_picked') {
        // Auto-fill required qty and mark as picked
        handleMarkPicked(found.id, found.required_qty);
        toast.success(`Scanned: ${found.product_name} — auto-picked ${found.required_qty} ${found.required_uom}`);
      } else {
        toast.info(`${found.product_name} already ${found.status}`);
      }
    } else {
      setLastScanned(null);
      toast.error(`No match for "${code.trim()}" on this pick list`);
    }
  };

  // Hardware scanner listener
  useEffect(() => {
    if (!isPicking) return;
    const handleKeyDown = (e) => {
      if (document.activeElement && document.activeElement !== scanInputRef.current &&
          (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA')) {
        return;
      }
      if (e.key === 'Enter') {
        if (bufferRef.current.length > 3) processCode(bufferRef.current);
        bufferRef.current = '';
        return;
      }
      if (e.key.length === 1) {
        bufferRef.current += e.key;
        clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => { bufferRef.current = ''; }, 100);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [lookupMap, isPicking]);

  const handleScanSubmit = (e) => {
    e.preventDefault();
    processCode(scanInput);
    setScanInput('');
  };

  // ── Loading states ──
  if (!run) {
    return <div className="text-center py-12 text-sm text-muted-foreground">Loading...</div>;
  }

  // ── No pick list yet — show generate prompt ──
  if (!pickList && !loadingPickList) {
    return (
      <div className="space-y-4">
        <PickListHeader
          runId={runId} runNumber={run.run_number} lineCount={lines.length}
          itemCount={0} pickedCount={0} releasedCount={0}
          onPrint={() => {}} onExportPdf={() => {}}
        />
        <div className="bg-card border border-border rounded-xl px-6 py-12 text-center space-y-4">
          <p className="text-sm text-muted-foreground">No pick list generated yet for this run.</p>
          {generateError && (
            <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-left max-w-lg mx-auto">
              <AlertTriangle className="w-4 h-4 text-red-600 mt-0.5 shrink-0" />
              <div>
                <p className="text-sm font-semibold text-red-800">Generation failed</p>
                <p className="text-xs text-red-700 mt-0.5">{generateError}</p>
              </div>
            </div>
          )}
          <Button onClick={handleGenerate} disabled={generating} className="gap-2">
            {generating ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
            {generating ? 'Generating...' : 'Generate Pick List'}
          </Button>
        </div>
      </div>
    );
  }

  if (loadingPickLines) {
    return <div className="text-center py-12 text-sm text-muted-foreground">Loading pick lines...</div>;
  }

  const pickedButNotReleased = pickLines.filter(pl => pl.status === 'picked').length;

  return (
    <div className="space-y-4 print:space-y-2">
      <PickListHeader
        runId={runId} runNumber={run.run_number} lineCount={lines.length}
        itemCount={totalLines} pickedCount={pickedCount} releasedCount={releasedCount}
        onPrint={() => window.print()} onExportPdf={handleExportPdf}
      />

      {/* Print view */}
      <PickListPrintView run={run} lines={lines} pickLines={pickLines} categories={categories} />

      {/* Scanner — visible during active picking */}
      {isPicking && (
        <div className="bg-card border-2 border-primary/30 rounded-xl px-4 py-3 print:hidden">
          <form onSubmit={handleScanSubmit} className="flex items-center gap-3">
            <ScanBarcode className="w-5 h-5 text-primary shrink-0" />
            <Input
              ref={scanInputRef}
              value={scanInput}
              onChange={e => setScanInput(e.target.value)}
              placeholder="Scan barcode or type SKU..."
              className="h-11 text-base font-mono flex-1"
            />
            <Button type="submit" size="default" className="h-11 px-5 gap-1.5">
              <Check className="w-4 h-4" /> Find
            </Button>
          </form>
          {lastScanned && (
            <div className="flex items-center gap-2 mt-2 text-sm text-amber-700 bg-amber-50 dark:bg-amber-900/20 rounded-lg px-3 py-2">
              <Check className="w-4 h-4 shrink-0" />
              <span><strong>{lastScanned.product_name}</strong> — {lastScanned.status === 'not_picked' ? 'auto-picked ✓' : `already ${lastScanned.status}`}</span>
            </div>
          )}
        </div>
      )}

      {/* Status banners */}
      {isCompleted ? (
        <div className="bg-green-50 border border-green-200 rounded-lg px-4 py-2.5 text-sm text-green-700 print:hidden flex items-center justify-between">
          <span>✓ All {totalLines} items released to production — stock deducted. Kitchen tasks can begin.</span>
          {run.picking_started_at && run.picking_finished_at && (
            <span className="text-xs font-mono text-green-600">
              Picking time: {(() => {
                const ms = new Date(run.picking_finished_at).getTime() - new Date(run.picking_started_at).getTime();
                const m = Math.floor(ms / 60000);
                const s = Math.floor((ms % 60000) / 1000);
                return `${m}m ${s}s`;
              })()}
            </span>
          )}
        </div>
      ) : !run.picking_started_at ? (
        <div className="bg-blue-50 border border-blue-200 rounded-lg px-5 py-4 text-sm text-blue-800 print:hidden flex items-center justify-between gap-4">
          <div>
            <p className="font-semibold">Ready to pick?</p>
            <p className="text-xs text-blue-600 mt-0.5">Items are locked until you start. Timer and scanner begin when you press the button.</p>
          </div>
          <Button
            onClick={handleStartPicking}
            disabled={totalLines === 0}
            size="lg"
            className="shrink-0 gap-2 bg-blue-600 hover:bg-blue-700 text-white px-8"
          >
            Start Picking
          </Button>
        </div>
      ) : (
        <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-2.5 text-sm text-amber-800 print:hidden flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span>Picking in progress</span>
            <LiveTimer startedAt={run.picking_started_at} isActive={!isCompleted} className="font-mono text-sm font-bold text-amber-700" />
          </div>
          <div className="flex items-center gap-2">
            {pickedButNotReleased > 0 && (
              <Button
                onClick={handleReleaseAll}
                disabled={releasing}
                className="shrink-0 bg-green-600 hover:bg-green-700 text-white gap-1.5"
                size="sm"
              >
                {releasing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                {releasing ? 'Releasing...' : `Release ${pickedButNotReleased} to Production`}
              </Button>
            )}
            <Badge variant="secondary" className="text-xs tabular-nums">
              {pickedCount}/{totalLines} picked · {releasedCount} released
            </Badge>
          </div>
        </div>
      )}

      {/* Progress bar */}
      {totalLines > 0 && (
        <div className="print:hidden">
          <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
            <span>Pick & Release progress</span>
            <span className="font-semibold tabular-nums">{releasedCount}/{totalLines} released</span>
          </div>
          <div className="w-full bg-muted rounded-full h-2.5 relative overflow-hidden">
            {/* Released = solid green */}
            <div
              className="absolute top-0 left-0 bg-green-500 h-2.5 rounded-full transition-all duration-300"
              style={{ width: `${(releasedCount / totalLines) * 100}%` }}
            />
            {/* Picked but not released = amber overlay */}
            <div
              className="absolute top-0 bg-amber-400 h-2.5 transition-all duration-300"
              style={{
                left: `${(releasedCount / totalLines) * 100}%`,
                width: `${((pickedCount - releasedCount) / totalLines) * 100}%`,
              }}
            />
          </div>
          <div className="flex gap-4 mt-1 text-[10px] text-muted-foreground">
            <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-green-500 inline-block" /> Released</span>
            <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-amber-400 inline-block" /> Picked</span>
            <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-muted inline-block border" /> Not picked</span>
          </div>
        </div>
      )}

      {/* Categories — on screen only */}
      <div className="print:hidden space-y-3">
        {categories.map(cat => (
          <PickListCategory
            key={cat}
            category={cat}
            pickLines={itemsByCategory[cat] || []}
            stockMap={stockMap}
            onMarkPicked={handleMarkPicked}
            onUnpick={handleUnpick}
            onMarkAll={handleMarkAll}
            disabled={!run.picking_started_at || isCompleted}
            isCompleted={isCompleted}
            onEditLine={isCompleted ? setEditingLine : null}
          />
        ))}
      </div>

      {totalLines === 0 && (
        <div className="bg-card border border-border rounded-xl px-6 py-12 text-center space-y-4 print:hidden">
          <AlertTriangle className="w-8 h-8 text-amber-500 mx-auto" />
          <div>
            <p className="text-sm font-semibold">No ingredients found for this pick list</p>
            <p className="text-xs text-muted-foreground mt-1 max-w-md mx-auto">
              The meals in this run are missing <strong>Portion BOMs</strong> (recipes). Go to <strong>Recipes</strong> and make sure each meal has a Portion BOM with its WIP components listed. Each WIP product also needs a Cook BOM.
            </p>
          </div>
          {generateError && (
            <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-left max-w-lg mx-auto">
              <AlertTriangle className="w-4 h-4 text-red-600 mt-0.5 shrink-0" />
              <p className="text-xs text-red-700">{generateError}</p>
            </div>
          )}
          <Button onClick={handleDeleteAndRegenerate} disabled={generating} variant="outline" className="gap-2">
            {generating ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
            {generating ? 'Checking...' : 'Delete & Try Again'}
          </Button>
        </div>
      )}

      {/* Edit modal */}
      {editingLine && (
        <PickListEditModal
          pickLine={editingLine}
          onSave={handleEditSave}
          onCancel={() => setEditingLine(null)}
        />
      )}
    </div>
  );
}