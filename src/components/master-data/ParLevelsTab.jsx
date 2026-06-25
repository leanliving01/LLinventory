import React, { useState, useMemo, useEffect, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Search, X, AlertTriangle, Save, Check, Loader2, AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { groupMealsByPackage } from '@/lib/productionGrouping';
import { useSubcategories } from '@/lib/useSubcategories';
import { useAutoSave } from '@/lib/useAutoSave';
import ParPackageSummaryCard from './ParPackageSummaryCard';
import ParPackageDetailTable, { effectivePar } from './ParPackageDetailTable';

/**
 * Current Par Levels — the par-setting twin of Production Planning.
 *
 * Built on the SAME data-driven model as src/pages/ProductionPlanning.jsx:
 * finished_meal products grouped by their resolved Subcategory via
 * groupMealsByPackage(). That means Winter Warmer Range (and every future
 * meal/package) shows up automatically — no hard-coded package list. Edits are
 * written straight to products.par_level (the single source of truth Production
 * reads) and auto-saved as you type.
 */
export default function ParLevelsTab() {
  const queryClient = useQueryClient();
  const { rows: subcatRows } = useSubcategories();

  const [search, setSearch] = useState('');
  const [selectedPackage, setSelectedPackage] = useState(null);
  const [belowParOnly, setBelowParOnly] = useState(false);
  const [parEdits, setParEdits] = useState({}); // productId → string (in-progress edit)

  // ── Data (shares cache keys with Production Planning so edits stay in sync) ──
  const { data: finishedMeals = [], isLoading } = useQuery({
    queryKey: ['finished-meals'],
    queryFn: () => base44.entities.Product.filter({ type: 'finished_meal', status: 'active' }, '-sku', 500),
    refetchOnWindowFocus: true,
  });

  const { data: stockRecords = [] } = useQuery({
    queryKey: ['stock-on-hand'],
    queryFn: () => base44.entities.StockOnHand.list('-updated_date', 1000),
    refetchOnWindowFocus: true,
  });

  // Live updates — reflect new/changed products, stock and subcategories without a
  // manual refresh (mirrors ProductionPlanning). refetchOnWindowFocus is the fallback.
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
      map[pid].qty_on_hand   += s.qty_on_hand   || 0;
      map[pid].qty_committed += s.qty_committed || 0;
      map[pid].qty_available += s.qty_available || 0;
    });
    return map;
  }, [stockRecords]);

  const productById = useMemo(() => {
    const m = {};
    finishedMeals.forEach(p => { m[p.id] = p; });
    return m;
  }, [finishedMeals]);

  // ── Package grouping (data-driven by Subcategory — incl. Winter Warmer) ──────
  const packages = useMemo(
    () => groupMealsByPackage(finishedMeals, subcatRows),
    [finishedMeals, subcatRows]
  );

  // Per-package stats for the summary cards
  const packageStats = useMemo(() => {
    const stats = {};
    packages.forEach(pkg => {
      let parSet = 0, belowPar = 0, atPar = 0, parSum = 0;
      pkg.meals.forEach(({ product }) => {
        const soh = stockMap[product.id]?.qty_on_hand || 0;
        const com = stockMap[product.id]?.qty_committed || 0;
        const available = soh - com;
        const par = effectivePar(product, parEdits);
        if (par > 0) {
          parSet++;
          parSum += par;
          if (available < par) belowPar++; else atPar++;
        }
      });
      stats[pkg.code] = {
        totalMeals: pkg.meals.length,
        parSet,
        belowPar,
        onParPct: parSet > 0 ? (atPar / parSet) * 100 : 100,
        avgPar: parSet > 0 ? Math.round(parSum / parSet) : 0,
      };
    });
    return stats;
  }, [packages, stockMap, parEdits]);

  // Global totals for the summary strip
  const { belowParCount, parSetCount, mealCount } = useMemo(() => {
    let below = 0, set = 0, meals = 0;
    packages.forEach(pkg => {
      pkg.meals.forEach(({ product }) => {
        meals++;
        const soh = stockMap[product.id]?.qty_on_hand || 0;
        const com = stockMap[product.id]?.qty_committed || 0;
        const available = soh - com;
        const par = effectivePar(product, parEdits);
        if (par > 0) {
          set++;
          if (available < par) below++;
        }
      });
    });
    return { belowParCount: below, parSetCount: set, mealCount: meals };
  }, [packages, stockMap, parEdits]);

  // ── Auto-save ────────────────────────────────────────────────────────────────
  // Debounced background save: writes only the par values that differ from what's
  // stored, straight to products.par_level. Blank edits ('') are skipped (treated
  // as "unchanged"), so clearing a box never wipes a par to zero — type 0 for that.
  const autoSave = useAutoSave(async () => {
    const dirty = Object.entries(parEdits).filter(([id, v]) => {
      if (v === '' || v === undefined) return false;
      const n = Number(v);
      if (Number.isNaN(n) || n < 0) return false;
      return n !== (productById[id]?.par_level || 0);
    });
    if (dirty.length === 0) return;
    for (const [id, v] of dirty) {
      await base44.entities.Product.update(id, { par_level: Number(v) });
    }
    queryClient.invalidateQueries({ queryKey: ['finished-meals'] });
  });

  const handleParChange = (productId, value) => {
    setParEdits(prev => ({ ...prev, [productId]: value }));
  };

  // Trigger the debounced save whenever an edit changes (skip the first render).
  const firstRun = useRef(true);
  useEffect(() => {
    if (firstRun.current) { firstRun.current = false; return; }
    autoSave.trigger();
  }, [parEdits]);

  // ── Render ─────────────────────────────────────────────────────────────────
  if (isLoading) {
    return <div className="text-center py-12 text-sm text-muted-foreground">Loading meals…</div>;
  }

  return (
    <div className="space-y-4">
      {/* Summary strip */}
      <div className="flex items-center gap-6 bg-card border border-border rounded-xl px-6 py-4 flex-wrap">
        <div>
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold">Below Par</p>
          <p className="text-lg font-bold text-red-600">{belowParCount}</p>
        </div>
        <div className="w-px h-8 bg-border" />
        <div>
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold">Par Set</p>
          <p className="text-lg font-bold text-foreground">{parSetCount}<span className="text-sm text-muted-foreground font-medium">/{mealCount}</span></p>
        </div>
        <div className="w-px h-8 bg-border" />
        <div>
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold">Meals</p>
          <p className="text-lg font-bold text-foreground">{mealCount}</p>
        </div>
        <div className="w-px h-8 bg-border" />
        <div>
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold">Packages</p>
          <p className="text-lg font-bold text-foreground">{packages.length}</p>
        </div>

        <div className="ml-auto">
          <AutoSaveStatus status={autoSave.status} />
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
          <ParPackageSummaryCard
            key={pkg.code}
            pkg={pkg}
            stats={packageStats[pkg.code] || { totalMeals: 0, parSet: 0, belowPar: 0, onParPct: 100, avgPar: 0 }}
            selected={selectedPackage === pkg.code}
            onClick={() => setSelectedPackage(prev => prev === pkg.code ? null : pkg.code)}
          />
        ))}
      </div>

      {/* Package detail sections */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-sm font-semibold text-foreground">Package Details</h2>
          <p className="text-xs text-muted-foreground">Set the par level for each meal — saves automatically</p>
        </div>
        <ParPackageDetailTable
          packages={packages}
          selectedPackage={selectedPackage}
          stockMap={stockMap}
          parEdits={parEdits}
          onParChange={handleParChange}
          search={search}
          belowParOnly={belowParOnly}
        />
      </div>
    </div>
  );
}

// Small inline indicator for the debounced auto-save state
// (mirrors WebCountEntrySheet's helper so the two screens feel the same).
function AutoSaveStatus({ status }) {
  if (status === 'idle') return null;
  const map = {
    unsaved: { icon: <Save className="w-3.5 h-3.5" />, text: 'Unsaved changes…', cls: 'text-muted-foreground' },
    saving:  { icon: <Loader2 className="w-3.5 h-3.5 animate-spin" />, text: 'Saving…', cls: 'text-muted-foreground' },
    saved:   { icon: <Check className="w-3.5 h-3.5" />, text: 'All changes saved', cls: 'text-green-600' },
    error:   { icon: <AlertCircle className="w-3.5 h-3.5" />, text: 'Auto-save failed — keep this tab open', cls: 'text-red-600' },
  };
  const s = map[status];
  if (!s) return null;
  return (
    <span className={cn('inline-flex items-center gap-1.5 text-xs font-medium', s.cls)}>
      {s.icon}{s.text}
    </span>
  );
}
