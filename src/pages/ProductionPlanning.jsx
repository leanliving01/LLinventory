import React, { useState, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Factory, Search, X } from 'lucide-react';
import { format } from 'date-fns';
import { toast } from 'sonner';
import RecommendationTable from '@/components/production/RecommendationTable';
import { groupMealsForProduction, VARIANT_CODES } from '@/lib/productionGrouping';

export default function ProductionPlanning() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [overrides, setOverrides] = useState({});
  const [generating, setGenerating] = useState(false);

  // Fetch all finished meals
  const { data: finishedMeals = [], isLoading: loadingMeals } = useQuery({
    queryKey: ['finished-meals'],
    queryFn: () => base44.entities.Product.filter({ type: 'finished_meal', status: 'active' }, '-sku', 500),
  });

  // Fetch stock on hand (committed = 0 until Phase 2)
  const { data: stockRecords = [] } = useQuery({
    queryKey: ['stock-on-hand'],
    queryFn: () => base44.entities.StockOnHand.list('-updated_date', 1000),
  });

  // Build stock lookup: product_id → { qty_on_hand, qty_committed, qty_available }
  const stockMap = useMemo(() => {
    const map = {};
    stockRecords.forEach(s => {
      const pid = s.product_id;
      if (!map[pid]) map[pid] = { qty_on_hand: 0, qty_committed: 0, qty_available: 0 };
      map[pid].qty_on_hand += s.qty_on_hand || 0;
      map[pid].qty_committed += s.qty_committed || 0;
      map[pid].qty_available += s.qty_available || 0;
    });
    return map;
  }, [stockRecords]);

  // Group meals into rows
  const { goalRows, lowCarbRows } = useMemo(() => {
    return groupMealsForProduction(finishedMeals);
  }, [finishedMeals]);

  // Filter by search
  const filteredGoal = useMemo(() => {
    if (!search) return goalRows;
    const s = search.toLowerCase();
    return goalRows.filter(r => r.baseName.toLowerCase().includes(s));
  }, [goalRows, search]);

  const filteredLC = useMemo(() => {
    if (!search) return lowCarbRows;
    const s = search.toLowerCase();
    return lowCarbRows.filter(r => r.baseName.toLowerCase().includes(s));
  }, [lowCarbRows, search]);

  // Calculate totals
  const { totalToProduce, belowParCount } = useMemo(() => {
    let total = 0;
    let below = 0;

    const countRow = (row, codes) => {
      codes.forEach(code => {
        const p = row.variants[code];
        if (!p) return;
        const soh = stockMap[p.id]?.qty_on_hand || 0;
        const committed = stockMap[p.id]?.qty_committed || 0;
        const available = soh - committed;
        const par = p.par_level || 0;
        const recommended = Math.max(0, par - available);
        const finalQty = overrides[p.id] !== undefined ? Number(overrides[p.id]) : recommended;
        total += finalQty;
        if (par > 0 && available < par) below++;
      });
    };

    goalRows.forEach(r => countRow(r, VARIANT_CODES));
    lowCarbRows.forEach(r => countRow(r, ['LC']));

    return { totalToProduce: total, belowParCount: below };
  }, [goalRows, lowCarbRows, stockMap, overrides]);

  const handleOverride = (productId, value) => {
    setOverrides(prev => ({ ...prev, [productId]: value }));
  };

  // Generate a production run (§5.1.2)
  const handleConfirmRun = async () => {
    setGenerating(true);
    const today = format(new Date(), 'yyyy-MM-dd');
    const runNumber = `RUN-${format(new Date(), 'yyyy')}-${String(Date.now()).slice(-4)}`;

    // Collect all lines with qty > 0
    const lines = [];
    const collectLines = (rows, codes) => {
      rows.forEach(row => {
        codes.forEach(code => {
          const p = row.variants[code];
          if (!p) return;
          const soh = stockMap[p.id]?.qty_on_hand || 0;
          const committed = stockMap[p.id]?.qty_committed || 0;
          const available = soh - committed;
          const par = p.par_level || 0;
          const recommended = Math.max(0, par - available);
          const finalQty = overrides[p.id] !== undefined ? Number(overrides[p.id]) : recommended;
          if (finalQty > 0) {
            lines.push({
              product_id: p.id,
              product_name: p.name,
              product_sku: p.sku,
              planned_qty: finalQty,
              soh_at_plan: soh,
              committed_at_plan: committed,
              par_at_plan: par,
              status: 'pending',
            });
          }
        });
      });
    };

    collectLines(goalRows, VARIANT_CODES);
    collectLines(lowCarbRows, ['LC']);

    if (lines.length === 0) {
      toast.error('No meals to produce — all quantities are zero');
      setGenerating(false);
      return;
    }

    // Create the run
    const run = await base44.entities.ProductionRun.create({
      run_number: runNumber,
      run_date: today,
      status: 'scheduled',
      total_lines: lines.length,
      total_units: lines.reduce((s, l) => s + l.planned_qty, 0),
    });

    // Attach run_id and bulk create lines
    const linesWithRun = lines.map(l => ({ ...l, run_id: run.id }));
    await base44.entities.ProductionRunLine.bulkCreate(linesWithRun);

    queryClient.invalidateQueries({ queryKey: ['production-runs'] });
    toast.success(`Production run ${runNumber} created — ${lines.length} meals, ${lines.reduce((s, l) => s + l.planned_qty, 0)} units`);
    setOverrides({});
    setGenerating(false);
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Production Planning</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {format(new Date(), 'EEEE, dd MMM yyyy')} — par-based recommendations
          </p>
        </div>
        <Button
          onClick={handleConfirmRun}
          disabled={generating || totalToProduce === 0}
          size="lg"
          className="gap-2 h-12 px-6 text-base"
        >
          <Factory className="w-5 h-5" />
          {generating ? 'Creating...' : `Confirm Run (${totalToProduce} units)`}
        </Button>
      </div>

      {/* Summary strip */}
      <div className="flex items-center gap-6 bg-card border border-border rounded-xl px-6 py-4">
        <div>
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold">Below Par</p>
          <p className="text-lg font-bold text-red-600">{belowParCount}</p>
        </div>
        <div className="w-px h-8 bg-border" />
        <div>
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold">Total to Produce</p>
          <p className="text-lg font-bold text-foreground">{totalToProduce.toLocaleString()}</p>
        </div>
        <div className="w-px h-8 bg-border" />
        <div>
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold">Goal Meals</p>
          <p className="text-lg font-bold text-foreground">{goalRows.length}</p>
        </div>
        <div className="w-px h-8 bg-border" />
        <div>
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold">Low Carb</p>
          <p className="text-lg font-bold text-foreground">{lowCarbRows.length}</p>
        </div>
      </div>

      {/* Search */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search meals..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        {search && (
          <Button variant="ghost" size="sm" onClick={() => setSearch('')} className="gap-1">
            <X className="w-3.5 h-3.5" /> Clear
          </Button>
        )}
      </div>

      {loadingMeals ? (
        <div className="text-center py-12 text-sm text-muted-foreground">Loading meals...</div>
      ) : (
        <>
          <RecommendationTable
            title="Goal-Related Meals"
            rows={filteredGoal}
            variantCodes={VARIANT_CODES}
            stockMap={stockMap}
            overrides={overrides}
            onOverride={handleOverride}
          />

          <RecommendationTable
            title="Low Carb Meals"
            rows={filteredLC}
            variantCodes={['LC']}
            stockMap={stockMap}
            overrides={overrides}
            onOverride={handleOverride}
          />
        </>
      )}
    </div>
  );
}