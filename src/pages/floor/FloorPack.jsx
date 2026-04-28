import React, { useState, useMemo, useRef, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { ArrowLeft, Camera, ScanBarcode, CheckCircle2, PackageCheck } from 'lucide-react';
import { toast } from 'sonner';
import FloorOrderPicker from '@/components/floor/FloorOrderPicker';
import FloorPackList from '@/components/floor/FloorPackList';
import CameraScanner from '@/components/floor/CameraScanner';

/**
 * Order Scan & Pack — staff picks an order, scans each item into the box, then marks order packed.
 * Supports both decomposed package components (DecomposedLine) AND standalone items (SalesOrderLine).
 */
export default function FloorPack() {
  const queryClient = useQueryClient();
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [scannedMap, setScannedMap] = useState({}); // { sku_lower: count }
  const [scanInput, setScanInput] = useState('');
  const [showCamera, setShowCamera] = useState(false);
  const [packing, setPacking] = useState(false);
  const bufferRef = useRef('');
  const timerRef = useRef(null);

  // Fetch paid, unfulfilled orders
  const { data: orders = [], isLoading: loadingOrders } = useQuery({
    queryKey: ['floor-pack-orders'],
    queryFn: () => base44.entities.SalesOrder.filter(
      { lifecycle_state: 'paid_unfulfilled' },
      '-order_date',
      50,
    ),
  });

  // Fetch decomposed lines for the selected order (package components)
  const { data: decomposedLines = [] } = useQuery({
    queryKey: ['floor-pack-lines', selectedOrder?.id],
    queryFn: () => base44.entities.DecomposedLine.filter(
      { sales_order_id: selectedOrder.id },
      'meal_sku',
      200,
    ),
    enabled: !!selectedOrder?.id,
  });

  // Fetch SalesOrderLines for standalone items (supplements, solo products)
  const { data: orderLines = [] } = useQuery({
    queryKey: ['floor-pack-order-lines', selectedOrder?.id],
    queryFn: () => base44.entities.SalesOrderLine.filter(
      { sales_order_id: selectedOrder.id },
      'sku',
      200,
    ),
    enabled: !!selectedOrder?.id,
  });

  // Fetch products for SKU/barcode lookup
  const { data: products = [] } = useQuery({
    queryKey: ['floor-products'],
    queryFn: () => base44.entities.Product.filter({ status: 'active' }, 'sku', 2000),
    staleTime: 5 * 60 * 1000,
  });

  // Build unified pack list: decomposed lines + standalone order lines
  // Each item: { key, sku, name, qty, source: 'decomposed'|'order_line', sourceId }
  const packItems = useMemo(() => {
    const items = [];
    const decomposedSkus = new Set();

    // 1) Add all decomposed lines (package component meals)
    decomposedLines.forEach(d => {
      const skuLower = (d.meal_sku || '').toLowerCase();
      decomposedSkus.add(skuLower);
      items.push({
        key: `dl-${d.id}`,
        sku: d.meal_sku || '',
        skuLower,
        name: d.meal_name || d.meal_sku || '',
        qty: d.qty || 0,
        source: 'decomposed',
        sourceId: d.id,
      });
    });

    // 2) Add order lines: package components + standalone items (skip package parents)
    orderLines.forEach(ol => {
      if (ol.is_package_parent) return;           // skip package headers (e.g. MenLeaMus15)
      if (ol.status === 'cancelled') return;
      const skuLower = (ol.sku || '').toLowerCase();
      // Don't duplicate if a decomposed line already covers this SKU
      if (decomposedSkus.has(skuLower)) return;
      items.push({
        key: `sol-${ol.id}`,
        sku: ol.sku || '',
        skuLower,
        name: ol.name || ol.sku || '',
        qty: ol.qty || 0,
        source: 'order_line',
        sourceId: ol.id,
        variantTitle: ol.variant_title,
      });
    });

    return items;
  }, [decomposedLines, orderLines]);

  // Build lookup: barcode/SKU → skuLower (from pack items)
  const lookupMap = useMemo(() => {
    const map = {};
    const skuSet = new Set(packItems.map(i => i.skuLower));
    // Map product barcodes and SKUs to their lowercase SKU
    products.forEach(p => {
      const sku = (p.sku || '').toLowerCase();
      if (skuSet.has(sku)) {
        if (p.barcode) map[p.barcode.toLowerCase()] = sku;
        map[sku] = sku;
      }
    });
    // Also directly map any pack item SKUs (in case product not in catalog)
    packItems.forEach(i => {
      if (!map[i.skuLower]) map[i.skuLower] = i.skuLower;
    });
    return map;
  }, [packItems, products]);

  const processCode = (code) => {
    const trimmed = code.trim().toLowerCase();
    if (!trimmed) return;
    const matchedSku = lookupMap[trimmed];
    if (!matchedSku) {
      toast.error(`"${code.trim()}" not in this order`);
      setShowCamera(false);
      return;
    }
    // Find the pack item and check qty
    const item = packItems.find(i => i.skuLower === matchedSku);
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
  }, [lookupMap, selectedOrder]);

  const totalNeeded = packItems.reduce((s, i) => s + (i.qty || 0), 0);
  const totalScanned = Object.values(scannedMap).reduce((s, v) => s + v, 0);
  const allDone = totalScanned >= totalNeeded && totalNeeded > 0;

  const handleScanSubmit = (e) => {
    e.preventDefault();
    processCode(scanInput);
    setScanInput('');
  };

  const handleMarkPacked = async () => {
    // Final guard — ensure every item is fully scanned
    const incomplete = packItems.find(i => (scannedMap[i.skuLower] || 0) < i.qty);
    if (incomplete) {
      toast.error(`Still need to scan ${incomplete.name} (${scannedMap[incomplete.skuLower] || 0}/${incomplete.qty})`);
      return;
    }

    setPacking(true);

    // Update DecomposedLine packed_qty for decomposed items
    for (const item of packItems.filter(i => i.source === 'decomposed')) {
      const packed = scannedMap[item.skuLower] || 0;
      if (packed > 0) {
        await base44.entities.DecomposedLine.update(item.sourceId, { packed_qty: packed });
      }
    }

    // Update order status to packed
    await base44.entities.SalesOrder.update(selectedOrder.id, {
      status: 'packed',
      packed_at: new Date().toISOString(),
    });

    queryClient.invalidateQueries({ queryKey: ['floor-pack-orders'] });
    toast.success(`Order ${selectedOrder.order_number || selectedOrder.shopify_order_id} marked as packed`);
    setPacking(false);
    setSelectedOrder(null);
    setScannedMap({});
  };

  // Step 1: Order picker
  if (!selectedOrder) {
    return <FloorOrderPicker orders={orders} loading={loadingOrders} onSelect={setSelectedOrder} />;
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button onClick={() => { setSelectedOrder(null); setScannedMap({}); }} className="p-2 -ml-2 rounded-xl hover:bg-muted">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div className="flex-1">
          <h1 className="text-xl font-bold">Pack — {selectedOrder.order_number || selectedOrder.shopify_order_id}</h1>
          <p className="text-xs text-muted-foreground">{selectedOrder.customer_name}</p>
        </div>
        <Badge className="bg-blue-100 text-blue-700 tabular-nums">{totalScanned}/{totalNeeded}</Badge>
      </div>

      {/* Progress bar */}
      <div>
        <div className="w-full bg-muted rounded-full h-3">
          <div
            className="bg-green-500 h-3 rounded-full transition-all duration-300"
            style={{ width: `${totalNeeded ? (totalScanned / totalNeeded) * 100 : 0}%` }}
          />
        </div>
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

      {/* Pack item list */}
      <FloorPackList items={packItems} scannedMap={scannedMap} />

      {packItems.length === 0 && (
        <div className="text-center py-12 text-sm text-muted-foreground">
          No items found for this order.
        </div>
      )}

      {/* Confirm bar — always visible, disabled until all scanned */}
      {packItems.length > 0 && (
        <div className="sticky bottom-0 pb-4 pt-2 bg-gradient-to-t from-background via-background to-transparent">
          <Button
            onClick={handleMarkPacked}
            disabled={packing || !allDone}
            className="w-full h-14 text-base gap-2 bg-green-600 hover:bg-green-700 text-white disabled:opacity-50"
          >
            <PackageCheck className="w-5 h-5" />
            {packing ? 'Saving...' : allDone ? 'Mark Order Packed' : `Scan all items (${totalScanned}/${totalNeeded})`}
          </Button>
        </div>
      )}
    </div>
  );
}