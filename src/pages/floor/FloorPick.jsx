import React, { useState, useMemo, useRef, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { ScanBarcode, Camera, Check, ArrowLeft, Play, CheckCircle2 } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import FloorRunPicker from '@/components/floor/FloorRunPicker';
import FloorPickCategory from '@/components/floor/FloorPickCategory';
import CameraScanner from '@/components/floor/CameraScanner';
import LiveTimer from '@/components/kitchen/LiveTimer';
import usePickListData from '@/lib/usePickListData';

/**
 * §5.1.3 Mobile-optimised Production Pick List.
 * Flow: Select run → scan/check items → enter qty → confirm pick.
 */
export default function FloorPick() {
  const queryClient = useQueryClient();
  const [selectedRunId, setSelectedRunId] = useState(null);
  const [pickedState, setPickedState] = useState({});
  const [scanInput, setScanInput] = useState('');
  const [showCamera, setShowCamera] = useState(false);
  const [lastScanned, setLastScanned] = useState(null);
  const [confirming, setConfirming] = useState(false);
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

  const { pickItems, categories, stockMap, isLoading: loadingPick } = usePickListData(selectedRunId);

  // Barcode lookup map
  const lookupMap = useMemo(() => {
    const map = {};
    pickItems.forEach(item => {
      if (item.product.barcode) map[item.product.barcode.toLowerCase()] = item;
      if (item.product.sku) map[item.product.sku.toLowerCase()] = item;
    });
    return map;
  }, [pickItems]);

  const processCode = (code) => {
    const trimmed = code.trim().toLowerCase();
    if (!trimmed) return;
    const found = lookupMap[trimmed];
    if (found) {
      setLastScanned(found);
      setPickedState(prev => ({
        ...prev,
        [found.product.id]: { picked: true, qty: prev[found.product.id]?.qty || '' },
      }));
      toast.success(`Checked: ${found.product.name}`);
    } else {
      setLastScanned(null);
      toast.error(`No match for "${code.trim()}"`);
    }
    setShowCamera(false);
  };

  // HID barcode scanner listener
  useEffect(() => {
    if (!run || run.pick_list_confirmed || !run.picking_started_at) return;
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
  }, [lookupMap, run]);

  const pickedCount = pickItems.filter(i => {
    const s = pickedState[i.product.id];
    return s?.picked && s?.qty && Number(s.qty) > 0;
  }).length;

  const handleTogglePicked = (pid) => {
    setPickedState(prev => ({
      ...prev,
      [pid]: { picked: !(prev[pid]?.picked), qty: prev[pid]?.qty || '' },
    }));
  };

  const handleQtyChange = (pid, value) => {
    setPickedState(prev => ({
      ...prev,
      [pid]: { ...(prev[pid] || { picked: false }), qty: value },
    }));
  };

  const handleMarkAll = (categoryItems) => {
    setPickedState(prev => {
      const next = { ...prev };
      categoryItems.forEach(item => {
        if (!next[item.product.id]?.picked) {
          next[item.product.id] = { picked: true, qty: next[item.product.id]?.qty || '' };
        }
      });
      return next;
    });
  };

  const handleStartPicking = async () => {
    const updates = { picking_started_at: new Date().toISOString() };
    // Also move run to in_progress if it's still scheduled
    if (run?.status === 'scheduled') updates.status = 'in_progress';
    await base44.entities.ProductionRun.update(selectedRunId, updates);
    queryClient.invalidateQueries({ queryKey: ['production-run', selectedRunId] });
    queryClient.invalidateQueries({ queryKey: ['floor-pick-runs'] });
    toast.success('Picking started');
  };

  const handleConfirm = async () => {
    const belowNeeded = pickItems.filter(i => {
      const s = pickedState[i.product.id];
      if (!s?.picked || !s?.qty) return false;
      return Number(s.qty) < i.totalQty;
    });
    if (belowNeeded.length > 0) {
      toast.error(`${belowNeeded.length} item(s) below needed qty — pick more or buy more`);
      return;
    }
    if (pickedCount < pickItems.length) {
      toast.error(`Only ${pickedCount}/${pickItems.length} items done — finish all first`);
      return;
    }

    setConfirming(true);
    for (const item of pickItems) {
      const state = pickedState[item.product.id];
      const qty = Number(state?.qty) || item.totalQty;
      await base44.entities.StockMovement.create({
        product_id: item.product.id,
        product_sku: item.product.sku,
        product_name: item.product.name,
        qty,
        uom: item.uom,
        reason: 'production_consume',
        ref_type: 'production_run',
        ref_id: selectedRunId,
        notes: `Pick list confirmed for run ${run?.run_number}`,
      });
    }
    await base44.entities.ProductionRun.update(selectedRunId, {
      pick_list_confirmed: true,
      picking_finished_at: new Date().toISOString(),
    });
    queryClient.invalidateQueries({ queryKey: ['production-run', selectedRunId] });
    queryClient.invalidateQueries({ queryKey: ['stock-on-hand'] });
    toast.success('Pick list confirmed — stock consumed');
    setConfirming(false);
  };

  const handleScanSubmit = (e) => {
    e.preventDefault();
    processCode(scanInput);
    setScanInput('');
  };

  // Step 1: Run picker
  if (!selectedRunId) {
    return (
      <FloorRunPicker
        runs={allRuns}
        loading={loadingRuns}
        onSelect={setSelectedRunId}
      />
    );
  }

  const runLoaded = !!run;
  const isPicking = runLoaded && !!run.picking_started_at && !run.pick_list_confirmed;
  const isConfirmed = runLoaded && !!run.pick_list_confirmed;
  const needsStart = runLoaded && !run.picking_started_at && !run.pick_list_confirmed;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button onClick={() => setSelectedRunId(null)} className="p-2 -ml-2 rounded-xl hover:bg-muted">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div className="flex-1">
          <h1 className="text-xl font-bold">Pick List — {run?.run_number || '...'}</h1>
          <p className="text-xs text-muted-foreground">{pickItems.length} ingredients</p>
        </div>
      </div>

      {/* Loading state */}
      {!runLoaded && (
        <div className="text-center py-8 text-sm text-muted-foreground">Loading run details...</div>
      )}

      {/* Status banners */}
      {isConfirmed && (
        <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-2xl px-4 py-3 text-sm text-green-700 dark:text-green-300 flex items-center gap-2">
          <CheckCircle2 className="w-5 h-5 shrink-0" />
          <span>Pick list confirmed — stock consumed. Kitchen tasks can begin.</span>
        </div>
      )}

      {/* Start Picking — only after run has loaded and picking hasn't started */}
      {needsStart && (
        <Button
          onClick={handleStartPicking}
          disabled={pickItems.length === 0}
          className="w-full h-14 text-base gap-2 bg-blue-600 hover:bg-blue-700 text-white"
        >
          <Play className="w-5 h-5" /> Start Picking
        </Button>
      )}

      {isPicking && (
        <>
          {/* Timer + confirm bar */}
          <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-2xl px-4 py-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-amber-700 dark:text-amber-300">Picking</span>
              <LiveTimer startedAt={run.picking_started_at} isActive={true} className="font-mono text-sm font-bold text-amber-700 dark:text-amber-400 tabular-nums" />
            </div>
            <Badge variant="secondary" className="text-xs">{pickedCount}/{pickItems.length}</Badge>
          </div>

          {/* Scanner bar */}
          <form onSubmit={handleScanSubmit} className="flex gap-2">
            <div className="relative flex-1">
              <ScanBarcode className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
              <Input
                value={scanInput}
                onChange={e => setScanInput(e.target.value)}
                placeholder="SKU or barcode..."
                className="h-14 text-lg font-mono pl-11"
              />
            </div>
            <Button type="button" variant="outline" className="h-14 w-14 shrink-0" onClick={() => setShowCamera(true)}>
              <Camera className="w-6 h-6" />
            </Button>
          </form>

          {/* Camera scanner */}
          {showCamera && (
            <CameraScanner
              active={showCamera}
              onScan={(code) => { setScanInput(''); processCode(code); }}
              onClose={() => setShowCamera(false)}
            />
          )}

          {lastScanned && (
            <div className="flex items-center gap-2 text-sm bg-amber-50 dark:bg-amber-900/20 rounded-xl px-4 py-2.5">
              <Check className="w-4 h-4 text-amber-600 shrink-0" />
              <span><strong>{lastScanned.product.name}</strong> — checked ✓ enter qty</span>
            </div>
          )}

          {/* Progress bar */}
          <div>
            <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
              <span>Progress</span>
              <span className="font-semibold">{pickedCount}/{pickItems.length}</span>
            </div>
            <div className="w-full bg-muted rounded-full h-3">
              <div
                className="bg-green-500 h-3 rounded-full transition-all duration-300"
                style={{ width: `${pickItems.length ? (pickedCount / pickItems.length) * 100 : 0}%` }}
              />
            </div>
          </div>
        </>
      )}

      {/* Categories */}
      {loadingPick ? (
        <div className="text-center py-12 text-sm text-muted-foreground">Loading pick list...</div>
      ) : (
        categories.map(cat => (
          <FloorPickCategory
            key={cat}
            category={cat}
            items={pickItems.filter(i => i.pickCategory === cat)}
            pickedState={pickedState}
            stockMap={stockMap}
            onTogglePicked={handleTogglePicked}
            onQtyChange={handleQtyChange}
            onMarkAll={handleMarkAll}
            disabled={!isPicking}
            confirmed={isConfirmed}
          />
        ))
      )}

      {pickItems.length === 0 && !loadingPick && (
        <div className="text-center py-12 text-sm text-muted-foreground">
          No ingredients found — check recipes are set up for meals in this run.
        </div>
      )}

      {/* Confirm FAB */}
      {isPicking && pickedCount > 0 && (
        <div className="sticky bottom-0 pb-4 pt-2 bg-gradient-to-t from-background via-background to-transparent">
          <Button
            onClick={handleConfirm}
            disabled={confirming || pickedCount < pickItems.length}
            className="w-full h-14 text-base gap-2 bg-green-600 hover:bg-green-700 text-white"
          >
            <CheckCircle2 className="w-5 h-5" />
            {confirming ? 'Confirming...' : `Confirm Pick List (${pickedCount}/${pickItems.length})`}
          </Button>
        </div>
      )}
    </div>
  );
}