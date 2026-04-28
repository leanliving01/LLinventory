import React, { useState, useMemo, useRef, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { ArrowLeft, ScanBarcode, PackageCheck } from 'lucide-react';
import { toast } from 'sonner';
import FloorOrderPicker from '@/components/floor/FloorOrderPicker';
import FloorPackList from '@/components/floor/FloorPackList';
import FloorPackTimer from '@/components/floor/FloorPackTimer';
import CameraScanner from '@/components/floor/CameraScanner';
import PackerSelectModal from '@/components/floor/PackerSelectModal';
import { useScanFeedback } from '@/components/floor/ScanFeedback';

/* ── SKU-to-friendly-name map ── */
const SKU_LABELS = {
  MenLeaMus: "Men's Lean Muscle",
  MenWeiLos: "Men's Weight Loss",
  WomLeaMus: "Women's Lean Muscle",
  WomWeiLos: "Women's Weight Loss",
  LowCar: "Low Carb",
};

function friendlyPackageName(sku, name) {
  if (!sku) return name || 'Package';
  for (const [prefix, label] of Object.entries(SKU_LABELS)) {
    if (sku.startsWith(prefix)) {
      const num = sku.replace(prefix, '');
      return `${label} — ${num} Pack`;
    }
  }
  if (/byo/i.test(sku) || /build.your.own/i.test(name || '')) return 'Build Your Own';
  return name || sku;
}

export default function FloorPack() {
  const queryClient = useQueryClient();
  const { triggerFeedback, FeedbackWrapper } = useScanFeedback();

  // Packer identity
  const [packer, setPacker] = useState(null); // DispatchTeamMember object or null

  // Order & scanning
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [scannedMap, setScannedMap] = useState({});
  const [scanInput, setScanInput] = useState('');
  const [showCamera, setShowCamera] = useState(false);
  const [packing, setPacking] = useState(false);

  // Timer: pause/resume
  const [packingStartedAt, setPackingStartedAt] = useState(null);
  const [isPaused, setIsPaused] = useState(false);
  const [accumulatedSeconds, setAccumulatedSeconds] = useState(0);
  const segmentStartRef = useRef(null);

  const bufferRef = useRef('');
  const timerRef = useRef(null);

  // ── Restore timer state when re-entering a picking order ──
  useEffect(() => {
    if (selectedOrder && selectedOrder.status === 'picking' && selectedOrder.picking_started_at) {
      setPackingStartedAt(selectedOrder.picking_started_at);
      const savedSeconds = selectedOrder.packing_duration_seconds || 0;
      setAccumulatedSeconds(savedSeconds);
      if (selectedOrder.packing_paused) {
        setIsPaused(true);
        segmentStartRef.current = null;
      } else {
        setIsPaused(false);
        segmentStartRef.current = Date.now();
      }
      if (selectedOrder.packed_by_name && !packer) {
        setPacker({ name: selectedOrder.packed_by_name, id: selectedOrder.packed_by_member_id });
      }
    }
  }, [selectedOrder?.id]);

  // ── Data queries ──
  const { data: orders = [], isLoading: loadingOrders } = useQuery({
    queryKey: ['floor-pack-orders'],
    queryFn: async () => {
      const pending = await base44.entities.SalesOrder.filter(
        { lifecycle_state: 'paid_unfulfilled', status: 'pending' },
        '-order_date', 500,
      );
      const picking = await base44.entities.SalesOrder.filter(
        { lifecycle_state: 'paid_unfulfilled', status: 'picking' },
        '-order_date', 500,
      );
      const map = new Map();
      [...picking, ...pending].forEach(o => { if (!map.has(o.id)) map.set(o.id, o); });
      return Array.from(map.values()).sort((a, b) => {
        if (a.status === 'picking' && b.status !== 'picking') return -1;
        if (b.status === 'picking' && a.status !== 'picking') return 1;
        return new Date(b.order_date || 0) - new Date(a.order_date || 0);
      });
    },
  });

  const { data: orderLines = [] } = useQuery({
    queryKey: ['floor-pack-order-lines', selectedOrder?.id],
    queryFn: () => base44.entities.SalesOrderLine.filter(
      { sales_order_id: selectedOrder.id }, 'sku', 200,
    ),
    enabled: !!selectedOrder?.id,
  });

  const { data: products = [] } = useQuery({
    queryKey: ['floor-products'],
    queryFn: () => base44.entities.Product.filter({ status: 'active' }, 'sku', 2000),
    staleTime: 5 * 60 * 1000,
  });

  const skuNameMap = useMemo(() => {
    const map = {};
    products.forEach(p => { if (p.sku) map[p.sku.toLowerCase()] = p.name || p.sku; });
    return map;
  }, [products]);

  const resolvedName = (sku, fallbackName) => {
    if (!sku) return fallbackName || 'Unknown';
    return skuNameMap[sku.toLowerCase()] || fallbackName || sku;
  };

  // ── Build grouped pack list ──
  const groups = useMemo(() => {
    const parentLines = orderLines.filter(ol => ol.is_package_parent);
    const componentLines = orderLines.filter(ol => ol.is_package_component && !ol.is_package_parent && ol.status !== 'cancelled');
    const standaloneLines = orderLines.filter(ol => !ol.is_package_parent && !ol.is_package_component && ol.status !== 'cancelled');
    const result = [];

    parentLines.forEach(parent => {
      const children = componentLines.filter(c => c.parent_line_id === parent.id);
      if (children.length === 0) return;
      result.push({
        groupKey: `pkg-${parent.id}`,
        label: friendlyPackageName(parent.sku, parent.name),
        subtitle: `${parent.sku} · ${children.reduce((s, c) => s + (c.qty || 0), 0)} meals`,
        items: children.map(c => ({
          key: `sol-${c.id}`, sku: c.sku || '', skuLower: (c.sku || '').toLowerCase(),
          name: resolvedName(c.sku, c.name), qty: c.qty || 0,
        })),
      });
    });

    const parentIds = new Set(parentLines.map(p => p.id));
    const orphans = componentLines.filter(c => !parentIds.has(c.parent_line_id));
    if (orphans.length > 0) {
      result.push({
        groupKey: 'orphan', label: 'Package Items', subtitle: null,
        items: orphans.map(c => ({
          key: `sol-${c.id}`, sku: c.sku || '', skuLower: (c.sku || '').toLowerCase(),
          name: resolvedName(c.sku, c.name), qty: c.qty || 0,
        })),
      });
    }

    const byoLines = standaloneLines.filter(ol => ol.line_type === 'byo' || (ol.portion_weight_g && !ol.variant_title));
    const trueStandalone = standaloneLines.filter(ol => !byoLines.includes(ol));

    if (byoLines.length > 0) {
      result.push({
        groupKey: 'byo', label: 'Build Your Own', subtitle: `${byoLines.reduce((s, ol) => s + (ol.qty || 0), 0)} meals · 300g portions`,
        items: byoLines.map(ol => ({
          key: `sol-${ol.id}`, sku: ol.sku || '', skuLower: (ol.sku || '').toLowerCase(),
          name: resolvedName(ol.sku, ol.name), qty: ol.qty || 0,
        })),
      });
    }
    if (trueStandalone.length > 0) {
      result.push({
        groupKey: 'standalone', label: 'Standalone Items', subtitle: null,
        items: trueStandalone.map(ol => ({
          key: `sol-${ol.id}`, sku: ol.sku || '', skuLower: (ol.sku || '').toLowerCase(),
          name: resolvedName(ol.sku, ol.name), qty: ol.qty || 0, variantTitle: ol.variant_title,
        })),
      });
    }
    return result;
  }, [orderLines, skuNameMap]);

  const allPackItems = useMemo(() => groups.flatMap(g => g.items), [groups]);

  const allProductLookup = useMemo(() => {
    const map = {};
    products.forEach(p => {
      const sku = (p.sku || '').toLowerCase();
      if (p.barcode) map[p.barcode.toLowerCase()] = sku;
      map[sku] = sku;
    });
    return map;
  }, [products]);

  const orderSkuSet = useMemo(() => new Set(allPackItems.map(i => i.skuLower)), [allPackItems]);

  // ── Scan processing ──
  const processCode = (code) => {
    const trimmed = code.trim().toLowerCase();
    if (!trimmed) return;
    if (!packingStartedAt) {
      toast.error('Press "Start Packing" first');
      triggerFeedback('error');
      return;
    }
    if (isPaused) {
      toast.error('Packing is paused — press Resume first');
      triggerFeedback('error');
      return;
    }

    const resolvedSku = allProductLookup[trimmed];
    if (!resolvedSku) {
      toast.error(`Unknown barcode: "${code.trim()}"`);
      triggerFeedback('error');
      return;
    }
    if (!orderSkuSet.has(resolvedSku)) {
      const wrongName = skuNameMap[resolvedSku] || resolvedSku;
      toast.error(`Wrong item — "${wrongName}" is not in this order`);
      triggerFeedback('error');
      return;
    }

    const item = allPackItems.find(i => i.skuLower === resolvedSku);
    const currentCount = scannedMap[resolvedSku] || 0;
    if (item && currentCount >= item.qty) {
      toast.warning(`Already scanned all ${item.qty} of ${item.name}`);
      triggerFeedback('error');
      return;
    }

    setScannedMap(prev => ({ ...prev, [resolvedSku]: (prev[resolvedSku] || 0) + 1 }));
    toast.success(`✓ ${item?.name || resolvedSku} (${currentCount + 1}/${item?.qty || '?'})`);
    triggerFeedback('success');
  };

  // HID barcode scanner
  useEffect(() => {
    if (!selectedOrder) return;
    const handleKeyDown = (e) => {
      const active = document.activeElement;
      if (active && active.tagName === 'INPUT' && active.type !== 'hidden') return;
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
  }, [allProductLookup, orderSkuSet, selectedOrder, packingStartedAt, isPaused]);

  const totalNeeded = allPackItems.reduce((s, i) => s + (i.qty || 0), 0);
  const totalScanned = Object.values(scannedMap).reduce((s, v) => s + v, 0);
  const allDone = totalScanned >= totalNeeded && totalNeeded > 0;

  const handleScanSubmit = (e) => {
    e.preventDefault();
    processCode(scanInput);
    setScanInput('');
  };

  // ── Timer helpers ──
  const getCurrentSegmentSeconds = () => {
    if (!segmentStartRef.current) return 0;
    return Math.floor((Date.now() - segmentStartRef.current) / 1000);
  };

  const handleStartPacking = async () => {
    const now = new Date().toISOString();
    setPackingStartedAt(now);
    setIsPaused(false);
    setAccumulatedSeconds(0);
    segmentStartRef.current = Date.now();
    await base44.entities.SalesOrder.update(selectedOrder.id, {
      status: 'picking',
      picking_started_at: now,
      packing_paused: false,
      packing_duration_seconds: 0,
      packed_by_name: packer?.name || '',
      packed_by_member_id: packer?.id || '',
    });
    toast.success('Packing started — scan items!');
  };

  const handlePause = async () => {
    const segSec = getCurrentSegmentSeconds();
    const newTotal = accumulatedSeconds + segSec;
    setAccumulatedSeconds(newTotal);
    segmentStartRef.current = null;
    setIsPaused(true);
    await base44.entities.SalesOrder.update(selectedOrder.id, {
      packing_paused: true,
      packing_duration_seconds: newTotal,
    });
    toast('Packing paused');
  };

  const handleResume = async () => {
    segmentStartRef.current = Date.now();
    setIsPaused(false);
    await base44.entities.SalesOrder.update(selectedOrder.id, {
      packing_paused: false,
    });
    toast.success('Resumed packing — scan items!');
  };

  const handleFinishPacking = async () => {
    const incomplete = allPackItems.find(i => (scannedMap[i.skuLower] || 0) < i.qty);
    if (incomplete) {
      toast.error(`Still need to scan ${incomplete.name} (${scannedMap[incomplete.skuLower] || 0}/${incomplete.qty})`);
      return;
    }
    setPacking(true);
    const now = new Date().toISOString();
    const totalSec = accumulatedSeconds + getCurrentSegmentSeconds();
    await base44.entities.SalesOrder.update(selectedOrder.id, {
      status: 'packed',
      packed_at: now,
      packing_paused: false,
      packing_duration_seconds: totalSec,
    });
    queryClient.invalidateQueries({ queryKey: ['floor-pack-orders'] });
    toast.success(`Order ${selectedOrder.order_number || selectedOrder.shopify_order_id} packed in ${Math.floor(totalSec / 60)}m ${totalSec % 60}s!`);
    setPacking(false);
    setSelectedOrder(null);
    setScannedMap({});
    setPackingStartedAt(null);
    setIsPaused(false);
    setAccumulatedSeconds(0);
    segmentStartRef.current = null;
  };

  const handleBack = async () => {
    // Persist timer state if packing was in progress
    if (packingStartedAt && selectedOrder) {
      const segSec = getCurrentSegmentSeconds();
      const totalSoFar = accumulatedSeconds + segSec;
      await base44.entities.SalesOrder.update(selectedOrder.id, {
        packing_paused: true,
        packing_duration_seconds: totalSoFar,
      });
      queryClient.invalidateQueries({ queryKey: ['floor-pack-orders'] });
    }
    setSelectedOrder(null);
    setScannedMap({});
    setPackingStartedAt(null);
    setIsPaused(false);
    setAccumulatedSeconds(0);
    segmentStartRef.current = null;
  };

  // ── Step 0: Packer selection ──
  if (!packer) {
    return (
      <FeedbackWrapper>
        <PackerSelectModal onSelect={setPacker} />
      </FeedbackWrapper>
    );
  }

  // ── Step 1: Order picker ──
  if (!selectedOrder) {
    return (
      <FeedbackWrapper>
        <FloorOrderPicker orders={orders} loading={loadingOrders} onSelect={setSelectedOrder} />
      </FeedbackWrapper>
    );
  }

  // ── Step 2: Packing ──
  return (
    <FeedbackWrapper>
      <div className="space-y-4 pb-24">
        {/* Header */}
        <div className="flex items-center gap-3">
          <button onClick={handleBack} className="p-2 -ml-2 rounded-xl hover:bg-muted">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="flex-1">
            <h1 className="text-xl font-bold">Pack — {selectedOrder.order_number || selectedOrder.shopify_order_id}</h1>
            <p className="text-xs text-muted-foreground">{selectedOrder.customer_name} · Packer: <strong>{packer.name}</strong></p>
          </div>
          <Badge className="bg-blue-100 text-blue-700 tabular-nums">{totalScanned}/{totalNeeded}</Badge>
        </div>

        {/* Timer with pause/resume */}
        <FloorPackTimer
          startedAt={packingStartedAt}
          onStart={handleStartPacking}
          onPause={handlePause}
          onResume={handleResume}
          isPaused={isPaused}
          accumulatedSeconds={accumulatedSeconds}
          disabled={allPackItems.length === 0}
        />

        {/* Progress bar + Scanner — only when packing is active */}
        {packingStartedAt && (
          <>
            <div className="w-full bg-muted rounded-full h-3">
              <div
                className="bg-green-500 h-3 rounded-full transition-all duration-300"
                style={{ width: `${totalNeeded ? (totalScanned / totalNeeded) * 100 : 0}%` }}
              />
            </div>

            {/* Scanner — disabled when paused */}
            <form onSubmit={handleScanSubmit} className="flex gap-2">
              <div className="relative flex-1">
                <ScanBarcode className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
                <Input
                  value={scanInput}
                  onChange={e => setScanInput(e.target.value)}
                  placeholder={isPaused ? 'Paused — resume to scan' : 'Scan meal barcode...'}
                  className="h-14 text-lg font-mono pl-11"
                  disabled={isPaused}
                  autoFocus={!isPaused}
                />
              </div>
              <Button
                type="button"
                variant="outline"
                className="h-14 w-14 shrink-0"
                onClick={() => !isPaused && setShowCamera(true)}
                disabled={isPaused}
              >
                <ScanBarcode className="w-6 h-6" />
              </Button>
            </form>

            {showCamera && !isPaused && (
              <CameraScanner
                active={showCamera}
                onScan={(code) => { setScanInput(code); processCode(code); }}
                onClose={() => setShowCamera(false)}
              />
            )}
          </>
        )}

        {/* Grouped pack items */}
        <FloorPackList groups={groups} scannedMap={scannedMap} />

        {allPackItems.length === 0 && (
          <div className="text-center py-12 text-sm text-muted-foreground">
            No items found for this order.
          </div>
        )}

        {/* Finish bar */}
        {packingStartedAt && allPackItems.length > 0 && (
          <div className="fixed bottom-[68px] left-0 right-0 px-4 pb-4 pt-2 bg-gradient-to-t from-background via-background to-transparent z-30">
            <Button
              onClick={handleFinishPacking}
              disabled={packing || !allDone || isPaused}
              className="w-full h-14 text-base gap-2 bg-green-600 hover:bg-green-700 text-white disabled:opacity-50"
            >
              <PackageCheck className="w-5 h-5" />
              {packing ? 'Saving...' : allDone ? 'Finish Packing' : `Scan all items (${totalScanned}/${totalNeeded})`}
            </Button>
          </div>
        )}
      </div>
    </FeedbackWrapper>
  );
}