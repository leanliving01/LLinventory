import React, { useState, useMemo, useEffect, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  ClipboardCheck, Save, Search, ArrowLeft, Check, AlertTriangle, ScanBarcode, Camera,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { format } from 'date-fns';
import FloorZonePicker from '@/components/floor/FloorZonePicker';
import FloorCountList from '@/components/floor/FloorCountList';
import CameraScanner from '@/components/floor/CameraScanner';
import { buildMealGrouping } from '@/lib/mealGroupingUtil';

/**
 * §1D — Floor Stock Take
 * Step 1: Pick zone
 * Step 2: Pick product type (finished_meal, raw, wip_bulk, etc.)
 * Step 3: Count products in that zone — scan or tap → enter qty
 * Step 4: Save — creates StockMovement adjustments + updates StockOnHand
 */
export default function FloorStockTake() {
  const queryClient = useQueryClient();
  const [zone, setZone] = useState(null);
  const [productType, setProductType] = useState('finished_meal');
  const [counts, setCounts] = useState({});
  const [saving, setSaving] = useState(false);
  const [showResult, setShowResult] = useState(false);
  const [varianceRows, setVarianceRows] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [showCamera, setShowCamera] = useState(false);
  const [highlightId, setHighlightId] = useState(null);

  const { data: allProducts = [] } = useQuery({
    queryKey: ['floor-products-count', productType],
    queryFn: () => base44.entities.Product.filter({ type: productType, status: 'active' }, 'name', 500),
    enabled: !!zone,
  });

  const { data: packBoms = [] } = useQuery({
    queryKey: ['floor-pack-boms'],
    queryFn: () => base44.entities.PackBom.filter({ active: true }, 'package_sku', 100),
    enabled: !!zone && productType === 'finished_meal',
    staleTime: 5 * 60 * 1000,
  });

  // For finished meals: only show products that appear in an active PackBom
  // Also build package-based grouping
  const { products, mealGroupMap } = useMemo(() => {
    if (productType !== 'finished_meal' || packBoms.length === 0) {
      return { products: allProducts, mealGroupMap: null };
    }
    const { groupMap, validSkus } = buildMealGrouping(packBoms);
    const filtered = allProducts.filter(p => p.sku && validSkus.has(p.sku));
    return { products: filtered, mealGroupMap: groupMap };
  }, [allProducts, packBoms, productType]);

  const { data: stockRecords = [] } = useQuery({
    queryKey: ['floor-stock-count'],
    queryFn: () => base44.entities.StockOnHand.list('-updated_date', 2000),
    enabled: !!zone,
  });

  const stockMap = useMemo(() => {
    const map = {};
    stockRecords.forEach(s => {
      if (!zone || s.location_id === zone.id) {
        if (!map[s.product_id]) map[s.product_id] = { qty_on_hand: 0, stock_id: s.id };
        map[s.product_id].qty_on_hand += s.qty_on_hand || 0;
        map[s.product_id].stock_id = s.id;
      }
    });
    return map;
  }, [stockRecords, zone]);

  // Filter products by search
  const filteredProducts = useMemo(() => {
    let list = products;
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      list = list.filter(p =>
        p.name.toLowerCase().includes(q) ||
        (p.sku && p.sku.toLowerCase().includes(q)) ||
        (p.barcode && p.barcode.toLowerCase() === q)
      );
    }
    return list;
  }, [products, searchQuery]);

  const countedCount = Object.entries(counts).filter(([_, v]) => v !== '' && v !== undefined).length;

  // HID barcode scanner
  const bufferRef = useRef('');
  const timerRef = useRef(null);
  const productsRef = useRef(products);
  productsRef.current = products;

  // Barcode scan → scroll to product + highlight
  const handleBarcodeScan = (code) => {
    const trimmed = code.trim().toLowerCase();
    const found = productsRef.current.find(p =>
      (p.barcode && p.barcode.toLowerCase() === trimmed) ||
      (p.sku && p.sku.toLowerCase() === trimmed)
    );
    if (found) {
      setHighlightId(found.id);
      setSearchQuery('');
      toast.success(`Found: ${found.name}`);
      // Briefly show the SKU as search filter so the item is visible, then clear
      setSearchQuery(found.sku || '');
      setTimeout(() => { setSearchQuery(''); setHighlightId(null); }, 3000);
    } else {
      toast.error(`No match for "${code.trim()}"`);
    }
    setShowCamera(false);
  };

  useEffect(() => {
    if (!zone) return;
    const handleKeyDown = (e) => {
      if (document.activeElement?.tagName === 'INPUT') return;
      if (e.key === 'Enter') {
        e.preventDefault();
        if (bufferRef.current.length > 3) handleBarcodeScan(bufferRef.current);
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
  }, [zone]);

  const handleSave = async () => {
    const entries = Object.entries(counts).filter(([_, v]) => v !== '' && v !== undefined);
    if (entries.length === 0) { toast.error('No counts to save'); return; }
    setSaving(true);

    const rows = [];
    for (const [productId, countedStr] of entries) {
      const counted = Number(countedStr);
      const product = products.find(p => p.id === productId);
      const systemQty = stockMap[productId]?.qty_on_hand || 0;
      const variance = counted - systemQty;
      rows.push({ product, systemQty, counted, variance });

      if (variance !== 0) {
        await base44.entities.StockMovement.create({
          product_id: productId,
          product_sku: product?.sku || '',
          product_name: product?.name || '',
          qty: Math.abs(variance),
          uom: product?.stock_uom || 'pcs',
          reason: 'stocktake_adjustment',
          ref_type: 'stock_take',
          ref_number: `Count ${format(new Date(), 'dd MMM')} — ${zone.name}`,
          to_location_id: variance > 0 ? zone.id : undefined,
          from_location_id: variance < 0 ? zone.id : undefined,
          notes: `Floor stock take: system ${systemQty}, counted ${counted}, adj ${variance > 0 ? '+' : ''}${variance}`,
        });

        const existing = stockRecords.find(s => s.product_id === productId && s.location_id === zone.id);
        if (existing) {
          await base44.entities.StockOnHand.update(existing.id, {
            qty_on_hand: counted,
            qty_available: counted - (existing.qty_committed || 0),
            last_updated_at: new Date().toISOString(),
          });
        } else if (counted > 0) {
          await base44.entities.StockOnHand.create({
            product_id: productId,
            product_sku: product?.sku || '',
            product_name: product?.name || '',
            location_id: zone.id,
            location_name: zone.name,
            qty_on_hand: counted,
            qty_committed: 0,
            qty_available: counted,
            uom: product?.stock_uom || 'pcs',
            last_updated_at: new Date().toISOString(),
          });
        }
      }
    }

    queryClient.invalidateQueries({ queryKey: ['floor-stock-count'] });
    const adjustments = rows.filter(r => r.variance !== 0);
    setVarianceRows(rows);
    setShowResult(true);
    toast.success(`${entries.length} counted, ${adjustments.length} adjustments saved`);
    setSaving(false);
  };

  // Step 0: Zone picker
  if (!zone) {
    return <FloorZonePicker title="Stock Count" subtitle="Select zone to count" onSelect={setZone} />;
  }

  // Variance result view
  if (showResult) {
    const adjustments = varianceRows.filter(r => r.variance !== 0);
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => { setShowResult(false); setCounts({}); setZone(null); }}>
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <h1 className="text-xl font-bold">Count Complete</h1>
        </div>
        <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-2xl p-4 text-center">
          <Check className="w-10 h-10 text-green-600 mx-auto mb-2" />
          <p className="font-semibold text-green-800 dark:text-green-300">{varianceRows.length} products counted</p>
          <p className="text-sm text-green-600 dark:text-green-400">{adjustments.length} adjustments applied</p>
        </div>
        {adjustments.length > 0 && (
          <div className="bg-card border border-border rounded-2xl divide-y divide-border">
            <div className="px-4 py-2.5">
              <p className="text-xs font-semibold text-muted-foreground uppercase">Variances</p>
            </div>
            {adjustments.map(r => (
              <div key={r.product.id} className="px-4 py-3 flex items-center justify-between">
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{r.product.name}</p>
                  <p className="text-xs text-muted-foreground">System: {r.systemQty} → Counted: {r.counted}</p>
                </div>
                <Badge className={cn("text-xs", r.variance > 0 ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700")}>
                  {r.variance > 0 ? '+' : ''}{r.variance}
                </Badge>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  // Step 1: Count view
  return (
    <div className="space-y-4 pb-24">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => { setZone(null); setCounts({}); }}>
          <ArrowLeft className="w-5 h-5" />
        </Button>
        <div className="flex-1 min-w-0">
          <h1 className="text-lg font-bold truncate">Count — {zone.name}</h1>
          <p className="text-xs text-muted-foreground">{format(new Date(), 'dd MMM yyyy')} · {countedCount} counted</p>
        </div>
      </div>

      {/* Type selector + search */}
      <div className="flex gap-2">
        <Select value={productType} onValueChange={v => { setProductType(v); setCounts({}); }}>
          <SelectTrigger className="h-10 flex-1">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="finished_meal">Finished Meals</SelectItem>
            <SelectItem value="raw">Raw Materials</SelectItem>
            <SelectItem value="wip_bulk">Bulk Cooked</SelectItem>
            <SelectItem value="sauce">Sauces</SelectItem>
            <SelectItem value="packaging">Packaging</SelectItem>
          </SelectContent>
        </Select>
        <Button variant="outline" className="h-10 w-10 shrink-0" onClick={() => setShowCamera(true)}>
          <Camera className="w-5 h-5" />
        </Button>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          placeholder="Search products..."
          className="pl-9 h-10"
        />
      </div>

      {showCamera && (
        <CameraScanner active={showCamera} onScan={handleBarcodeScan} onClose={() => setShowCamera(false)} />
      )}

      {/* Count list */}
      <FloorCountList
        products={filteredProducts}
        stockMap={stockMap}
        counts={counts}
        onCountChange={(id, val) => setCounts(prev => ({ ...prev, [id]: val }))}
        groupMap={mealGroupMap}
      />

      {/* Sticky save bar */}
      <div className="fixed bottom-[68px] left-0 right-0 bg-card/95 backdrop-blur border-t border-border px-4 py-3 z-30">
        <Button
          onClick={handleSave}
          disabled={saving || countedCount === 0}
          className="w-full h-12 text-base gap-2"
          size="lg"
        >
          <Save className="w-5 h-5" />
          {saving ? 'Saving...' : `Save Count (${countedCount} items)`}
        </Button>
      </div>
    </div>
  );
}