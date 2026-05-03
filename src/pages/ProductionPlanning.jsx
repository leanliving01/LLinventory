import React, { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Factory, Search, X, Settings2, Save, Loader2, Plus } from 'lucide-react';
import { format } from 'date-fns';
import { toast } from 'sonner';
import RecommendationTable from '@/components/production/RecommendationTable';
import AdHocRunModal from '@/components/production/AdHocRunModal';
import { useNavigate } from 'react-router-dom';
import HelpDrawer from '@/components/help/HelpDrawer';
import { groupMealsForProduction, VARIANT_CODES } from '@/lib/productionGrouping';
import { writeAuditLog } from '@/lib/auditLog';
import { useAuth } from '@/lib/AuthContext';
import { getUserPermissions } from '@/lib/permissions';
import { useCustomRoles } from '@/components/settings/CustomRolesManager';

export default function ProductionPlanning() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { user } = useAuth();
  const customRoles = useCustomRoles();
  const perms = getUserPermissions(user || {}, customRoles);
  const [search, setSearch] = useState('');
  const [overrides, setOverrides] = useState({});
  const [generating, setGenerating] = useState(false);
  const [maxInput, setMaxInput] = useState('');
  const [savingMax, setSavingMax] = useState(false);
  const [showAdHoc, setShowAdHoc] = useState(false);

  // Fetch max meals per run setting
  const { data: maxSetting } = useQuery({
    queryKey: ['setting-max-meals-per-run'],
    queryFn: async () => {
      const settings = await base44.entities.Setting.filter({ key: 'max_meals_per_run' });
      return settings[0] || null;
    },
  });
  const maxPerRun = maxSetting ? Number(maxSetting.value) || 2500 : 2500;

  // Save max per run
  const handleSaveMax = async () => {
    const val = Number(maxInput);
    if (!val || val < 1) return;
    setSavingMax(true);
    if (maxSetting) {
      await base44.entities.Setting.update(maxSetting.id, { value: String(val) });
    } else {
      await base44.entities.Setting.create({ key: 'max_meals_per_run', value: String(val), group: 'production', label: 'Max meals per production run' });
    }
    queryClient.invalidateQueries({ queryKey: ['setting-max-meals-per-run'] });
    setSavingMax(false);
    setMaxInput('');
    toast.success(`Max meals per run updated to ${val.toLocaleString()}`);
  };

  // Fetch all finished meals
  const { data: finishedMeals = [], isLoading: loadingMeals } = useQuery({
    queryKey: ['finished-meals'],
    queryFn: () => base44.entities.Product.filter({ type: 'finished_meal', status: 'active' }, '-sku', 500),
  });

  // Fetch stock on hand
  const { data: stockRecords = [] } = useQuery({
    queryKey: ['stock-on-hand'],
    queryFn: () => base44.entities.StockOnHand.list('-updated_date', 1000),
  });

  // Build stock lookup directly from StockOnHand — qty_committed is authoritative (set by recalcCommittedDemand)
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
  const { totalToProduce, belowParCount, totalCommitted } = useMemo(() => {
    let total = 0;
    let below = 0;
    let committed = 0;

    const countRow = (row, codes) => {
      codes.forEach(code => {
        const p = row.variants[code];
        if (!p) return;
        const soh = stockMap[p.id]?.qty_on_hand || 0;
        const com = stockMap[p.id]?.qty_committed || 0;
        const available = soh - com;
        const par = p.par_level || 0;
        const recommended = Math.max(0, par - available);
        const finalQty = overrides[p.id] !== undefined ? Number(overrides[p.id]) : recommended;
        total += finalQty;
        committed += com;
        if (par > 0 && available < par) below++;
      });
    };

    goalRows.forEach(r => countRow(r, VARIANT_CODES));
    lowCarbRows.forEach(r => countRow(r, ['LC']));

    return { totalToProduce: total, belowParCount: below, totalCommitted: committed };
  }, [goalRows, lowCarbRows, stockMap, overrides]);

  const handleOverride = (productId, value) => {
    setOverrides(prev => ({ ...prev, [productId]: value }));
  };

  // Collect all production lines with qty > 0
  const collectAllLines = () => {
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
    return lines;
  };

  // Build the split plan and navigate to full-page review
  const handleOpenConfirm = () => {
    const lines = collectAllLines();
    if (lines.length === 0) {
      toast.error('No meals to produce — all quantities are zero');
      return;
    }

    const numRuns = Math.max(1, Math.ceil(totalToProduce / maxPerRun));
    const splitPlan = buildSplitPlan(lines, numRuns, maxPerRun, totalToProduce);

    // Store in sessionStorage and navigate to the review page
    sessionStorage.setItem('planRunReview', JSON.stringify({
      splitPlan,
      maxPerRun,
      totalUnits: totalToProduce,
    }));
    navigate('/production/plan-review');
  };

  // Build the split plan (same algorithm as before, now a pure function)
  const buildSplitPlan = (lines, numRuns, max, total) => {
    if (numRuns === 1) {
      return [{ runIndex: 0, label: 'Run 1', lines: lines.map(l => ({ ...l })), totalUnits: total }];
    }

    const sorted = [...lines].sort((a, b) => (b.committed_at_plan || 0) - (a.committed_at_plan || 0));
    const remaining = {};
    sorted.forEach(l => { remaining[l.product_id] = l.planned_qty; });
    const runs = [];

    // Run 1 — priority: fill up to max, preferring committed demand
    let run1Lines = [];
    let run1Total = 0;
    for (const line of sorted) {
      if (run1Total >= max) break;
      const canTake = Math.min(remaining[line.product_id], max - run1Total);
      if (canTake > 0) {
        run1Lines.push({ ...line, planned_qty: canTake });
        run1Total += canTake;
        remaining[line.product_id] -= canTake;
      }
    }
    runs.push({ runIndex: 0, label: 'Run 1 (Priority)', lines: run1Lines, totalUnits: run1Total });

    // Remaining runs — split evenly
    const leftoverTotal = Object.values(remaining).reduce((s, v) => s + v, 0);
    const remainingRuns = numRuns - 1;

    if (remainingRuns > 0 && leftoverTotal > 0) {
      const perRun = Math.ceil(leftoverTotal / remainingRuns);
      for (let r = 0; r < remainingRuns; r++) {
        let runLines = [];
        let runTotal = 0;
        const runCap = Math.min(perRun, max);
        for (const line of sorted) {
          if (runTotal >= runCap) break;
          if (remaining[line.product_id] <= 0) continue;
          const canTake = Math.min(remaining[line.product_id], runCap - runTotal);
          if (canTake > 0) {
            runLines.push({ ...line, planned_qty: canTake });
            runTotal += canTake;
            remaining[line.product_id] -= canTake;
          }
        }
        if (runLines.length > 0) {
          runs.push({ runIndex: r + 1, label: `Run ${r + 2}`, lines: runLines, totalUnits: runTotal });
        }
      }
    }
    return runs;
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
        <div className="flex items-center gap-2">
        <HelpDrawer pageKey="production-plan" />
        {perms.planning_create && (
          <Button
            variant="outline"
            onClick={() => setShowAdHoc(true)}
            className="gap-2 h-12 px-5 text-base"
          >
            <Plus className="w-5 h-5" />
            Ad-Hoc Run
          </Button>
        )}
        {perms.planning_create && (
          <Button
            onClick={handleOpenConfirm}
            disabled={generating || totalToProduce === 0}
            size="lg"
            className="gap-2 h-12 px-6 text-base"
          >
            <Factory className="w-5 h-5" />
            {totalToProduce > maxPerRun
              ? `Plan ${Math.ceil(totalToProduce / maxPerRun)} Runs (${totalToProduce.toLocaleString()})`
              : `Confirm Run (${totalToProduce.toLocaleString()})`
            }
          </Button>
        )}
        </div>
      </div>

      {/* Summary strip */}
      <div className="flex items-center gap-6 bg-card border border-border rounded-xl px-6 py-4 flex-wrap">
        <div>
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold">Below Par</p>
          <p className="text-lg font-bold text-red-600">{belowParCount}</p>
        </div>
        <div className="w-px h-8 bg-border" />
        <div>
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold">Committed</p>
          <p className="text-lg font-bold text-amber-600">{totalCommitted.toLocaleString()}</p>
        </div>
        <div className="w-px h-8 bg-border" />
        <div>
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold">Total to Produce</p>
          <p className="text-lg font-bold text-foreground">{totalToProduce.toLocaleString()}</p>
        </div>
        <div className="w-px h-8 bg-border" />
        <div>
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold">Runs Needed</p>
          <p className="text-lg font-bold text-foreground">{Math.max(1, Math.ceil(totalToProduce / maxPerRun))}</p>
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

        {/* Max meals per run - inline editable */}
        <div className="ml-auto flex items-center gap-2 bg-muted/50 rounded-lg px-3 py-2 border border-border">
          <Settings2 className="w-4 h-4 text-muted-foreground shrink-0" />
          <div className="text-[10px] text-muted-foreground uppercase font-semibold whitespace-nowrap">Max / Run</div>
          <Input
            type="number"
            min="1"
            value={maxInput || maxPerRun}
            onChange={e => setMaxInput(e.target.value)}
            className="w-24 h-8 text-sm text-right"
            onFocus={() => { if (!maxInput) setMaxInput(String(maxPerRun)); }}
          />
          {maxInput && Number(maxInput) !== maxPerRun && (
            <Button
              size="sm"
              variant="ghost"
              onClick={handleSaveMax}
              disabled={savingMax}
              className="h-7 px-2"
            >
              {savingMax ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
            </Button>
          )}
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


      {showAdHoc && <AdHocRunModal open={showAdHoc} onOpenChange={setShowAdHoc} />}
    </div>
  );
}