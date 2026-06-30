import React, { useState, useMemo, useRef, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { ScanBarcode, Camera, Check, ArrowLeft, Play, CheckCircle2, Send, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import FloorRunPicker from '@/components/floor/FloorRunPicker';
import FloorPickCategory from '@/components/floor/FloorPickCategory';
import CameraScanner from '@/components/floor/CameraScanner';
import LiveTimer from '@/components/kitchen/LiveTimer';
import { generatePickList } from '@/lib/pickListGenerator';
import { addToProductionFloor } from '@/lib/productionFloorStock.js';

const CATEGORY_ORDER = [
  'Meats', 'Vegetables', 'Starches', 'Spices & Seasoning',
  'Sauces & Condiments', 'Dairy & Eggs', 'Oils & Fats',
  'Dry Goods', 'Packaging', 'Other', 'Uncategorized',
];

/**
 * §10 Mobile-optimised Production Pick List — reads from persisted PickLine entities.
 * Flow: Select run → Generate if needed → scan/check items → release to production.
 */
export default function FloorPick() {
  const queryClient = useQueryClient();
  const [selectedRunId, setSelectedRunId] = useState(null);
  const [scanInput, setScanInput] = useState('');
  const [showCamera, setShowCamera] = useState(false);
  const [lastScanned, setLastScanned] = useState(null);
  const [releasing, setReleasing] = useState(false);
  const [generating, setGenerating] = useState(false);
  const bufferRef = useRef('');
  const timerRef = useRef(null);

  // Fetch active runs (scheduled + in_progress)
  const { data: allRuns = [], isLoading: loadingRuns } = useQuery({
    queryKey: ['floor-pick-runs'],
    queryFn: async () => {
      const [scheduled, inProgress] = await Promise.all([
        base44.entities.ProductionRun.filter({ status: 'scheduled' }, '-run_date', 20),
        base44.entities.ProductionRun.filter({ status: 'in_progress' }, '-run_date', 20),
      ]);
      return [...inProgress, ...scheduled];
    },
  });

  const { data: run } = useQuery({
    queryKey: ['production-run', selectedRunId],
    queryFn: () => base44.entities.ProductionRun.filter({ id: selectedRunId }).then(r => r[0]),
    enabled: !!selectedRunId,
  });

  // Persisted pick list
  const { data: pickLists = [], isLoading: loadingPickList } = useQuery({
    queryKey: ['pick-list-for-run', selectedRunId],
    queryFn: () => base44.entities.PickList.filter({ production_run_id: selectedRunId }, '-created_date', 1),
    enabled: !!selectedRunId,
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

  const stockMap = useMemo(() => {
    const map = {};
    stockRecords.forEach(s => {
      if (!map[s.product_id]) map[s.product_id] = 0;
      map[s.product_id] += s.qty_on_hand || 0;
    });
    return map;
  }, [stockRecords]);

  // Group by category
  const { categories, itemsByCategory } = useMemo(() => {
    const byCategory = {};
    pickLines.forEach(pl => {
      const cat = pl.category_group || 'Uncategorized';
      if (!byCategory[cat]) byCategory[cat] = [];
      byCategory[cat].push(pl);
    });
    Object.values(byCategory).forEach(arr => arr.sort((a, b) => (a.product_name || '').localeCompare(b.product_name || '')));
    const cats = Object.keys(byCategory).sort((a, b) => CATEGORY_ORDER.indexOf(a) - CATEGORY_ORDER.indexOf(b));
    return { categories: cats, itemsByCategory: byCategory };
  }, [pickLines]);

  // Barcode lookup
  const lookupMap = useMemo(() => {
    const map = {};
    pickLines.forEach(pl => {
      if (pl.product_sku) map[pl.product_sku.toLowerCase()] = pl;
    });
    return map;
  }, [pickLines]);

  const totalLines = pickLines.length;
  const pickedCount = pickLines.filter(pl => pl.status === 'picked' || pl.status === 'released').length;
  const releasedCount = pickLines.filter(pl => pl.status === 'released').length;
  const pickedButNotReleased = pickLines.filter(pl => pl.status === 'picked').length;
  const isCompleted = pickList?.status === 'completed' || (totalLines > 0 && releasedCount === totalLines);
  const isPicking = !!run?.picking_started_at && !isCompleted;
  const needsStart = !!run && !run.picking_started_at && !isCompleted;

  const processCode = (code) => {
    const trimmed = code.trim().toLowerCase();
    if (!trimmed) return;
    const found = lookupMap[trimmed];
    if (found) {
      setLastScanned(found);
      if (found.status === 'not_picked') {
        handleMarkPicked(found.id, found.required_qty);
        toast.success(`Scanned: ${found.product_name} — auto-picked`);
      } else {
        toast.info(`${found.product_name} already ${found.status}`);
      }
    } else {
      setLastScanned(null);
      toast.error(`No match for "${code.trim()}"`);
    }
    setShowCamera(false);
  };

  // HID barcode scanner listener
  useEffect(() => {
    if (!isPicking) return;
    const handleKeyDown = (e) => {
      const active = document.activeElement;
      if (active && active.tagName === 'INPUT' && active.type !== 'hidden') return;
      if (e.key === 'Enter') {
        e.preventDefault();
        if (bufferRef.current.length > 3) {
          processCode(bufferRef.current);
          setScanInput('');
        }
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

  // Optimistic cache helper
  const optimisticUpdateLine = (pickLineId, patch) => {
    queryClient.setQueryData(['pick-lines', pickList?.id], (old) => {
      if (!old) return old;
      return old.map(pl => pl.id === pickLineId ? { ...pl, ...patch } : pl);
    });
  };

  const handleMarkPicked = (pickLineId, qty) => {
    const patch = { status: 'picked', actual_qty_picked: Number(qty), picked_at: new Date().toISOString() };
    optimisticUpdateLine(pickLineId, patch);
    base44.entities.PickLine.update(pickLineId, patch);
  };

  const handleUnpick = (pickLineId) => {
    const patch = { status: 'not_picked', actual_qty_picked: 0, picked_at: null };
    optimisticUpdateLine(pickLineId, patch);
    base44.entities.PickLine.update(pickLineId, patch);
  };

  const handleMarkAll = (linesToMark) => {
    const now = new Date().toISOString();
    const qtyMap = {};
    linesToMark.forEach(({ id, qty }) => { qtyMap[id] = Number(qty); });
    queryClient.setQueryData(['pick-lines', pickList?.id], (old) => {
      if (!old) return old;
      return old.map(pl => qtyMap[pl.id] !== undefined
        ? { ...pl, status: 'picked', actual_qty_picked: qtyMap[pl.id], picked_at: now }
        : pl
      );
    });
    Promise.all(linesToMark.map(({ id, qty }) =>
      base44.entities.PickLine.update(id, { status: 'picked', actual_qty_picked: Number(qty), picked_at: now })
    ));
  };

  const handleStartPicking = async () => {
    // Picking must NOT start the run. Tasks are only generated by "Start Production"
    // on the run detail page, and the start gates (cooking runs released, WIP exists,
    // stock) only run there too. If picking flipped the run to in_progress, that button
    // would hide before any tasks were created — leaving an empty run on the floor.
    // Keep the run as-is and just stamp the picking timer.
    const updates = { picking_started_at: new Date().toISOString() };
    await base44.entities.ProductionRun.update(selectedRunId, updates);
    queryClient.invalidateQueries({ queryKey: ['production-run', selectedRunId] });
    queryClient.invalidateQueries({ queryKey: ['floor-pick-runs'] });
    toast.success('Picking started');
  };

  const handleGenerate = async () => {
    setGenerating(true);
    try {
      await generatePickList(selectedRunId, run);
      queryClient.invalidateQueries({ queryKey: ['pick-list-for-run', selectedRunId] });
      toast.success('Pick list generated');
    } catch (err) {
      toast.error(err.message || 'Failed to generate');
    }
    setGenerating(false);
  };

  // Release all picked lines
  const handleReleaseAll = async () => {
    const pickedLines = pickLines.filter(pl => pl.status === 'picked');
    if (pickedLines.length === 0) return;

    setReleasing(true);
    const releaseBatch = new Date().toISOString();
    const sohRecords = await base44.entities.StockOnHand.list('-updated_date', 2000);

    for (const pl of pickedLines) {
      const qty = pl.actual_qty_picked || pl.required_qty;
      if (qty <= 0 || pl.is_consumable) {
        await base44.entities.PickLine.update(pl.id, { status: 'released', released_at: releaseBatch, release_batch: releaseBatch });
        continue;
      }

      await base44.entities.StockMovement.create({
        product_id: pl.product_id, product_sku: pl.product_sku, product_name: pl.product_name,
        from_location_id: pl.from_location_id || null,
        qty, uom: pl.required_uom,
        reason: 'production_pick', ref_type: 'pick_list', ref_id: pickList.id,
        ref_number: run?.run_number || '',
        notes: `Released ${qty} ${pl.required_uom} of ${pl.product_sku} to production`,
      });

      // Deduct SOH
      const productSoh = sohRecords.filter(s => s.product_id === pl.product_id && (s.qty_on_hand || 0) > 0)
        .sort((a, b) => (b.qty_on_hand || 0) - (a.qty_on_hand || 0));
      let remaining = qty;
      for (const soh of productSoh) {
        if (remaining <= 0) break;
        const deduct = Math.min(remaining, soh.qty_on_hand || 0);
        await base44.entities.StockOnHand.update(soh.id, {
          qty_on_hand: Math.max(0, (soh.qty_on_hand || 0) - deduct),
          qty_available: Math.max(0, (soh.qty_on_hand || 0) - deduct) - (soh.qty_committed || 0),
          last_updated_at: new Date().toISOString(),
        });
        remaining -= deduct;
      }

      // Add to Production floor SOH
      await addToProductionFloor(pl.product_id, pl.product_sku, pl.product_name, qty, pl.required_uom);

      await base44.entities.PickLine.update(pl.id, { status: 'released', released_at: releaseBatch, release_batch: releaseBatch });
    }

    // Check completion
    const updated = await base44.entities.PickLine.filter({ pick_list_id: pickList.id }, 'product_name', 500);
    const newReleasedCount = updated.filter(pl => pl.status === 'released').length;
    const plUpdates = { released_lines: newReleasedCount };
    if (newReleasedCount >= updated.length) {
      plUpdates.status = 'completed';
      plUpdates.completed_at = new Date().toISOString();
      await base44.entities.ProductionRun.update(selectedRunId, {
        pick_list_confirmed: true, picking_finished_at: new Date().toISOString(),
      });
    }
    await base44.entities.PickList.update(pickList.id, plUpdates);

    queryClient.invalidateQueries({ queryKey: ['pick-lines', pickList?.id] });
    queryClient.invalidateQueries({ queryKey: ['pick-list-for-run', selectedRunId] });
    queryClient.invalidateQueries({ queryKey: ['production-run', selectedRunId] });
    queryClient.invalidateQueries({ queryKey: ['stock-on-hand'] });
    toast.success(`${pickedLines.length} items released to production`);
    setReleasing(false);
  };

  const handleScanSubmit = (e) => {
    e.preventDefault();
    processCode(scanInput);
    setScanInput('');
  };

  // Step 1: Run picker
  if (!selectedRunId) {
    return <FloorRunPicker runs={allRuns} loading={loadingRuns} onSelect={setSelectedRunId} />;
  }

  const runLoaded = !!run;

  // No pick list yet — prompt to generate
  if (runLoaded && !pickList && !loadingPickList) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <button onClick={() => setSelectedRunId(null)} className="p-2 -ml-2 rounded-xl hover:bg-muted">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <h1 className="text-xl font-bold">Pick List — {run.run_number}</h1>
        </div>
        <div className="text-center py-12 space-y-4">
          <p className="text-sm text-muted-foreground">No pick list generated yet.</p>
          <Button onClick={handleGenerate} disabled={generating} className="gap-2 h-14 text-base w-full">
            {generating ? <Loader2 className="w-5 h-5 animate-spin" /> : null}
            {generating ? 'Generating...' : 'Generate Pick List'}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button onClick={() => setSelectedRunId(null)} className="p-2 -ml-2 rounded-xl hover:bg-muted">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div className="flex-1">
          <h1 className="text-xl font-bold">Pick List — {run?.run_number || '...'}</h1>
          <p className="text-xs text-muted-foreground">{totalLines} ingredients · {releasedCount} released</p>
        </div>
      </div>

      {!runLoaded && <div className="text-center py-8 text-sm text-muted-foreground">Loading...</div>}

      {/* Status banners */}
      {isCompleted && (
        <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-2xl px-4 py-3 text-sm text-green-700 dark:text-green-300 flex items-center gap-2">
          <CheckCircle2 className="w-5 h-5 shrink-0" />
          <span>All items released — stock deducted. Kitchen tasks can begin.</span>
        </div>
      )}

      {needsStart && (
        <Button
          onClick={handleStartPicking}
          disabled={totalLines === 0}
          className="w-full h-14 text-base gap-2 bg-blue-600 hover:bg-blue-700 text-white"
        >
          <Play className="w-5 h-5" /> Start Picking
        </Button>
      )}

      {isPicking && (
        <>
          {/* Timer + progress */}
          <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-2xl px-4 py-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-amber-700 dark:text-amber-300">Picking</span>
              <LiveTimer startedAt={run.picking_started_at} isActive={true} className="font-mono text-sm font-bold text-amber-700 dark:text-amber-400 tabular-nums" />
            </div>
            <Badge variant="secondary" className="text-xs tabular-nums">{pickedCount}/{totalLines}</Badge>
          </div>

          {/* Scanner */}
          <form onSubmit={handleScanSubmit} className="flex gap-2">
            <div className="relative flex-1">
              <ScanBarcode className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
              <Input value={scanInput} onChange={e => setScanInput(e.target.value)} placeholder="SKU or barcode..." className="h-14 text-lg font-mono pl-11" />
            </div>
            <Button type="button" variant="outline" className="h-14 w-14 shrink-0" onClick={() => setShowCamera(true)}>
              <Camera className="w-6 h-6" />
            </Button>
          </form>

          {showCamera && (
            <CameraScanner active={showCamera} onScan={(code) => { setScanInput(''); processCode(code); }} onClose={() => setShowCamera(false)} />
          )}

          {lastScanned && (
            <div className="flex items-center gap-2 text-sm bg-amber-50 dark:bg-amber-900/20 rounded-xl px-4 py-2.5">
              <Check className="w-4 h-4 text-amber-600 shrink-0" />
              <span><strong>{lastScanned.product_name}</strong> — {lastScanned.status === 'not_picked' ? 'auto-picked ✓' : `already ${lastScanned.status}`}</span>
            </div>
          )}

          {/* Progress */}
          <div>
            <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
              <span>Progress</span>
              <span className="font-semibold tabular-nums">{releasedCount}/{totalLines} released</span>
            </div>
            <div className="w-full bg-muted rounded-full h-3 relative overflow-hidden">
              <div className="absolute top-0 left-0 bg-green-500 h-3 rounded-full transition-all" style={{ width: `${totalLines ? (releasedCount / totalLines) * 100 : 0}%` }} />
              <div className="absolute top-0 bg-amber-400 h-3 transition-all" style={{ left: `${totalLines ? (releasedCount / totalLines) * 100 : 0}%`, width: `${totalLines ? ((pickedCount - releasedCount) / totalLines) * 100 : 0}%` }} />
            </div>
          </div>
        </>
      )}

      {/* Categories */}
      {loadingPickLines ? (
        <div className="text-center py-12 text-sm text-muted-foreground">Loading pick list...</div>
      ) : (
        categories.map(cat => (
          <FloorPickCategory
            key={cat}
            category={cat}
            pickLines={itemsByCategory[cat] || []}
            stockMap={stockMap}
            onMarkPicked={handleMarkPicked}
            onUnpick={handleUnpick}
            onMarkAll={handleMarkAll}
            disabled={!isPicking}
            confirmed={isCompleted}
          />
        ))
      )}

      {totalLines === 0 && !loadingPickLines && (
        <div className="text-center py-12 text-sm text-muted-foreground">
          No ingredients found — check recipes are set up for meals in this run.
        </div>
      )}

      {/* Release FAB */}
      {isPicking && pickedButNotReleased > 0 && (
        <div className="sticky bottom-0 pb-4 pt-2 bg-gradient-to-t from-background via-background to-transparent">
          <Button
            onClick={handleReleaseAll}
            disabled={releasing}
            className="w-full h-14 text-base gap-2 bg-green-600 hover:bg-green-700 text-white"
          >
            {releasing ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" />}
            {releasing ? 'Releasing...' : `Release ${pickedButNotReleased} Items to Production`}
          </Button>
        </div>
      )}
    </div>
  );
}