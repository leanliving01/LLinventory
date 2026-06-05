import React, { useState, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44, adjustStockOnHand } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { ClipboardCheck, Search, X, Save, AlertTriangle, Eye, EyeOff, MapPin, Warehouse, Layers } from 'lucide-react';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import HelpDrawer from '@/components/help/HelpDrawer';
import StockTakeCountTable from '@/components/stock-take/StockTakeCountTable';
import StockTakeVarianceReport from '@/components/stock-take/StockTakeVarianceReport';
import ZoneSelector from '@/components/stock-take/ZoneSelector';
import { writeAuditLog } from '@/lib/auditLog';
import { splitLocations, resolveLocation, getCountScopeIds, stockBearingZones } from '@/lib/locationHierarchy';

export default function StockTakeNew() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [productType, setProductType] = useState('finished_meal');
  const [warehouseId, setWarehouseId] = useState('');
  const [zoneId, setZoneId] = useState('');
  const [counts, setCounts] = useState({}); // product_id → counted qty
  const [saving, setSaving] = useState(false);
  const [showUncounted, setShowUncounted] = useState(false);
  const [showAll, setShowAll] = useState(false); // show products not assigned to the selected scope
  const [showVariance, setShowVariance] = useState(false);
  const [varianceData, setVarianceData] = useState([]);

  // All locations (warehouses + zones) so we can present the hierarchy.
  const { data: locations = [] } = useQuery({
    queryKey: ['locations-all'],
    queryFn: () => base44.entities.Location.list('name', 200),
  });

  const { warehouses, zonesByWarehouse } = useMemo(() => splitLocations(locations), [locations]);
  const zonesForWarehouse = warehouseId ? (zonesByWarehouse[warehouseId] || []) : [];

  // The set of stock-on-hand location_ids the current selection covers.
  const scopeIds = useMemo(
    () => getCountScopeIds(warehouseId, zoneId, locations),
    [warehouseId, zoneId, locations]
  );
  const scopeSet = useMemo(() => (scopeIds ? new Set(scopeIds) : null), [scopeIds]);

  const { data: products = [], isLoading } = useQuery({
    queryKey: ['products-stocktake', productType],
    queryFn: () => base44.entities.Product.filter({ type: productType, status: 'active', inventory_tracked: true }, 'name', 500),
  });

  const { data: stockRecords = [] } = useQuery({
    queryKey: ['stock-on-hand'],
    queryFn: () => base44.entities.StockOnHand.list('-updated_date', 2000),
  });

  // Build stock lookup — aggregate qty across every location in the selected scope.
  const stockMap = useMemo(() => {
    const map = {};
    stockRecords.forEach(s => {
      if (!scopeSet || scopeSet.has(s.location_id)) {
        if (!map[s.product_id]) map[s.product_id] = { qty_on_hand: 0, stock_id: s.id };
        map[s.product_id].qty_on_hand += s.qty_on_hand || 0;
        map[s.product_id].stock_id = s.id;
      }
    });
    return map;
  }, [stockRecords, scopeSet]);

  // Products assigned to the selected scope by their default location. When no
  // warehouse/zone is selected (scopeSet null), this matches everything.
  const inScope = useMemo(() => {
    return (p) => {
      if (!scopeSet) return true;
      if (!p.default_location_id) return false;
      const { warehouseId: wh, zoneId: z } = resolveLocation(p.default_location_id, locations);
      // A product counts as in-scope if its zone is in the scope set, or (when
      // only a warehouse is selected) it belongs to that warehouse.
      if (z && scopeSet.has(z)) return true;
      if (!zoneId && wh && wh === warehouseId) return true;
      return scopeSet.has(p.default_location_id);
    };
  }, [scopeSet, locations, warehouseId, zoneId]);

  // Filter products
  const filteredProducts = useMemo(() => {
    let list = products;
    if (scopeSet && !showAll) {
      list = list.filter(inScope);
    }
    if (search) {
      const s = search.toLowerCase();
      list = list.filter(p => p.name.toLowerCase().includes(s) || p.sku?.toLowerCase().includes(s));
    }
    if (showUncounted) {
      list = list.filter(p => counts[p.id] === undefined || counts[p.id] === '');
    }
    return list.slice(0, 50);
  }, [products, search, showUncounted, showAll, scopeSet, inScope, counts]);

  const handleCountChange = (productId, value) => {
    setCounts(prev => ({ ...prev, [productId]: value }));
  };

  const countedCount = Object.entries(counts).filter(([_, v]) => v !== '' && v !== undefined).length;
  const uncountedCount = products.length - countedCount;

  const handleSave = async () => {
    const entries = Object.entries(counts).filter(([_, v]) => v !== '' && v !== undefined);
    if (entries.length === 0) { toast.error('No counts to save'); return; }
    if (!warehouseId) { toast.error('Select a warehouse before saving — adjustments must be applied to a specific location'); return; }
    // Adjustments must land on ONE concrete stock-bearing location: a specific
    // zone, or a warehouse with no stock-bearing sub-zones.
    const warehouseZones = stockBearingZones(warehouseId, locations);
    if (!zoneId && warehouseZones.length > 0) {
      toast.error('Pick a specific zone before saving — this warehouse has multiple zones');
      return;
    }
    const targetLocationId = zoneId || warehouseId;

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
            to_location_id: variance > 0 ? targetLocationId : undefined,
            from_location_id: variance < 0 ? targetLocationId : undefined,
            notes: `Stock take: system ${systemQty}, counted ${counted}, adj ${variance > 0 ? '+' : ''}${variance}`,
          });

          // Atomically apply the variance as a delta (counted - system = adjustment needed)
          await adjustStockOnHand(productId, targetLocationId, variance);
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

      {/* Location selector — Warehouse, then Zone */}
      <div className="bg-card border border-border rounded-xl px-5 py-4 space-y-4">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <MapPin className="w-4 h-4" strokeWidth={1.5} />
          {zoneId
            ? <span>Counting in <span className="font-semibold text-foreground">{locations.find(l => l.id === zoneId)?.name || 'Selected zone'}</span></span>
            : warehouseId
              ? <span>Counting across <span className="font-semibold text-foreground">all zones</span> in <span className="font-semibold text-foreground">{locations.find(l => l.id === warehouseId)?.name || 'warehouse'}</span></span>
              : <span>Counting across <span className="font-semibold text-foreground">all warehouses</span></span>}
        </div>

        {/* Warehouse chips */}
        <div>
          <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">Warehouse</p>
          <div className="flex items-center gap-2 flex-wrap">
            <WarehouseChip
              icon={Layers}
              label="All Warehouses"
              active={!warehouseId}
              onClick={() => { setWarehouseId(''); setZoneId(''); }}
            />
            {warehouses.map(w => (
              <WarehouseChip
                key={w.id}
                icon={Warehouse}
                label={w.name}
                active={warehouseId === w.id}
                onClick={() => { setWarehouseId(w.id); setZoneId(''); }}
              />
            ))}
          </div>
        </div>

        {/* Zone chips — only when a warehouse with zones is selected */}
        {warehouseId && zonesForWarehouse.length > 0 && (
          <div>
            <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">Zone</p>
            <ZoneSelector
              locations={zonesForWarehouse}
              selectedId={zoneId}
              onSelect={(id) => setZoneId(id || '')}
            />
          </div>
        )}
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

        {scopeSet && (
          <Button
            variant={showAll ? "default" : "outline"}
            size="sm"
            onClick={() => setShowAll(!showAll)}
            className="gap-1.5"
            title="Include products not assigned to the selected location"
          >
            <Layers className="w-3.5 h-3.5" />
            {showAll ? 'In this location' : 'All products'}
          </Button>
        )}

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

function WarehouseChip({ icon: Icon, label, active, onClick }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-all border",
        active
          ? "border-primary bg-primary/10 text-primary shadow-xs"
          : "border-border bg-card text-muted-foreground hover:border-primary/40 hover:text-foreground"
      )}
    >
      <span className={cn("w-6 h-6 rounded-md flex items-center justify-center shrink-0", active ? 'bg-primary/15' : 'bg-muted')}>
        <Icon className={cn("w-3.5 h-3.5", active ? 'text-primary' : 'text-muted-foreground')} strokeWidth={1.5} />
      </span>
      <span className="truncate max-w-[160px]">{label}</span>
    </button>
  );
}