import React, { useState, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { DollarSign, RefreshCw, Loader2, Search, X, Layers } from 'lucide-react';
import { toast } from 'sonner';
import PageHelp from '@/components/help/PageHelp';
import { useAuth } from '@/lib/AuthContext';
import { getUserPermissions } from '@/lib/permissions';
import { useCustomRoles } from '@/components/settings/CustomRolesManager';
import FoodCostKPIStrip from '@/components/food-cost/FoodCostKPIStrip';
import FoodCostLayerTable from '@/components/food-cost/FoodCostLayerTable';

const HELP_ITEMS = [
  { title: 'Three-layer cost cascade', text: 'Costs roll up from raw materials → Cook BOM (bulk WIP cost/kg) → Portion BOM (per-meal cost) → Pack BOM (per-package cost). Each layer uses the output cost of the previous one.' },
  { title: 'Run Cost Rollup', text: 'Clicking "Run Cost Rollup" recalculates all product cost_avg values through the 3 BOM layers based on current raw material costs. Admin only.' },
  { title: 'Margin analysis', text: 'For sellable products, margin = (price − cost_avg) / price. Red flags items with margins below 30%.' },
];

export default function FoodCostDashboard() {
  const { user } = useAuth();
  const customRoles = useCustomRoles();
  const perms = getUserPermissions(user || {}, customRoles);
  const queryClient = useQueryClient();
  const [rolling, setRolling] = useState(false);
  const [rollResult, setRollResult] = useState(null);
  const [search, setSearch] = useState('');
  const [activeLayer, setActiveLayer] = useState('all');

  const { data: products = [], isLoading } = useQuery({
    queryKey: ['fc-products'],
    queryFn: () => base44.entities.Product.filter({ status: 'active' }, 'name', 1000),
  });

  const { data: boms = [] } = useQuery({
    queryKey: ['fc-boms'],
    queryFn: () => base44.entities.Bom.filter({ is_active: true }, '-created_date', 500),
  });

  const { data: components = [] } = useQuery({
    queryKey: ['fc-components'],
    queryFn: () => base44.entities.BomComponent.list('-created_date', 5000),
  });

  const handleRollup = async () => {
    setRolling(true);
    setRollResult(null);
    try {
      const res = await base44.functions.invoke('costRollup', {});
      setRollResult(res.data);
      toast.success(`Cost rollup complete — ${res.data?.updated || 0} products updated`);
      queryClient.invalidateQueries({ queryKey: ['fc-products'] });
    } catch (err) {
      toast.error(`Rollup failed: ${err.message}`);
    } finally {
      setRolling(false);
    }
  };

  // Build product map
  const productMap = useMemo(() => {
    const m = {};
    products.forEach(p => { m[p.id] = p; });
    return m;
  }, [products]);

  // Group BOMs by type with cost data
  const layerData = useMemo(() => {
    const compsByBom = {};
    components.forEach(c => {
      if (!compsByBom[c.bom_id]) compsByBom[c.bom_id] = [];
      compsByBom[c.bom_id].push(c);
    });

    const buildLayer = (type) => {
      return boms
        .filter(b => b.bom_type === type)
        .map(bom => {
          const output = productMap[bom.product_id];
          if (!output) return null;

          const comps = compsByBom[bom.id] || [];
          let inputCost = 0;
          comps.forEach(c => {
            if (c.is_consumable) return;
            const inp = productMap[c.input_product_id];
            if (inp) inputCost += (inp.cost_avg || 0) * c.qty;
          });

          const yieldQty = bom.yield_qty || 1;
          const calculatedCost = inputCost / yieldQty;
          const currentCost = output.cost_avg || 0;
          const price = output.price || 0;
          const margin = price > 0 ? ((price - currentCost) / price) * 100 : null;

          return {
            bomId: bom.id,
            sku: output.sku,
            name: output.name || bom.product_name,
            type: output.type,
            costAvg: currentCost,
            calculatedCost: Math.round(calculatedCost * 100) / 100,
            price,
            margin,
            sellable: output.sellable,
            inputCount: comps.filter(c => !c.is_consumable).length,
            uom: bom.yield_uom || output.stock_uom,
          };
        })
        .filter(Boolean);
    };

    return {
      cook: buildLayer('cook'),
      portion: buildLayer('portion'),
      pack: buildLayer('pack'),
    };
  }, [boms, components, productMap]);

  // KPIs
  const kpis = useMemo(() => {
    const allSellable = products.filter(p => p.sellable && (p.price || 0) > 0 && (p.cost_avg || 0) > 0);
    const avgMargin = allSellable.length > 0
      ? allSellable.reduce((s, p) => s + ((p.price - p.cost_avg) / p.price) * 100, 0) / allSellable.length
      : 0;
    const lowMarginCount = allSellable.filter(p => ((p.price - p.cost_avg) / p.price) * 100 < 30).length;
    const zeroCostCount = products.filter(p => (p.cost_avg || 0) === 0 && ['raw', 'wip_bulk', 'finished_meal', 'package'].includes(p.type)).length;

    return {
      cookBomCount: layerData.cook.length,
      portionBomCount: layerData.portion.length,
      packBomCount: layerData.pack.length,
      avgMargin: Math.round(avgMargin * 10) / 10,
      lowMarginCount,
      zeroCostCount,
      totalSellable: allSellable.length,
    };
  }, [products, layerData]);

  // Filter
  const filteredData = useMemo(() => {
    const filterList = (list) => {
      if (!search) return list;
      const q = search.toLowerCase();
      return list.filter(item => 
        (item.sku || '').toLowerCase().includes(q) ||
        (item.name || '').toLowerCase().includes(q)
      );
    };
    return {
      cook: filterList(layerData.cook),
      portion: filterList(layerData.portion),
      pack: filterList(layerData.pack),
    };
  }, [layerData, search]);

  const LAYER_TABS = [
    { key: 'all', label: 'All Layers' },
    { key: 'cook', label: `Cook (${layerData.cook.length})` },
    { key: 'portion', label: `Portion (${layerData.portion.length})` },
    { key: 'pack', label: `Pack (${layerData.pack.length})` },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Layers className="w-6 h-6 text-primary" /> Food Cost Dashboard
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Cost rollup through Cook → Portion → Pack BOM layers
          </p>
        </div>
        {perms.food_cost_run && (
          <Button onClick={handleRollup} disabled={rolling} className="gap-2">
            {rolling ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            {rolling ? 'Rolling up...' : 'Run Cost Rollup'}
          </Button>
        )}
      </div>

      <PageHelp items={HELP_ITEMS} />

      {/* Rollup result banner */}
      {rollResult && (
        <div className="bg-status-good-subtle border border-status-good/30 rounded-xl px-4 py-3">
          <p className="text-sm font-medium text-status-good">
            Rollup complete — {rollResult.updated} product costs updated
          </p>
          {rollResult.details && rollResult.details.length > 0 && (
            <details className="mt-2">
              <summary className="text-xs text-muted-foreground cursor-pointer">Show {rollResult.details.length} changes</summary>
              <div className="mt-1 max-h-40 overflow-y-auto text-xs font-mono text-muted-foreground space-y-0.5">
                {rollResult.details.map((d, i) => <div key={i}>{d}</div>)}
              </div>
            </details>
          )}
        </div>
      )}

      <FoodCostKPIStrip kpis={kpis} />

      {/* Layer tabs */}
      <div className="flex gap-2 flex-wrap">
        {LAYER_TABS.map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveLayer(tab.key)}
            className={`text-xs px-3 py-1.5 rounded-full font-medium transition-all ${
              activeLayer === tab.key
                ? 'bg-primary/10 text-primary ring-2 ring-primary/30'
                : 'bg-muted text-muted-foreground hover:bg-muted/80'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Search */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input placeholder="Search product or SKU..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
        </div>
        {search && (
          <Button variant="ghost" size="sm" onClick={() => setSearch('')} className="gap-1">
            <X className="w-3.5 h-3.5" /> Clear
          </Button>
        )}
      </div>

      {isLoading ? (
        <div className="text-center py-12 text-sm text-muted-foreground">Loading cost data...</div>
      ) : (
        <div className="space-y-6">
          {(activeLayer === 'all' || activeLayer === 'cook') && filteredData.cook.length > 0 && (
            <FoodCostLayerTable title="Cook BOM — Raw → Bulk Cooked" subtitle="Cost per kg of cooked output" items={filteredData.cook} showMargin={false} />
          )}
          {(activeLayer === 'all' || activeLayer === 'portion') && filteredData.portion.length > 0 && (
            <FoodCostLayerTable title="Portion BOM — Bulk Cooked → Meals" subtitle="Cost per individual portioned meal" items={filteredData.portion} showMargin={true} />
          )}
          {(activeLayer === 'all' || activeLayer === 'pack') && filteredData.pack.length > 0 && (
            <FoodCostLayerTable title="Pack BOM — Meals → Packages" subtitle="Cost per sellable package" items={filteredData.pack} showMargin={true} />
          )}
          {activeLayer !== 'all' && filteredData[activeLayer]?.length === 0 && (
            <div className="text-center py-12 text-sm text-muted-foreground">
              {search ? 'No results match your search.' : 'No BOMs found for this layer.'}
            </div>
          )}
        </div>
      )}
    </div>
  );
}