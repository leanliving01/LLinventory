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
import ScanResultBanner from '@/components/floor/ScanResultBanner';

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

/** Find the matching PackBom color for a parent SKU */
function resolvePackColor(parentSku, packBoms) {
  if (!parentSku || !packBoms?.length) return null;
  const skuLower = parentSku.toLowerCase();
  // Exact match first
  const exact = packBoms.find(pb => (pb.package_sku || '').toLowerCase() === skuLower);
  if (exact?.pack_color_theme) return exact.pack_color_theme;
  // Prefix match (e.g. MenLeaMus15 matches MenLeaMus prefix)
  const prefix = packBoms.find(pb => {
    const pbSku = (pb.package_sku || '').toLowerCase();
    return skuLower.startsWith(pbSku) || pbSku.startsWith(skuLower);
  });
  return prefix?.pack_color_theme || null;
}

export default function FloorPack() {
  const queryClient = useQueryClient();
  const { triggerFeedback, FeedbackWrapper } = useScanFeedback();

  // Packer identity
  const [packer, setPacker] = useState(null); // Production Team member (dispatch station) { id, name } or null

  // Order & scanning
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [scannedMap, setScannedMap] = useState({});
  const [scanInput, setScanInput] = useState('');
  const [showCamera, setShowCamera] = useState(false);
  const [packing, setPacking] = useState(false);
  const [showBackConfirm, setShowBackConfirm] = useState(false);
  const [lastScanResult, setLastScanResult] = useState(null); // { type: 'success'|'error', message: string }

  // Timer: pause/resume
  const [packingStartedAt, setPackingStartedAt] = useState(null);
  const [isPaused, setIsPaused] = useState(false);
  const [accumulatedSeconds, setAccumulatedSeconds] = useState(0);
  const segmentStartRef = useRef(null);

  const bufferRef = useRef('');
  const timerRef = useRef(null);
  const saveDebounceRef = useRef(null);

  // ── Restore timer state AND scan progress when re-entering a picking order ──
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
      // Restore scanned progress
      if (selectedOrder.packing_scanned_map) {
        try {
          const saved = JSON.parse(selectedOrder.packing_scanned_map);
          if (saved && typeof saved === 'object') setScannedMap(saved);
        } catch { /* ignore bad JSON */ }
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

  const { data: orderLines = [], isLoading: loadingLines } = useQuery({
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

  const { data: packBoms = [] } = useQuery({
    queryKey: ['floor-pack-boms'],
    queryFn: () => base44.entities.PackBom.filter({ active: true }, 'package_sku', 200),
    staleTime: 5 * 60 * 1000,
  });

  const skuNameMap = useMemo(() => {
    const map = {};
    products.forEach(p => { if (p.sku) map[p.sku.toLowerCase()] = p.name || p.sku; });
    return map;
  }, [products]);

  // Product type lookup: sku → type (supplement, sauce, finished_meal, etc.)
  const skuTypeMap = useMemo(() => {
    const map = {};
    products.forEach(p => { if (p.sku) map[p.sku.toLowerCase()] = { type: p.type, sellable: !!p.sellable }; });
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
        colorTheme: resolvePackColor(parent.sku, packBoms),
        items: children.map(c => ({
          key: `sol-${c.id}`, sku: c.sku || '', skuLower: (c.sku || '').toLowerCase(),
          name: resolvedName(c.sku, c.name), qty: c.qty || 0, variantTitle: c.variant_title || '',
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
          name: resolvedName(c.sku, c.name), qty: c.qty || 0, variantTitle: c.variant_title || '',
        })),
      });
    }

    const byoLines = standaloneLines.filter(ol => ol.line_type === 'byo' || (ol.portion_weight_g && !ol.variant_title));
    const trueStandalone = standaloneLines.filter(ol => !byoLines.includes(ol));

    // Find BYO color from PackBoms
    const byoPackBom = packBoms.find(pb => pb.package_type === 'byo');

    if (byoLines.length > 0) {
      result.push({
        groupKey: 'byo', label: 'Build Your Own',
        subtitle: `${byoLines.reduce((s, ol) => s + (ol.qty || 0), 0)} meals · 300g portions`,
        colorTheme: byoPackBom?.pack_color_theme || 'blue',
        items: byoLines.map(ol => ({
          key: `sol-${ol.id}`, sku: ol.sku || '', skuLower: (ol.sku || '').toLowerCase(),
          name: resolvedName(ol.sku, ol.name), qty: ol.qty || 0, variantTitle: ol.variant_title || '',
        })),
      });
    }
    if (trueStandalone.length > 0) {
      // Determine what's in the standalone group using product type
      let hasMeals = false;
      let hasSupplements = false;
      trueStandalone.forEach(ol => {
        const info = skuTypeMap[(ol.sku || '').toLowerCase()];
        if (info?.type === 'supplement') hasSupplements = true;
        else if (info?.type === 'sauce' && info?.sellable) hasSupplements = true;
        else if (info?.type === 'finished_meal') hasMeals = true;
        else hasMeals = true; // default unknown to meals
      });
      const standaloneLabel = hasMeals && hasSupplements ? 'Meals & Supplements'
        : hasSupplements ? 'Supplements'
        : 'Meals';

      result.push({
        groupKey: 'standalone', label: standaloneLabel, subtitle: null,
        items: trueStandalone.map(ol => ({
          key: `sol-${ol.id}`, sku: ol.sku || '', skuLower: (ol.sku || '').toLowerCase(),
          name: resolvedName(ol.sku, ol.name), qty: ol.qty || 0, variantTitle: ol.variant_title,
        })),
      });
    }
    return result;
  }, [orderLines, skuNameMap, skuTypeMap, packBoms]);

  const allPackItems = useMemo(() => groups.flatMap(g => g.items), [groups]);

  // Build barcode/SKU → product SKU lookup.
  // Handles leading-zero ambiguity: scanners may add or strip a leading '0'.
  // When multiple products share near-identical barcodes (e.g. 0759649607889 vs 759649607889),
  // we store ALL variants but track collisions so processCode can disambiguate using the order context.
  const allProductLookup = useMemo(() => {
    const map = {};
    const addBarcode = (bc, sku) => {
      const key = bc.toLowerCase();
      // If already mapped to a different SKU, store as array for disambiguation
      if (map[key] && map[key] !== sku) {
        map[key] = Array.isArray(map[key]) ? [...map[key], sku] : [map[key], sku];
      } else if (!map[key]) {
        map[key] = sku;
      }
    };
    products.forEach(p => {
      const sku = (p.sku || '').toLowerCase();
      if (p.barcode) {
        const bc = p.barcode.trim();
        addBarcode(bc, sku);
        // Also index the zero-stripped and zero-prefixed variants
        if (bc.startsWith('0')) addBarcode(bc.replace(/^0+/, ''), sku);
        else addBarcode('0' + bc, sku);
      }
      map[sku] = sku;
    });
    return map;
  }, [products]);

  // Build order SKU set + a reverse lookup that maps full product SKUs to their
  // decomposed line SKU. Needed because PackBom component_skus can be abbreviated
  // (e.g. "ChiBreButandSti") while the actual Product.sku is longer
  // (e.g. "ChiBreButandStialowitaSweandSouSau"). The barcode resolves to the
  // full product SKU, but the order line uses the PackBom abbreviated SKU.
  const { orderSkuSet, productSkuToLineSku } = useMemo(() => {
    const lineSkus = allPackItems.map(i => i.skuLower);
    const set = new Set(lineSkus);
    const mapping = {}; // fullProductSku → lineSkuUsedInOrder

    // For each product, check if its full SKU starts with any line SKU (or vice versa)
    products.forEach(p => {
      const fullSku = (p.sku || '').toLowerCase();
      if (!fullSku) return;
      // Direct match — already in set, no mapping needed
      if (set.has(fullSku)) return;
      // Check prefix: does the full product SKU start with any abbreviated line SKU?
      for (const lineSku of lineSkus) {
        if (fullSku.startsWith(lineSku) || lineSku.startsWith(fullSku)) {
          mapping[fullSku] = lineSku;
          break;
        }
      }
    });

    return { orderSkuSet: set, productSkuToLineSku: mapping };
  }, [allPackItems, products]);

  // ── Refs to avoid stale closures in HID keydown handler ──
  const allProductLookupRef = useRef(allProductLookup);
  const orderSkuSetRef = useRef(orderSkuSet);
  const productSkuToLineSkuRef = useRef(productSkuToLineSku);
  const allPackItemsRef = useRef(allPackItems);
  const skuNameMapRef = useRef(skuNameMap);
  const scannedMapRef = useRef(scannedMap);
  const packingStartedAtRef = useRef(packingStartedAt);
  const isPausedRef = useRef(isPaused);

  useEffect(() => { allProductLookupRef.current = allProductLookup; }, [allProductLookup]);
  useEffect(() => { orderSkuSetRef.current = orderSkuSet; }, [orderSkuSet]);
  useEffect(() => { productSkuToLineSkuRef.current = productSkuToLineSku; }, [productSkuToLineSku]);
  useEffect(() => { allPackItemsRef.current = allPackItems; }, [allPackItems]);
  useEffect(() => { skuNameMapRef.current = skuNameMap; }, [skuNameMap]);
  useEffect(() => { scannedMapRef.current = scannedMap; }, [scannedMap]);

  // ── Auto-save scan progress after each scan (debounced 2s) ──
  useEffect(() => {
    if (!selectedOrder?.id || !packingStartedAt) return;
    // Don't save empty maps (initial load)
    const hasScans = Object.keys(scannedMap).length > 0;
    if (!hasScans) return;
    clearTimeout(saveDebounceRef.current);
    saveDebounceRef.current = setTimeout(() => {
      base44.entities.SalesOrder.update(selectedOrder.id, {
        packing_scanned_map: JSON.stringify(scannedMap),
      }).catch(() => {}); // silent — best-effort background save
    }, 2000);
    return () => clearTimeout(saveDebounceRef.current);
  }, [scannedMap, selectedOrder?.id, packingStartedAt]);
  useEffect(() => { packingStartedAtRef.current = packingStartedAt; }, [packingStartedAt]);
  useEffect(() => { isPausedRef.current = isPaused; }, [isPaused]);

  // ── Scan processing ──
  const processCode = (code) => {
    const trimmed = code.trim().toLowerCase();
    if (!trimmed) return;

    const started = packingStartedAtRef.current;
    const paused = isPausedRef.current;
    const lookup = allProductLookupRef.current;
    const skuSet = orderSkuSetRef.current;
    const items = allPackItemsRef.current;
    const nameMap = skuNameMapRef.current;
    const scanned = scannedMapRef.current;

    if (!started) {
      setLastScanResult({ type: 'error', message: 'Press "Start Packing" first' });
      triggerFeedback('error');
      return;
    }
    if (paused) {
      setLastScanResult({ type: 'error', message: 'Packing is paused — press Resume first' });
      triggerFeedback('error');
      return;
    }

    const rawLookup = lookup[trimmed];
    if (!rawLookup) {
      setLastScanResult({ type: 'error', message: `Unknown barcode: "${code.trim()}"` });
      triggerFeedback('error');
      return;
    }

    // Disambiguate barcode collisions: if multiple SKUs share the same barcode,
    // pick the one that's actually in this order (via direct or prefix match).
    const skuMapping = productSkuToLineSkuRef.current;
    const candidates = Array.isArray(rawLookup) ? rawLookup : [rawLookup];

    let matchedSku = null;
    for (const candidate of candidates) {
      if (skuSet.has(candidate)) { matchedSku = candidate; break; }
      if (skuMapping[candidate]) { matchedSku = skuMapping[candidate]; break; }
    }

    if (!matchedSku) {
      // Show all candidate names so the user knows what was detected
      const names = candidates.map(c => nameMap[c] || c).filter(Boolean);
      const displayName = names.join(' / ');
      setLastScanResult({ type: 'error', message: `Wrong item — "${displayName}" is not in this order` });
      triggerFeedback('error');
      return;
    }

    const item = items.find(i => i.skuLower === matchedSku);
    const currentCount = scanned[matchedSku] || 0;
    if (item && currentCount >= item.qty) {
      setLastScanResult({ type: 'error', message: `Already scanned all ${item.qty} of ${item.name}` });
      triggerFeedback('error');
      return;
    }

    setScannedMap(prev => ({ ...prev, [matchedSku]: (prev[matchedSku] || 0) + 1 }));
    setLastScanResult({ type: 'success', message: `✓ ${item?.name || matchedSku} (${currentCount + 1}/${item?.qty || '?'})` });
    triggerFeedback('success');
  };

  // HID barcode scanner — uses refs so handler never goes stale
  useEffect(() => {
    if (!selectedOrder) return;
    const handleKeyDown = (e) => {
      const active = document.activeElement;
      if (active && active.tagName === 'INPUT' && active.type !== 'hidden') return;
      if (e.key === 'Enter') {
        e.preventDefault(); // prevent form submission from Enter key
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
        timerRef.current = setTimeout(() => { bufferRef.current = ''; }, 300);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedOrder]);

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
    setScannedMap({});
    segmentStartRef.current = Date.now();
    await base44.entities.SalesOrder.update(selectedOrder.id, {
      status: 'picking',
      picking_started_at: now,
      packing_paused: false,
      packing_duration_seconds: 0,
      packing_scanned_map: '{}',
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
      packing_scanned_map: JSON.stringify(scannedMap),
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
      packing_scanned_map: '',
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

  // Back button — if timer is running (not paused, not finished), prompt first
  const handleBackPress = () => {
    if (packingStartedAt && !isPaused) {
      setShowBackConfirm(true);
      return;
    }
    // Already paused or never started — just exit
    doExit();
  };

  const doExit = async () => {
    setShowBackConfirm(false);
    if (packingStartedAt && selectedOrder) {
      const segSec = getCurrentSegmentSeconds();
      const totalSoFar = accumulatedSeconds + segSec;
      setAccumulatedSeconds(totalSoFar);
      segmentStartRef.current = null;
      setIsPaused(true);
      await base44.entities.SalesOrder.update(selectedOrder.id, {
        packing_paused: true,
        packing_duration_seconds: totalSoFar,
        packing_scanned_map: JSON.stringify(scannedMap),
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
          <button onClick={handleBackPress} className="p-2 -ml-2 rounded-xl hover:bg-muted">
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

            {/* Last scan result banner */}
            <ScanResultBanner result={lastScanResult} onDismiss={() => setLastScanResult(null)} />

            {showCamera && !isPaused && (
              <CameraScanner
                active={showCamera}
                onScan={(code) => {
                  const trimmed = code.trim();
                  if (!trimmed) return;
                  setShowCamera(false);
                  setScanInput('');
                  setTimeout(() => processCode(trimmed), 50);
                }}
                onClose={() => setShowCamera(false)}
              />
            )}
          </>
        )}

        {/* Grouped pack items */}
        {loadingLines ? (
          <div className="flex items-center justify-center py-16 gap-3">
            <div className="w-5 h-5 border-2 border-border border-t-primary rounded-full animate-spin" />
            <span className="text-sm text-muted-foreground">Loading order items…</span>
          </div>
        ) : (
          <>
            <FloorPackList groups={groups} scannedMap={scannedMap} />
            {allPackItems.length === 0 && (
              <div className="text-center py-12 text-sm text-muted-foreground">
                No items found for this order.
              </div>
            )}
          </>
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
        {/* Back confirmation dialog */}
        {showBackConfirm && (
          <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-6">
            <div className="bg-card rounded-2xl shadow-xl p-6 max-w-sm w-full space-y-4">
              <h2 className="text-lg font-bold">Save progress?</h2>
              <p className="text-sm text-muted-foreground">
                The timer is still running. Going back will pause the timer and save your progress so you can resume later.
              </p>
              <div className="flex gap-3">
                <Button
                  variant="outline"
                  className="flex-1 h-12"
                  onClick={() => setShowBackConfirm(false)}
                >
                  Stay
                </Button>
                <Button
                  className="flex-1 h-12 bg-primary"
                  onClick={doExit}
                >
                  Save & Exit
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </FeedbackWrapper>
  );
}