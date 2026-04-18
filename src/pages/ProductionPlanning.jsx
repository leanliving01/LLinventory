import React, { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Factory, FileDown, Lock, Search, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

export default function ProductionPlanning() {
  const queryClient = useQueryClient();
  const [filterType, setFilterType] = useState('all');
  const [search, setSearch] = useState('');
  const [overrides, setOverrides] = useState({});
  const [generating, setGenerating] = useState(false);

  const { data: skus = [] } = useQuery({
    queryKey: ['skus'],
    queryFn: () => base44.entities.SKU.list('-sku_code', 100),
  });

  const { data: parLevels = [] } = useQuery({
    queryKey: ['parLevels'],
    queryFn: () => base44.entities.ParLevel.list('-created_date', 100),
  });

  const { data: stockSnapshots = [] } = useQuery({
    queryKey: ['latestStock'],
    queryFn: () => base44.entities.StockSnapshot.list('-created_date', 200),
  });

  const { data: committedDemand = [] } = useQuery({
    queryKey: ['committedDemand'],
    queryFn: () => base44.entities.CommittedDemand.list('-created_date', 500),
  });

  const { data: productionRuns = [] } = useQuery({
    queryKey: ['productionRuns'],
    queryFn: () => base44.entities.ProductionRun.list('-created_date', 5),
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

  // Production plan rows
  const planRows = useMemo(() => {
    return skus
      .filter(sku => sku.is_active !== false)
      .filter(sku => filterType === 'all' || sku.package_type === filterType)
      .filter(sku => !search || sku.meal_name?.toLowerCase().includes(search.toLowerCase()) || sku.sku_code?.toLowerCase().includes(search.toLowerCase()))
      .map(sku => {
        const soh = latestStockBySkuId[sku.id]?.stock_on_hand || 0;
        const committed = demandBySkuId[sku.id] || 0;
        const par = parBySkuId[sku.id] || 0;
        const available = soh - committed;
        const rawNeeded = Math.max(0, par - available);
        const recommended = rawNeeded < 10 ? 0 : rawNeeded;
        const finalQty = overrides[sku.id] !== undefined ? Number(overrides[sku.id]) : recommended;

        return {
          sku,
          soh,
          committed,
          par,
          available,
          recommended,
          finalQty,
          belowPar: available < par && par > 0,
        };
      });
  }, [skus, filterType, search, latestStockBySkuId, demandBySkuId, parBySkuId, overrides]);

  const totalToProduce = planRows.reduce((sum, r) => sum + r.finalQty, 0);
  const belowParCount = planRows.filter(r => r.belowPar).length;

  const handleGenerateRun = async () => {
    setGenerating(true);
    const today = format(new Date(), 'yyyy-MM-dd');
    
    const run = await base44.entities.ProductionRun.create({
      run_date: today,
      status: 'draft',
      total_units_to_produce: totalToProduce,
      total_skus_below_par: belowParCount,
    });

    const lines = planRows
      .filter(r => r.finalQty > 0)
      .map(r => ({
        production_run_id: run.id,
        sku_id: r.sku.id,
        sku_display_name: r.sku.display_name,
        package_type: r.sku.package_type,
        stock_on_hand: r.soh,
        committed_stock: r.committed,
        available_stock: r.available,
        par_level: r.par,
        recommended_production: r.recommended,
        final_production_quantity: r.finalQty,
      }));

    if (lines.length > 0) {
      await base44.entities.ProductionRunLine.bulkCreate(lines);
    }

    queryClient.invalidateQueries({ queryKey: ['productionRuns'] });
    toast.success(`Production run created for ${today} with ${lines.length} SKUs`);
    setGenerating(false);
  };

  const packageTypes = ['all', 'MWL', 'MLM', 'WWL', 'WLM', 'LOW_CARB'];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Production Planning</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Daily production recommendations — {format(new Date(), 'dd MMM yyyy')}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            onClick={handleGenerateRun}
            disabled={generating || totalToProduce === 0}
            className="gap-2"
          >
            <Factory className="w-4 h-4" />
            Generate Run ({totalToProduce.toLocaleString()} units)
          </Button>
        </div>
      </div>

      {/* Summary bar */}
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
          <p className="text-xs text-muted-foreground uppercase tracking-wider">SKUs Shown</p>
          <p className="text-lg font-bold text-foreground">{planRows.length}</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search meals..."
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

      {/* Production Grid */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="bg-muted/50 border-b border-border">
                <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">SKU</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Meal</th>
                <th className="text-center px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Type</th>
                <th className="text-right px-3 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">SOH</th>
                <th className="text-right px-3 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Committed</th>
                <th className="text-right px-3 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Available</th>
                <th className="text-right px-3 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Par</th>
                <th className="text-right px-3 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Recommended</th>
                <th className="text-right px-3 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider w-32">Final Qty</th>
                <th className="text-center px-3 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {planRows.map(row => (
                <tr key={row.sku.id} className={cn(
                  "hover:bg-muted/30 transition-colors",
                  row.belowPar && "bg-red-50/50"
                )}>
                  <td className="px-4 py-2.5">
                    <span className="text-xs font-mono text-muted-foreground">{row.sku.sku_code}</span>
                  </td>
                  <td className="px-4 py-2.5 text-sm font-medium">{row.sku.meal_name}</td>
                  <td className="px-4 py-2.5 text-center">
                    <Badge variant="outline" className="text-[10px]">{row.sku.package_type}</Badge>
                  </td>
                  <td className="px-3 py-2.5 text-right text-sm tabular-nums">{row.soh}</td>
                  <td className="px-3 py-2.5 text-right text-sm tabular-nums text-amber-600">{row.committed}</td>
                  <td className={cn("px-3 py-2.5 text-right text-sm tabular-nums font-medium", row.available < 0 && "text-red-600")}>
                    {row.available}
                  </td>
                  <td className="px-3 py-2.5 text-right text-sm tabular-nums">{row.par}</td>
                  <td className="px-3 py-2.5 text-right text-sm tabular-nums font-semibold">
                    {row.recommended > 0 ? row.recommended : '—'}
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    <Input
                      type="number"
                      min="0"
                      value={overrides[row.sku.id] ?? row.recommended}
                      onChange={e => setOverrides(prev => ({ ...prev, [row.sku.id]: e.target.value }))}
                      className="w-24 ml-auto text-right h-7 text-sm"
                    />
                  </td>
                  <td className="px-3 py-2.5 text-center">
                    {row.belowPar ? (
                      <AlertTriangle className="w-4 h-4 text-red-500 mx-auto" />
                    ) : (
                      <CheckCircle2 className="w-4 h-4 text-emerald-500 mx-auto" />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}