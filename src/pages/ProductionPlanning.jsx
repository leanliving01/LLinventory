import React, { useState, useMemo, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Factory, Search, X, Settings2, Save, Loader2, Plus, AlertTriangle, Sparkles } from 'lucide-react';
import { format } from 'date-fns';
import { toast } from 'sonner';
import AdHocRunModal from '@/components/production/AdHocRunModal';
import PackageSummaryCard from '@/components/production/PackageSummaryCard';
import PackageDetailTable from '@/components/production/PackageDetailTable';
import { useNavigate } from 'react-router-dom';
import HelpDrawer from '@/components/help/HelpDrawer';
import { groupMealsByPackage } from '@/lib/productionGrouping';
import { useAuth } from '@/lib/AuthContext';
import { getUserPermissions } from '@/lib/permissions';
import { useCustomRoles } from '@/components/settings/CustomRolesManager';
import { useSubcategories } from '@/lib/useSubcategories';
import { cn } from '@/lib/utils';
import { supabase } from '@/api/supabaseClient';
import { buildRecommendationMap } from '@/lib/productionEngine';

export default function ProductionPlanning() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { user } = useAuth();
  const customRoles = useCustomRoles();
  const perms = getUserPermissions(user || {}, customRoles);
  const { rows: subcatRows } = useSubcategories();

  const [search, setSearch] = useState('');
  const [overrides, setOverrides] = useState({});
  const [maxInput, setMaxInput] = useState('');
  const [savingMax, setSavingMax] = useState(false);
  const [showAdHoc, setShowAdHoc] = useState(false);
  const [selectedPackage, setSelectedPackage] = useState(null);
  const [belowParOnly, setBelowParOnly] = useState(false);

  // ── Settings ──────────────────────────────────────────────────────────────
  const { data: maxSetting } = useQuery({
    queryKey: ['setting-max-meals-per-run'],
    queryFn: async () => {
      const settings = await base44.entities.Setting.filter({ key: 'max_meals_per_run' });
      return settings[0] || null;
    },
  });
  // Daily capacity — the most meals the kitchen can make in a day. The day's
  // to-par total is split into this-sized runs = the production window.
  const maxPerRun = maxSetting ? Number(maxSetting.value) || 1500 : 1500;
  // The typed value takes effect on the plan IMMEDIATELY (no need to click Save —
  // Save only persists it as the default). So changing Max/Run instantly re-splits
  // the run and updates the button. Falls back to the saved default when blank.
  const typedMax = Number(maxInput);
  const effectiveMax = maxInput !== '' && typedMax >= 1 ? typedMax : maxPerRun;

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

  // ── Data ──────────────────────────────────────────────────────────────────
  const { data: finishedMeals = [], isLoading: loadingMeals } = useQuery({
    queryKey: ['finished-meals'],
    queryFn: () => base44.entities.Product.filter({ type: 'finished_meal', status: 'active' }, '-sku', 500),
    refetchOnWindowFocus: true,
  });

  // Stock summed per product across ALL locations, server-side. The old
  // StockOnHand.list('-updated_date', 1000) silently truncated (stock_on_hand has
  // >1700 product×location rows): any meal not touched recently read 0 on-hand and
  // the engine recommended a full par batch of stock already held. The RPC returns
  // one row per product → never hits the 1000-row REST cap. (migration 101)
  const { data: stockRecords = [] } = useQuery({
    queryKey: ['stock-on-hand'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('production_stock_levels');
      if (error) { console.error('[production_stock_levels]', error.message); return []; }
      return data || [];
    },
    refetchOnWindowFocus: true,
  });

  // Live updates — reflect new/changed products, stock and subcategories without
  // a manual refresh. Realtime where the table is in the publication; the
  // refetchOnWindowFocus above is the reliable fallback. (Pattern: SyncStatusBanner.)
  useEffect(() => {
    const invalidate = (key) => () => queryClient.invalidateQueries({ queryKey: [key] });
    const unsubs = [
      base44.entities.Product.subscribe(invalidate('finished-meals')),
      base44.entities.StockOnHand.subscribe(invalidate('stock-on-hand')),
      base44.entities.ProductSubcategory.subscribe(invalidate('product-subcategories')),
    ];
    return () => unsubs.forEach(u => { try { u && u(); } catch { /* noop */ } });
  }, [queryClient]);

  const stockMap = useMemo(() => {
    const map = {};
    stockRecords.forEach(s => {
      const pid = s.product_id;
      if (!map[pid]) map[pid] = { qty_on_hand: 0, qty_committed: 0, qty_available: 0 };
      map[pid].qty_on_hand  += s.qty_on_hand  || 0;
      map[pid].qty_committed += s.qty_committed || 0;
      map[pid].qty_available += s.qty_available || 0;
    });
    return map;
  }, [stockRecords]);

  // The deterministic engine: one recommendation per meal (pure par-to-target —
  // recommended = max(0, par − available), backorders always covered). Single
  // source of truth shared by the summary, the package cards, the detail table
  // and the Run button.
  const recoMap = useMemo(
    () => buildRecommendationMap(finishedMeals, stockMap),
    [finishedMeals, stockMap]
  );

  // ── Package grouping ───────────────────────────────────────────────────────
  const packages = useMemo(
    () => groupMealsByPackage(finishedMeals, subcatRows),
    [finishedMeals, subcatRows]
  );

  // Per-package stats for the summary cards
  const packageStats = useMemo(() => {
    const stats = {};
    packages.forEach(pkg => {
      let totalToProduce = 0, committed = 0, belowPar = 0, atPar = 0, totalWithPar = 0;
      pkg.meals.forEach(({ product }) => {
        const soh = stockMap[product.id]?.qty_on_hand || 0;
        const com = stockMap[product.id]?.qty_committed || 0;
        const available = soh - com;
        const par = product.par_level || 0;
        const recommended = recoMap[product.id]?.recommended || 0;
        const finalQty = overrides[product.id] !== undefined ? Number(overrides[product.id]) : recommended;
        totalToProduce += finalQty;
        committed += com;
        if (par > 0) {
          totalWithPar++;
          if (available < par) belowPar++; else atPar++;
        }
      });
      stats[pkg.code] = {
        totalToProduce,
        committed,
        belowPar,
        onPlanPct: totalWithPar > 0 ? (atPar / totalWithPar) * 100 : 100,
        totalMeals: pkg.meals.length,
      };
    });
    return stats;
  }, [packages, stockMap, overrides, recoMap]);

  // Global totals for the summary strip
  const { totalToProduce, belowParCount, totalCommitted, backorderCount } = useMemo(() => {
    let total = 0, below = 0, committed = 0, backorders = 0;
    packages.forEach(pkg => {
      pkg.meals.forEach(({ product }) => {
        const com = stockMap[product.id]?.qty_committed || 0;
        const reco = recoMap[product.id] || {};
        const recommended = reco.recommended || 0;
        const finalQty = overrides[product.id] !== undefined ? Number(overrides[product.id]) : recommended;
        total += finalQty;
        committed += com;
        if (reco.reason === 'below_par' || reco.reason === 'backorder') below++;
        if (reco.backorderShortfall > 0) backorders++;
      });
    });
    return { totalToProduce: total, belowParCount: below, totalCommitted: committed, backorderCount: backorders };
  }, [packages, stockMap, overrides, recoMap]);

  const handleOverride = (productId, value) => {
    setOverrides(prev => ({ ...prev, [productId]: value }));
  };

  // ── Plan generation ────────────────────────────────────────────────────────
  const collectAllLines = () => {
    const lines = [];
    packages.forEach(pkg => {
      pkg.meals.forEach(({ product }) => {
        const soh = stockMap[product.id]?.qty_on_hand || 0;
        const com = stockMap[product.id]?.qty_committed || 0;
        const par = product.par_level || 0;
        const recommended = recoMap[product.id]?.recommended || 0;
        const finalQty = overrides[product.id] !== undefined ? Number(overrides[product.id]) : recommended;
        if (finalQty > 0) {
          lines.push({
            product_id: product.id,
            product_name: product.name,
            product_sku: product.sku,
            planned_qty: finalQty,
            soh_at_plan: soh,
            committed_at_plan: com,
            par_at_plan: par,
            reason: recoMap[product.id]?.reason || null,
            status: 'pending',
          });
        }
      });
    });
    return lines;
  };

  const handleOpenConfirm = () => {
    const lines = collectAllLines();
    if (lines.length === 0) {
      toast.error('No meals to produce — all quantities are zero');
      return;
    }
    const numRuns = Math.max(1, Math.ceil(totalToProduce / effectiveMax));
    const splitPlan = buildSplitPlan(lines, numRuns, effectiveMax, totalToProduce);
    sessionStorage.setItem('planRunReview', JSON.stringify({ splitPlan, maxPerRun: effectiveMax, totalUnits: totalToProduce }));
    navigate('/production/plan-review');
  };

  const buildSplitPlan = (lines, numRuns, max, total) => {
    if (numRuns === 1) {
      return [{ runIndex: 0, label: 'Run 1', lines: lines.map(l => ({ ...l })), totalUnits: total }];
    }
    const sorted = [...lines].sort((a, b) => (b.committed_at_plan || 0) - (a.committed_at_plan || 0));
    const remaining = {};
    sorted.forEach(l => { remaining[l.product_id] = l.planned_qty; });
    const runs = [];

    let run1Lines = [], run1Total = 0;
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

    const leftoverTotal = Object.values(remaining).reduce((s, v) => s + v, 0);
    const remainingRuns = numRuns - 1;
    if (remainingRuns > 0 && leftoverTotal > 0) {
      const perRun = Math.ceil(leftoverTotal / remainingRuns);
      for (let r = 0; r < remainingRuns; r++) {
        let runLines = [], runTotal = 0;
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

  const numRuns = Math.max(1, Math.ceil(totalToProduce / effectiveMax));

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-4">

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Production Planning</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {format(new Date(), 'EEEE, dd MMM yyyy')} — plan across all packages
          </p>
        </div>
        <div className="flex items-center gap-2">
          <HelpDrawer pageKey="production-plan" />
          {perms.planning_create && (
            <Button variant="outline" onClick={() => setShowAdHoc(true)} className="gap-2 h-12 px-5 text-base">
              <Plus className="w-5 h-5" />
              Ad-Hoc Run
            </Button>
          )}
          {perms.planning_create && (
            <div className="flex flex-col items-end gap-1">
              <Button
                onClick={handleOpenConfirm}
                disabled={totalToProduce === 0}
                size="lg"
                className="gap-2 h-12 px-6 text-base"
              >
                <Factory className="w-5 h-5" />
                {numRuns > 1
                  ? `Plan Production Run · ${numRuns} runs (${totalToProduce.toLocaleString()})`
                  : `Plan Production Run (${totalToProduce.toLocaleString()})`}
              </Button>
              {totalToProduce > 0 && (
                <span className="text-[11px] text-muted-foreground flex items-center gap-1">
                  <Sparkles className="w-3 h-3 text-primary" /> Next: review with Livy →
                </span>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Summary strip */}
      <div className="flex items-center gap-6 bg-card border border-border rounded-xl px-6 py-4 flex-wrap">
        <div>
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold">Backorders</p>
          <p className="text-lg font-bold text-red-600">{backorderCount}</p>
        </div>
        <div className="w-px h-8 bg-border" />
        <div>
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold" title="Meals below par — the trigger to produce (rebuild to par)">Below Par</p>
          <p className="text-lg font-bold text-amber-600">{belowParCount}</p>
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
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold" title="Production window — the day's to-par total split into daily-capacity-sized runs">Production Days</p>
          <p className="text-lg font-bold text-foreground">{numRuns}</p>
        </div>
        <div className="w-px h-8 bg-border" />
        <div>
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold">Packages</p>
          <p className="text-lg font-bold text-foreground">{packages.length}</p>
        </div>

        {/* Daily capacity inline editor — how many meals/day the kitchen can make.
            The to-par total splits into this-sized runs = the production window.
            Typed value applies to the plan LIVE (Save only persists the default). */}
        <div className="ml-auto flex items-center gap-2 bg-muted/50 rounded-lg px-3 py-2 border border-border">
          <Settings2 className="w-4 h-4 text-muted-foreground shrink-0" />
          <div className="text-[10px] text-muted-foreground uppercase font-semibold whitespace-nowrap" title="Meals the kitchen can produce in one day. If the to-par total is higher, it splits across days.">Daily Capacity</div>
          <Input
            type="number"
            min="1"
            value={maxInput || maxPerRun}
            onChange={e => setMaxInput(e.target.value)}
            className="w-24 h-8 text-sm text-right"
            onFocus={() => { if (!maxInput) setMaxInput(String(maxPerRun)); }}
          />
          {maxInput && Number(maxInput) !== maxPerRun && (
            <Button size="sm" variant="ghost" onClick={handleSaveMax} disabled={savingMax} className="h-7 px-2">
              {savingMax ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
            </Button>
          )}
        </div>
      </div>

      {/* Search + filters */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search meals, packages..."
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
        <Button
          variant={belowParOnly ? 'default' : 'outline'}
          size="sm"
          onClick={() => setBelowParOnly(v => !v)}
          className="gap-1.5 h-9"
        >
          <AlertTriangle className="w-3.5 h-3.5" />
          Below Par Only
        </Button>
      </div>

      {loadingMeals ? (
        <div className="text-center py-12 text-sm text-muted-foreground">Loading meals...</div>
      ) : (
        <>
          {/* Package summary cards */}
          <div className="flex gap-3 overflow-x-auto pb-1 -mx-1 px-1">
            {/* "All Packages" chip */}
            <button
              onClick={() => setSelectedPackage(null)}
              className={cn(
                'flex flex-col justify-center items-center gap-1 px-5 py-3 rounded-xl border text-sm font-semibold shrink-0 transition-all',
                selectedPackage === null
                  ? 'border-primary border-2 bg-primary/5 text-primary shadow-md'
                  : 'border-border bg-card text-muted-foreground hover:border-primary/40'
              )}
            >
              <span>All Packages</span>
              <span className="text-[10px] font-normal text-muted-foreground">{packages.length} types</span>
            </button>

            {packages.map(pkg => (
              <PackageSummaryCard
                key={pkg.code}
                pkg={pkg}
                stats={packageStats[pkg.code] || { totalToProduce: 0, committed: 0, belowPar: 0, onPlanPct: 100, totalMeals: 0 }}
                selected={selectedPackage === pkg.code}
                onClick={() => setSelectedPackage(prev => prev === pkg.code ? null : pkg.code)}
                maxPerRun={effectiveMax}
              />
            ))}
          </div>

          {/* Package detail sections */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-sm font-semibold text-foreground">Package Details</h2>
              <p className="text-xs text-muted-foreground">Meal-level breakdown for each package</p>
            </div>
            <PackageDetailTable
              packages={packages}
              selectedPackage={selectedPackage}
              stockMap={stockMap}
              recoMap={recoMap}
              overrides={overrides}
              onOverride={handleOverride}
              search={search}
              belowParOnly={belowParOnly}
            />
          </div>
        </>
      )}

      {showAdHoc && <AdHocRunModal open={showAdHoc} onOpenChange={setShowAdHoc} />}
    </div>
  );
}
