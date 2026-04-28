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
 * Order Scan & Pack — staff picks an order, scans each meal into the box, then marks order packed.
 * One-pass: pick + pack combined in a single scan flow.
 */
export default function FloorPack() {
  const queryClient = useQueryClient();
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [scannedMap, setScannedMap] = useState({}); // { meal_sku: count }
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

  // Fetch decomposed lines for the selected order
  const { data: decomposedLines = [] } = useQuery({
    queryKey: ['floor-pack-lines', selectedOrder?.id],
    queryFn: () => base44.entities.DecomposedLine.filter(
      { sales_order_id: selectedOrder.id },
      'meal_sku',
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

  // Build lookup: barcode/SKU → meal_sku (from decomposed lines)
  const lookupMap = useMemo(() => {
    const map = {};
    const mealSkus = new Set(decomposedLines.map(d => d.meal_sku?.toLowerCase()));
    products.forEach(p => {
      const sku = (p.sku || '').toLowerCase();
      if (mealSkus.has(sku)) {
        if (p.barcode) map[p.barcode.toLowerCase()] = sku;
        map[sku] = sku;
      }
    });
    return map;
  }, [decomposedLines, products]);

  const processCode = (code) => {
    const trimmed = code.trim().toLowerCase();
    if (!trimmed) return;
    const mealSku = lookupMap[trimmed];
    if (!mealSku) {
      toast.error(`"${code.trim()}" not in this order`);
      setShowCamera(false);
      return;
    }
    // Check if we still need more of this SKU
    const line = decomposedLines.find(d => d.meal_sku?.toLowerCase() === mealSku);
    const currentCount = scannedMap[mealSku] || 0;
    if (line && currentCount >= line.qty) {
      toast.warning(`Already scanned all ${line.qty} of ${line.meal_name || mealSku}`);
      setShowCamera(false);
      return;
    }
    setScannedMap(prev => ({ ...prev, [mealSku]: (prev[mealSku] || 0) + 1 }));
    toast.success(`Packed: ${line?.meal_name || mealSku} (${currentCount + 1}/${line?.qty || '?'})`);
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

  const totalNeeded = decomposedLines.reduce((s, d) => s + (d.qty || 0), 0);
  const totalScanned = Object.values(scannedMap).reduce((s, v) => s + v, 0);
  const allDone = totalScanned >= totalNeeded && totalNeeded > 0;

  const handleScanSubmit = (e) => {
    e.preventDefault();
    processCode(scanInput);
    setScanInput('');
  };

  const handleMarkPacked = async () => {
    setPacking(true);

    // Update DecomposedLine packed_qty
    for (const line of decomposedLines) {
      const packed = scannedMap[line.meal_sku?.toLowerCase()] || 0;
      if (packed > 0) {
        await base44.entities.DecomposedLine.update(line.id, { packed_qty: packed });
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

      {/* Meal list */}
      <FloorPackList items={decomposedLines} scannedMap={scannedMap} />

      {decomposedLines.length === 0 && (
        <div className="text-center py-12 text-sm text-muted-foreground">
          No decomposed meal lines found for this order.
        </div>
      )}

      {/* Confirm FAB */}
      {allDone && (
        <div className="sticky bottom-0 pb-4 pt-2 bg-gradient-to-t from-background via-background to-transparent">
          <Button
            onClick={handleMarkPacked}
            disabled={packing}
            className="w-full h-14 text-base gap-2 bg-green-600 hover:bg-green-700 text-white"
          >
            <PackageCheck className="w-5 h-5" />
            {packing ? 'Saving...' : 'Mark Order Packed'}
          </Button>
        </div>
      )}
    </div>
  );
}