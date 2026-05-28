import React, { useState, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44, adjustStockOnHand } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { ClipboardCheck, Search, X, Save, AlertTriangle, Eye, EyeOff, MapPin } from 'lucide-react';
import { format } from 'date-fns';
import { toast } from 'sonner';
import HelpDrawer from '@/components/help/HelpDrawer';
import StockTakeCountTable from '@/components/stock-take/StockTakeCountTable';
import StockTakeVarianceReport from '@/components/stock-take/StockTakeVarianceReport';
import ZoneSelector from '@/components/stock-take/ZoneSelector';
import { writeAuditLog } from '@/lib/auditLog';

export default function StockTakeNew() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [productType, setProductType] = useState('finished_meal');
  const [locationId, setLocationId] = useState('');
  const [counts, setCounts] = useState({}); // product_id → counted qty
  const [saving, setSaving] = useState(false);
  const [showUncounted, setShowUncounted] = useState(false);
  const [showVariance, setShowVariance] = useState(false);
  const [varianceData, setVarianceData] = useState([]);

  const { data: locations = [] } = useQuery({
    queryKey: ['locations'],
    queryFn: () => base44.entities.Location.filter({ is_stock_bearing: true }, 'name', 50),
  });

  const { data: products = [], isLoading } = useQuery({
    queryKey: ['products-stocktake', productType],
    queryFn: () => base44.entities.Product.filter({ type: productType, status: 'active' }, 'name', 500),
  });

  const { data: stockRecords = [] } = useQuery({
    queryKey: ['stock-on-hand'],
    queryFn: () => base44.entities.StockOnHand.list('-updated_date', 2000),
  });

  // Build stock lookup
  const stockMap = useMemo(() => {
    const map = {};
    stockRecords.forEach(s => {
      const key = locationId ? `${s.product_id}_${s.location_id}` : s.product_id;
      if (!locationId || s.location_id === locationId) {
        if (!map[s.product_id]) map[s.product_id] = { qty_on_hand: 0, stock_id: s.id };
        map[s.product_id].qty_on_hand += s.qty_on_hand || 0;
        map[s.product_id].stock_id = s.id;
      }
    });
    return map;
  }, [stockRecords, locationId]);

  // Filter products
  const filteredProducts = useMemo(() => {
    let list = products;
    if (search) {
      const s = search.toLowerCase();
      list = list.filter(p => p.name.toLowerCase().includes(s) || p.sku?.toLowerCase().includes(s));
    }
    if (showUncounted) {
      list = list.filter(p => counts[p.id] === undefined || counts[p.id] === '');
    }
    return list.slice(0, 50);
  }, [products, search, showUncounted, counts]);

  const handleCountChange = (productId, value) => {
    setCounts(prev => ({ ...prev, [productId]: value }));
  };

  const countedCount = Object.entries(counts).filter(([_, v]) => v !== '' && v !== undefined).length;
  const uncountedCount = products.length - countedCount;

  const handleSave = async () => {
    const entries = Object.entries(counts).filter(([_, v]) => v !== '' && v !== undefined);
    if (entries.length === 0) { toast.error('No counts to save'); return; }
    if (!locationId) { toast.error('Select a location before saving — adjustments must be applied to a specific location'); return; }

    setSaving(true);

    try {
      const varianceRows = [];

      for (const [productId, countedStr] of entries) {
        const counted = Number(countedStr);
        const product = products.find(p => p.id === productId);
        const systemQty = stockMap[productId]?.qty_on_hand || 0;
        const variance = counted - systemQty;

        varianceRows.push({
          product_id: productId,
          product_sku: product?.sku || '',
          product_name: product?.name || '',
          system_qty: systemQty,
          counted_qty: counted,
          variance,
          uom: product?.stock_uom || 'pcs',
        });

        if (variance !== 0) {
          // Create adjustment movement
          await base44.entities.StockMovement.create({
            product_id: productId,
            product_sku: product?.sku || '',
            product_name: product?.name || '',
            qty: Math.abs(variance),
            uom: product?.stock_uom || 'pcs',
            reason: 'stocktake_adjustment',
            ref_type: 'stock_take',
            ref_number: `Count ${format(new Date(), 'dd MMM yyyy')}`,
            to_location_id: variance > 0 ? (locationId || undefined) : undefined,
            from_location_id: variance < 0 ? (locationId || undefined) : undefined,
            notes: `Stock take: system ${systemQty}, counted ${counted}, adj ${variance > 0 ? '+' : ''}${variance}`,
          });

          // Atomically apply the variance as a delta (counted - system = adjustment needed)
          if (locationId) {
            await adjustStockOnHand(productId, locationId, variance);
          }
        }
      }

      const adjustments = varianceRows.filter(r => r.variance !== 0);
      queryClient.invalidateQueries({ queryKey: ['stock-on-hand'] });
      writeAuditLog({
        action: 'create',
        entity_type: 'StockMovement',
        description: `Stock take: ${entries.length} products counted, ${adjustments.length} adjustments (${productType})`,
      });

      setVarianceData(varianceRows);
      setShowVariance(true);
      toast.success(`Stock take saved — ${adjustments.length} adjustments out of ${entries.length} products`);
    } catch (err) {
      toast.error('Save failed: ' + (err.message || 'Unknown error'));
    } finally {
      setSaving(false);
    }
  };

  if (showVariance) {
    return (
      <StockTakeVarianceReport
        data={varianceData}
        onClose={() => {
          setShowVariance(false);
          setCounts({});
          setVarianceData([]);
        }}
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Stock Take</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {format(new Date(), 'EEEE, dd MMM yyyy')} — count physical stock
          </p>
        </div>
        <div className="flex items-center gap-2">
          <HelpDrawer pageKey="stock-take" />
          <Button onClick={handleSave} disabled={saving || countedCount === 0} className="gap-2" size="lg">
            <Save className="w-5 h-5" />
            {saving ? 'Saving...' : `Save Count (${countedCount})`}
          </Button>
        </div>
      </div>

      {/* Zone selector */}
      <div className="bg-card border border-border rounded-xl px-5 py-4 space-y-3">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <MapPin className="w-4 h-4" strokeWidth={1.5} />
          {locationId
            ? <span>Counting in <span className="font-semibold text-foreground">{locations.find(l => l.id === locationId)?.name || 'Selected zone'}</span></span>
            : <span>Counting across <span className="font-semibold text-foreground">all zones</span></span>}
        </div>
        <ZoneSelector
          locations={locations}
          selectedId={locationId}
          onSelect={(id) => setLocationId(id || '')}
        />
      </div>

      {/* Filters row */}
      <div className="flex items-center gap-4 flex-wrap">
        <Select value={productType} onValueChange={setProductType}>
          <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="finished_meal">Finished Meals</SelectItem>
            <SelectItem value="raw">Raw Materials</SelectItem>
            <SelectItem value="wip_bulk">Bulk Cooked</SelectItem>
            <SelectItem value="sauce">Sauces</SelectItem>
            <SelectItem value="packaging">Packaging</SelectItem>
          </SelectContent>
        </Select>

        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input placeholder="Search products..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
        </div>

        <Button
          variant={showUncounted ? "default" : "outline"}
          size="sm"
          onClick={() => setShowUncounted(!showUncounted)}
          className="gap-1.5"
        >
          {showUncounted ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
          {showUncounted ? 'Show All' : `Uncounted (${uncountedCount})`}
        </Button>

        <div className="flex items-center gap-4 ml-auto">
          <div className="text-center">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold">Counted</p>
            <p className="text-lg font-bold tabular-nums text-status-good">{countedCount}</p>
          </div>
          <div className="text-center">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold">Remaining</p>
            <p className="text-lg font-bold tabular-nums text-status-warn">{uncountedCount}</p>
          </div>
        </div>
      </div>

      {isLoading ? (
        <div className="text-center py-12 text-sm text-muted-foreground">Loading products...</div>
      ) : (
        <StockTakeCountTable
          products={filteredProducts}
          stockMap={stockMap}
          counts={counts}
          onCountChange={handleCountChange}
        />
      )}
    </div>
  );
}