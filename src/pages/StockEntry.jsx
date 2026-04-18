import React, { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Save, Search } from 'lucide-react';
import { format } from 'date-fns';
import { toast } from 'sonner';
import CSVStockImport from '../components/stock/CSVStockImport';

export default function StockEntry() {
  const queryClient = useQueryClient();
  const [filterType, setFilterType] = useState('all');
  const [search, setSearch] = useState('');
  const [stockValues, setStockValues] = useState({});
  const [saving, setSaving] = useState(false);

  const { data: skus = [] } = useQuery({
    queryKey: ['skus'],
    queryFn: () => base44.entities.SKU.list('-sku_code', 100),
  });

  const { data: stockSnapshots = [] } = useQuery({
    queryKey: ['latestStock'],
    queryFn: () => base44.entities.StockSnapshot.list('-created_date', 200),
  });

  // Latest stock by SKU
  const latestStockBySkuId = useMemo(() => {
    const map = {};
    stockSnapshots.forEach(snap => {
      if (!map[snap.sku_id] || new Date(snap.created_date) > new Date(map[snap.sku_id].created_date)) {
        map[snap.sku_id] = snap;
      }
    });
    return map;
  }, [stockSnapshots]);

  const filteredSkus = useMemo(() => {
    return skus
      .filter(sku => sku.is_active !== false)
      .filter(sku => filterType === 'all' || sku.package_type === filterType)
      .filter(sku => !search || sku.meal_name?.toLowerCase().includes(search.toLowerCase()) || sku.sku_code?.toLowerCase().includes(search.toLowerCase()));
  }, [skus, filterType, search]);

  const handleStockChange = (skuId, value) => {
    setStockValues(prev => ({ ...prev, [skuId]: value }));
  };

  const handleSaveAll = async () => {
    const entries = Object.entries(stockValues).filter(([_, v]) => v !== '' && v !== undefined);
    if (entries.length === 0) {
      toast.error('No stock values to save');
      return;
    }

    setSaving(true);
    const today = format(new Date(), 'yyyy-MM-dd');

    const records = entries.map(([skuId, value]) => {
      const sku = skus.find(s => s.id === skuId);
      return {
        snapshot_date: today,
        sku_id: skuId,
        sku_display_name: sku?.display_name || '',
        package_type: sku?.package_type || '',
        stock_on_hand: Number(value),
        entry_type: 'manual',
      };
    });

    await base44.entities.StockSnapshot.bulkCreate(records);
    queryClient.invalidateQueries({ queryKey: ['latestStock'] });
    setStockValues({});
    toast.success(`Saved stock for ${entries.length} SKUs`);
    setSaving(false);
  };

  const packageTypes = ['all', 'MWL', 'MLM', 'WWL', 'WLM', 'LOW_CARB'];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Stock Entry</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Enter current stock on hand by SKU — {format(new Date(), 'dd MMM yyyy')}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            onClick={handleSaveAll}
            disabled={saving || Object.keys(stockValues).length === 0}
            className="gap-2"
          >
            <Save className="w-4 h-4" />
            Save All ({Object.values(stockValues).filter(v => v !== '' && v !== undefined).length})
          </Button>
        </div>
      </div>

      {/* CSV Import */}
      <CSVStockImport skus={skus} />

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search meals or SKU codes..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <div className="flex gap-1">
          {packageTypes.map(type => (
            <Button
              key={type}
              variant={filterType === type ? 'default' : 'outline'}
              size="sm"
              onClick={() => setFilterType(type)}
              className="text-xs"
            >
              {type === 'all' ? 'All' : type}
            </Button>
          ))}
        </div>
      </div>

      {/* Stock Grid */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="bg-muted/50 border-b border-border">
                <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">SKU Code</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Meal</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Type</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Current Stock</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider w-40">New Stock</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filteredSkus.map(sku => {
                const currentStock = latestStockBySkuId[sku.id]?.stock_on_hand;
                return (
                  <tr key={sku.id} className="hover:bg-muted/30 transition-colors">
                    <td className="px-4 py-2.5">
                      <span className="text-xs font-mono text-muted-foreground">{sku.sku_code}</span>
                    </td>
                    <td className="px-4 py-2.5">
                      <span className="text-sm font-medium text-foreground">{sku.meal_name}</span>
                    </td>
                    <td className="px-4 py-2.5">
                      <Badge variant="outline" className="text-[10px]">{sku.package_type}</Badge>
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <span className="text-sm font-medium tabular-nums">
                        {currentStock !== undefined ? currentStock : '—'}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <Input
                        type="number"
                        min="0"
                        placeholder="Enter..."
                        value={stockValues[sku.id] ?? ''}
                        onChange={e => handleStockChange(sku.id, e.target.value)}
                        className="w-28 ml-auto text-right h-8 text-sm"
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}