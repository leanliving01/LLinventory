import React, { useState, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Save, Search } from 'lucide-react';
import { format } from 'date-fns';
import { toast } from 'sonner';
import CSVStockImport from '@/components/stock/CSVStockImport';
import StockTakeTable from '@/components/stock/StockTakeTable';
import { PACKAGE_TYPES, GOAL_PACKAGE_TYPES, LOW_CARB_PACKAGE_TYPES, groupSkusByMeal } from '@/lib/mealGrouping';

export default function StockTake() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [stockValues, setStockValues] = useState({});
  const [saving, setSaving] = useState(false);

  const { data: skus = [] } = useQuery({
    queryKey: ['skus'],
    queryFn: () => base44.entities.SKU.list('-sku_code', 200),
  });

  const { data: meals = [] } = useQuery({
    queryKey: ['meals'],
    queryFn: () => base44.entities.Meal.list('-created_date', 50),
  });

  const { data: stockSnapshots = [] } = useQuery({
    queryKey: ['latestStock'],
    queryFn: () => base44.entities.StockSnapshot.list('-created_date', 500),
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

  const mealRows = useMemo(() => {
    const groups = groupSkusByMeal(skus, meals);
    const filtered = search
      ? groups.filter(g => g.mealName.toLowerCase().includes(search.toLowerCase()))
      : groups;
    return filtered.map(group => {
      const stockByType = {};
      PACKAGE_TYPES.forEach(pt => {
        const sku = group.skusByType[pt];
        if (!sku) return;
        stockByType[pt] = latestStockBySkuId[sku.id]?.stock_on_hand;
      });
      return { ...group, stockByType };
    });
  }, [skus, meals, search, latestStockBySkuId]);

  const handleStockChange = (skuId, value) => {
    setStockValues(prev => ({ ...prev, [skuId]: value }));
  };

  const handleSaveAll = async () => {
    const entries = Object.entries(stockValues).filter(([_, v]) => v !== '' && v !== undefined);
    if (entries.length === 0) {
      toast.error('No values to save');
      return;
    }

    setSaving(true);

    try {
      const today = format(new Date(), 'yyyy-MM-dd');

      const records = entries.map(([skuId, value]) => {
        const sku = skus.find(s => s.id === skuId);
        return {
          snapshot_date: today,
          sku_id: skuId,
          sku_display_name: sku?.display_name || '',
          package_type: sku?.package_type || '',
          stock_on_hand: Number(value),
          entry_type: 'adjustment',
          notes: `Stock take: counted ${value}`,
        };
      });

      await base44.entities.StockSnapshot.bulkCreate(records);
      queryClient.invalidateQueries({ queryKey: ['latestStock'] });
      setStockValues({});
      toast.success(`Stock take saved for ${entries.length} SKUs`);
    } catch (err) {
      toast.error('Save failed: ' + (err.message || 'Unknown error'));
    } finally {
      setSaving(false);
    }
  };

  const saveCount = Object.values(stockValues).filter(v => v !== '' && v !== undefined).length;
  const goalRows = mealRows.filter(r => GOAL_PACKAGE_TYPES.some(pt => r.skusByType[pt]));
  const lowCarbRows = mealRows.filter(r => LOW_CARB_PACKAGE_TYPES.some(pt => r.skusByType[pt]));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Stock Take</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Record actual stock counts — {format(new Date(), 'dd MMM yyyy')}
          </p>
        </div>
        <Button onClick={handleSaveAll} disabled={saving || saveCount === 0} className="gap-2">
          <Save className="w-4 h-4" />
          Save All ({saveCount})
        </Button>
      </div>

      <p className="text-sm text-muted-foreground bg-blue-50 border border-blue-200 rounded-lg px-4 py-2">
        Enter the <strong>actual count</strong> of meals on hand — this will <strong>replace</strong> the current stock level.
      </p>

      <CSVStockImport skus={skus} />

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input placeholder="Search meals..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
      </div>

      <StockTakeTable title="Goal-Related Meals" mealRows={goalRows} packageTypes={GOAL_PACKAGE_TYPES} stockValues={stockValues} onStockChange={handleStockChange} />
      <StockTakeTable title="Low Carb Meals" mealRows={lowCarbRows} packageTypes={LOW_CARB_PACKAGE_TYPES} stockValues={stockValues} onStockChange={handleStockChange} />
    </div>
  );
}