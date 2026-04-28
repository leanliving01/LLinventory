import React, { useState, useMemo, useRef, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { ArrowLeft, Camera, ScanBarcode, PackageCheck } from 'lucide-react';
import { toast } from 'sonner';
import FloorOrderPicker from '@/components/floor/FloorOrderPicker';
import FloorPackList from '@/components/floor/FloorPackList';
import FloorPackTimer from '@/components/floor/FloorPackTimer';
import CameraScanner from '@/components/floor/CameraScanner';

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
  // BYO detection
  if (/byo/i.test(sku) || /build.your.own/i.test(name || '')) return 'Build Your Own';
  return name || sku;
}

export default function FloorPack() {
  const queryClient = useQueryClient();
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [scannedMap, setScannedMap] = useState({});
  const [scanInput, setScanInput] = useState('');
  const [showCamera, setShowCamera] = useState(false);
  const [packing, setPacking] = useState(false);
  const [packingStartedAt, setPackingStartedAt] = useState(null);
  const bufferRef = useRef('');
  const timerRef = useRef(null);

  const { data: orders = [], isLoading: loadingOrders } = useQuery({
    queryKey: ['floor-pack-orders'],
    queryFn: () => base44.entities.SalesOrder.filter(
      { lifecycle_state: 'paid_unfulfilled' },
      '-order_date',
      50,
    ),
  });

  // All SalesOrderLines for the selected order
  const { data: orderLines = [] } = useQuery({
    queryKey: ['floor-pack-order-lines', selectedOrder?.id],
    queryFn: () => base44.entities.SalesOrderLine.filter(
      { sales_order_id: selectedOrder.id },
      'sku',
      200,
    ),
    enabled: !!selectedOrder?.id,
  });

  // Products for barcode lookup
  const { data: products = [] } = useQuery({
    queryKey: ['floor-products'],
    queryFn: () => base44.entities.Product.filter({ status: 'active' }, 'sku', 2000),
    staleTime: 5 * 60 * 1000,
  });

  // ── Build grouped pack list ──
  // Step 1: Identify parent lines (is_package_parent) and their children
  // Step 2: Group children under parent; standalone items go into their own group
  const groups = useMemo(() => {
    const parentLines = orderLines.filter(ol => ol.is_package_parent);
    const componentLines = orderLines.filter(ol => ol.is_package_component && !ol.is_package_parent && ol.status !== 'cancelled');
    const standaloneLines = orderLines.filter(ol => !ol.is_package_parent && !ol.is_package_component && ol.status !== 'cancelled');

    const result = [];

    // Group components under each parent
    parentLines.forEach(parent => {
      const children = componentLines.filter(c => c.parent_line_id === parent.id);
      if (children.length === 0) return;
      result.push({
        groupKey: `pkg-${parent.id}`,
        label: friendlyPackageName(parent.sku, parent.name),
        subtitle: `${parent.sku} · ${children.reduce((s, c) => s + (c.qty || 0), 0)} meals`,
        items: children.map(c => ({
          key: `sol-${c.id}`,
          sku: c.sku || '',
          skuLower: (c.sku || '').toLowerCase(),
          name: c.name || c.sku || '',
          qty: c.qty || 0,
          source: 'order_line',
          sourceId: c.id,
        })),
      });
    });

    // Orphaned components (parent not found) — shouldn't happen but safety net
    const parentIds = new Set(parentLines.map(p => p.id));
    const orphans = componentLines.filter(c => !parentIds.has(c.parent_line_id));
    if (orphans.length > 0) {
      result.push({
        groupKey: 'orphan',
        label: 'Package Items',
        subtitle: null,
        items: orphans.map(c => ({
          key: `sol-${c.id}`,
          sku: c.sku || '',
          skuLower: (c.sku || '').toLowerCase(),
          name: c.name || c.sku || '',
          qty: c.qty || 0,
          source: 'order_line',
          sourceId: c.id,
        })),
      });
    }

    // Standalone items — split BYO meals vs true standalone (supplements, shakes)
    const byoLines = standaloneLines.filter(ol => ol.line_type === 'byo' || (ol.portion_weight_g && !ol.variant_title));
    const trueStandalone = standaloneLines.filter(ol => !byoLines.includes(ol));

    if (byoLines.length > 0) {
      const totalMeals = byoLines.reduce((s, ol) => s + (ol.qty || 0), 0);
      result.push({
        groupKey: 'byo',
        label: 'Build Your Own',
        subtitle: `${totalMeals} meals · 300g portions`,
        items: byoLines.map(ol => ({
          key: `sol-${ol.id}`,
          sku: ol.sku || '',
          skuLower: (ol.sku || '').toLowerCase(),
          name: ol.name || ol.sku || '',
          qty: ol.qty || 0,
          source: 'order_line',
          sourceId: ol.id,
        })),
      });
    }

    if (trueStandalone.length > 0) {
      result.push({
        groupKey: 'standalone',
        label: 'Standalone Items',
        subtitle: null,
        items: trueStandalone.map(ol => ({
          key: `sol-${ol.id}`,
          sku: ol.sku || '',
          skuLower: (ol.sku || '').toLowerCase(),
          name: ol.name || ol.sku || '',
          qty: ol.qty || 0,
          source: 'order_line',
          sourceId: ol.id,
          variantTitle: ol.variant_title,
        })),
      });
    }

    return result;
  }, [orderLines]);

  // Flat items for scanning
  const allPackItems = useMemo(() => groups.flatMap(g => g.items), [groups]);

  // Barcode/SKU lookup map
  const lookupMap = useMemo(() => {
    const map = {};
    const skuSet = new Set(allPackItems.map(i => i.skuLower));
    products.forEach(p => {
      const sku = (p.sku || '').toLowerCase();
      if (skuSet.has(sku)) {
        if (p.barcode) map[p.barcode.toLowerCase()] = sku;
        map[sku] = sku;
      }
    });
    allPackItems.forEach(i => { if (!map[i.skuLower]) map[i.skuLower] = i.skuLower; });
    return map;
  }, [allPackItems, products]);

  const processCode = (code) => {
    const trimmed = code.trim().toLowerCase();
    if (!trimmed) return;
    if (!packingStartedAt) {
      toast.error('Press "Start Packing" first');
      setShowCamera(false);
      return;
    }
    const matchedSku = lookupMap[trimmed];
    if (!matchedSku) {
      toast.error(`"${code.trim()}" not in this order`);
      setShowCamera(false);
      return;
    }
    const item = allPackItems.find(i => i.skuLower === matchedSku);
    const currentCount = scannedMap[matchedSku] || 0;
    if (item && currentCount >= item.qty) {
      toast.warning(`Already scanned all ${item.qty} of ${item.name}`);
      setShowCamera(false);
      return;
    }
    setScannedMap(prev => ({ ...prev, [matchedSku]: (prev[matchedSku] || 0) + 1 }));
    toast.success(`Packed: ${item?.name || matchedSku} (${currentCount + 1}/${item?.qty || '?'})`);
    setShowCamera(false);
  };

  // HID barcode scanner listener
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
  }, [lookupMap, selectedOrder, packingStartedAt]);

  const totalNeeded = allPackItems.reduce((s, i) => s + (i.qty || 0), 0);
  const totalScanned = Object.values(scannedMap).reduce((s, v) => s + v, 0);
  const allDone = totalScanned >= totalNeeded && totalNeeded > 0;

  const handleScanSubmit = (e) => {
    e.preventDefault();
    processCode(scanInput);
    setScanInput('');
  };

  const handleStartPacking = async () => {
    const now = new Date().toISOString();
    setPackingStartedAt(now);
    await base44.entities.SalesOrder.update(selectedOrder.id, {
      status: 'picking',
      picking_started_at: now,
    });
    toast.success('Packing started — scan items!');
  };

  const handleFinishPacking = async () => {
    const incomplete = allPackItems.find(i => (scannedMap[i.skuLower] || 0) < i.qty);
    if (incomplete) {
      toast.error(`Still need to scan ${incomplete.name} (${scannedMap[incomplete.skuLower] || 0}/${incomplete.qty})`);
      return;
    }
    setPacking(true);
    const now = new Date().toISOString();
    await base44.entities.SalesOrder.update(selectedOrder.id, {
      status: 'packed',
      packed_at: now,
    });
    queryClient.invalidateQueries({ queryKey: ['floor-pack-orders'] });
    toast.success(`Order ${selectedOrder.order_number || selectedOrder.shopify_order_id} packed!`);
    setPacking(false);
    setSelectedOrder(null);
    setScannedMap({});
    setPackingStartedAt(null);
  };

  // Step 1: Order picker
  if (!selectedOrder) {
    return <FloorOrderPicker orders={orders} loading={loadingOrders} onSelect={setSelectedOrder} />;
  }

  return (
    <div className="space-y-4 pb-24">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button onClick={() => { setSelectedOrder(null); setScannedMap({}); setPackingStartedAt(null); }} className="p-2 -ml-2 rounded-xl hover:bg-muted">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div className="flex-1">
          <h1 className="text-xl font-bold">Pack — {selectedOrder.order_number || selectedOrder.shopify_order_id}</h1>
          <p className="text-xs text-muted-foreground">{selectedOrder.customer_name}</p>
        </div>
        <Badge className="bg-blue-100 text-blue-700 tabular-nums">{totalScanned}/{totalNeeded}</Badge>
      </div>

      {/* Timer */}
      <FloorPackTimer
        startedAt={packingStartedAt}
        onStart={handleStartPacking}
        disabled={allPackItems.length === 0}
      />

      {/* Progress bar */}
      {packingStartedAt && (
        <>
          <div className="w-full bg-muted rounded-full h-3">
            <div
              className="bg-green-500 h-3 rounded-full transition-all duration-300"
              style={{ width: `${totalNeeded ? (totalScanned / totalNeeded) * 100 : 0}%` }}
            />
          </div>

          {/* Scanner */}
          <form onSubmit={handleScanSubmit} className="flex gap-2">
            <div className="relative flex-1">
              <ScanBarcode className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
              <Input
                value={scanInput}
                onChange={e => setScanInput(e.target.value)}
                placeholder="Scan meal barcode..."
                className="h-14 text-lg font-mono pl-11"
                autoFocus
              />
            </div>
            <Button type="button" variant="outline" className="h-14 w-14 shrink-0" onClick={() => setShowCamera(true)}>
              <Camera className="w-6 h-6" />
            </Button>
          </form>

          {showCamera && (
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

      {/* Finish bar — only visible after packing started */}
      {packingStartedAt && allPackItems.length > 0 && (
        <div className="fixed bottom-[68px] left-0 right-0 px-4 pb-4 pt-2 bg-gradient-to-t from-background via-background to-transparent z-30">
          <Button
            onClick={handleFinishPacking}
            disabled={packing || !allDone}
            className="w-full h-14 text-base gap-2 bg-green-600 hover:bg-green-700 text-white disabled:opacity-50"
          >
            <PackageCheck className="w-5 h-5" />
            {packing ? 'Saving...' : allDone ? 'Finish Packing' : `Scan all items (${totalScanned}/${totalNeeded})`}
          </Button>
        </div>
      )}
    </div>
  );
}