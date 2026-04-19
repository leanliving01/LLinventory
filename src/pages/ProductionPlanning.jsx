import React, { useState, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Factory, Search } from 'lucide-react';
import { format } from 'date-fns';
import { toast } from 'sonner';
import ProductionTable from '@/components/production/ProductionTable';
import { PACKAGE_TYPES, GOAL_PACKAGE_TYPES, LOW_CARB_PACKAGE_TYPES, groupSkusByMeal } from '@/lib/mealGrouping';

export default function ProductionPlanning() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [overrides, setOverrides] = useState({});
  const [generating, setGenerating] = useState(false);

  const { data: skus = [] } = useQuery({
    queryKey: ['skus'],
    queryFn: () => base44.entities.SKU.list('-sku_code', 200),
  });

  const { data: meals = [] } = useQuery({
    queryKey: ['meals'],
    queryFn: () => base44.entities.Meal.list('-created_date', 50),
  });

  const { data: parLevels = [] } = useQuery({
    queryKey: ['parLevels'],
    queryFn: () => base44.entities.ParLevel.list('-created_date', 200),
  });

  const { data: stockSnapshots = [] } = useQuery({
    queryKey: ['latestStock'],
    queryFn: () => base44.entities.StockSnapshot.list('-created_date', 500),
  });

  const { data: committedDemand = [] } = useQuery({
    queryKey: ['committedDemand'],
    queryFn: () => base44.entities.CommittedDemand.list('-created_date', 500),
  });

  const latestStockBySkuId = useMemo(() => {
    const map = {};
    stockSnapshots.forEach(snap => {
      if (!map[snap.sku_id] || new Date(snap.created_date) > new Date(map[snap.sku_id].created_date)) {
        map[snap.sku_id] = snap;
      }
    });
    return map;
  }, [stockSnapshots]);

  const parBySkuId = useMemo(() => {
    const map = {};
    parLevels.forEach(p => { map[p.sku_id] = p.par_level; });
    return map;
  }, [parLevels]);

  const demandBySkuId = useMemo(() => {
    const map = {};
    committedDemand.forEach(d => {
      map[d.sku_id] = (map[d.sku_id] || 0) + d.quantity;
    });
    return map;
  }, [committedDemand]);

  const mealRows = useMemo(() => {
    const groups = groupSkusByMeal(skus, meals);
    const filtered = search
      ? groups.filter(g => g.mealName.toLowerCase().includes(search.toLowerCase()))
      : groups;

    return filtered.map(group => {
      const dataByType = {};
      PACKAGE_TYPES.forEach(pt => {
        const sku = group.skusByType[pt];
        if (!sku) return;
        const soh = latestStockBySkuId[sku.id]?.stock_on_hand || 0;
        const committed = demandBySkuId[sku.id] || 0;
        const par = parBySkuId[sku.id] || 0;
        const available = soh - committed;
        const rawNeeded = Math.max(0, par - available);
        const recommended = rawNeeded < 10 ? 0 : rawNeeded;

        dataByType[pt] = {
          skuId: sku.id,
          soh,
          committed,
          available,
          par,
          recommended,
          belowPar: available < par && par > 0,
        };
      });
      return { mealName: group.mealName, dataByType };
    });
  }, [skus, meals, search, latestStockBySkuId, demandBySkuId, parBySkuId]);

  const { totalToProduce, belowParCount } = useMemo(() => {
    let total = 0;
    let below = 0;
    mealRows.forEach(row => {
      PACKAGE_TYPES.forEach(pt => {
        const d = row.dataByType[pt];
        if (!d) return;
        const finalQty = overrides[d.skuId] !== undefined ? Number(overrides[d.skuId]) : d.recommended;
        total += finalQty;
        if (d.belowPar) below++;
      });
    });
    return { totalToProduce: total, belowParCount: below };
  }, [mealRows, overrides]);

  const handleGenerateRun = async () => {
    setGenerating(true);
    const today = format(new Date(), 'yyyy-MM-dd');

    const run = await base44.entities.ProductionRun.create({
      run_date: today,
      status: 'draft',
      total_units_to_produce: totalToProduce,
      total_skus_below_par: belowParCount,
    });

    const lines = [];
    mealRows.forEach(row => {
      PACKAGE_TYPES.forEach(pt => {
        const d = row.dataByType[pt];
        if (!d) return;
        const finalQty = overrides[d.skuId] !== undefined ? Number(overrides[d.skuId]) : d.recommended;
        if (finalQty > 0) {
          const sku = skus.find(s => s.id === d.skuId);
          lines.push({
            production_run_id: run.id,
            sku_id: d.skuId,
            sku_display_name: sku?.display_name || '',
            package_type: pt,
            stock_on_hand: d.soh,
            committed_stock: d.committed,
            available_stock: d.available,
            par_level: d.par,
            recommended_production: d.recommended,
            final_production_quantity: finalQty,
          });
        }
      });
    });

    if (lines.length > 0) {
      await base44.entities.ProductionRunLine.bulkCreate(lines);
    }

    queryClient.invalidateQueries({ queryKey: ['productionRuns'] });
    toast.success(`Production run created for ${today} with ${lines.length} SKUs`);
    setGenerating(false);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Production Planning</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Daily production recommendations — {format(new Date(), 'dd MMM yyyy')}
          </p>
        </div>
        <Button
          onClick={handleGenerateRun}
          disabled={generating || totalToProduce === 0}
          className="gap-2"
        >
          <Factory className="w-4 h-4" />
          Generate Run ({totalToProduce.toLocaleString()} units)
        </Button>
      </div>

      <div className="flex items-center gap-6 bg-card border border-border rounded-xl px-6 py-4">
        <div>
          <p className="text-xs text-muted-foreground uppercase tracking-wider">Below Par</p>
          <p className="text-lg font-bold text-red-600">{belowParCount}</p>
        </div>
        <div className="w-px h-8 bg-border" />
        <div>
          <p className="text-xs text-muted-foreground uppercase tracking-wider">Total Production</p>
          <p className="text-lg font-bold text-foreground">{totalToProduce.toLocaleString()}</p>
        </div>
        <div className="w-px h-8 bg-border" />
        <div>
          <p className="text-xs text-muted-foreground uppercase tracking-wider">Meals Shown</p>
          <p className="text-lg font-bold text-foreground">{mealRows.length}</p>
        </div>
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          placeholder="Search meals..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>

      <ProductionTable
        title="Goal-Related Meals"
        mealRows={mealRows.filter(r => {
          // A row is goal-related if it has any SKU in GOAL_PACKAGE_TYPES
          return GOAL_PACKAGE_TYPES.some(pt => r.dataByType[pt]);
        })}
        packageTypes={GOAL_PACKAGE_TYPES}
        overrides={overrides}
        setOverrides={setOverrides}
      />

      <ProductionTable
        title="Low Carb Meals"
        mealRows={mealRows.filter(r => {
          return LOW_CARB_PACKAGE_TYPES.some(pt => r.dataByType[pt]);
        })}
        packageTypes={LOW_CARB_PACKAGE_TYPES}
        overrides={overrides}
        setOverrides={setOverrides}
      />
    </div>
  );
}