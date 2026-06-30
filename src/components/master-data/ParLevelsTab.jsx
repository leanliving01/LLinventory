import React, { useState, useMemo, useEffect, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Search, X, AlertTriangle, Save, Check, Loader2, AlertCircle, CheckSquare, ListChecks } from 'lucide-react';
import { cn } from '@/lib/utils';
import { groupProductsForPar, categoriesFromGroups } from '@/lib/parGrouping';
import { useSubcategories } from '@/lib/useSubcategories';
import { useStockLevels } from '@/lib/useStockLevels';
import { useAutoSave } from '@/lib/useAutoSave';
import { useUnsavedChanges } from '@/lib/navigationGuard';
import ParPackageSummaryCard from './ParPackageSummaryCard';
import ParPackageDetailTable, { effectivePar } from './ParPackageDetailTable';

/**
 * Current Par Levels — set the minimum stock threshold for EVERY product, not
 * just finished meals. Products group by Category (Finished Meal, Supplement,
 * Raw Material, Packaging, …) → Subcategory/package, mirroring the catalog's
 * classification (resolveSubcategory). Edits write straight to products.par_level
 * (the single source of truth Production Planning reads) and auto-save as you
 * type. Rows can be multi-selected to set a par level across many products at
 * once — pick a category, "select all", type a value, Apply.
 */
export default function ParLevelsTab() {
  const queryClient = useQueryClient();
  const { rows: subcatRows } = useSubcategories();

  const [search, setSearch] = useState('');
  const [selectedCategory, setSelectedCategory] = useState(null); // product.type or null = all
  const [selectedPackage, setSelectedPackage] = useState(null);   // group code or null
  const [belowParOnly, setBelowParOnly] = useState(false);
  const [parEdits, setParEdits] = useState({}); // productId → string (in-progress edit)
  const [selectedIds, setSelectedIds] = useState(() => new Set()); // bulk selection
  const [bulkValue, setBulkValue] = useState('');

  // ── Data (all active products — every category gets a par row) ──────────────
  const { data: products = [], isLoading } = useQuery({
    queryKey: ['par-products'],
    queryFn: () => base44.entities.Product.filter({ status: 'active' }, '-sku', 3000),
    refetchOnWindowFocus: true,
  });

  // Canonical, never-truncated per-product stock (RPC) — see lib/useStockLevels.js.
  const { rows: stockRecords = [] } = useStockLevels({ refetchOnWindowFocus: true });

  // Live updates — reflect new/changed products, stock and subcategories.
  useEffect(() => {
    const invalidate = (key) => () => queryClient.invalidateQueries({ queryKey: [key] });
    const unsubs = [
      base44.entities.Product.subscribe(invalidate('par-products')),
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
    products.forEach(p => { m[p.id] = p; });
    return m;
  }, [products]);

  // ── Grouping (Category → Subcategory, data-driven) ──────────────────────────
  const groups = useMemo(
    () => groupProductsForPar(products, subcatRows),
    [products, subcatRows]
  );
  const categories = useMemo(() => categoriesFromGroups(groups), [groups]);

  // Reset the subcategory drill-down whenever the category filter changes.
  useEffect(() => { setSelectedPackage(null); }, [selectedCategory]);

  // Per-group stats for the summary cards (over the full group, unfiltered).
  const groupStats = useMemo(() => {
    const stats = {};
    groups.forEach(g => {
      let parSet = 0, belowPar = 0, atPar = 0, parSum = 0;
      g.meals.forEach(({ product }) => {
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
      stats[g.code] = {
        totalMeals: g.meals.length,
        parSet,
        belowPar,
        onParPct: parSet > 0 ? (atPar / parSet) * 100 : 100,
        avgPar: parSet > 0 ? Math.round(parSum / parSet) : 0,
      };
    });
    return stats;
  }, [groups, stockMap, parEdits]);

  // Global totals for the summary strip.
  const { belowParCount, parSetCount, productCount } = useMemo(() => {
    let below = 0, set = 0, count = 0;
    groups.forEach(g => g.meals.forEach(({ product }) => {
      count++;
      const soh = stockMap[product.id]?.qty_on_hand || 0;
      const com = stockMap[product.id]?.qty_committed || 0;
      const available = soh - com;
      const par = effectivePar(product, parEdits);
      if (par > 0) { set++; if (available < par) below++; }
    }));
    return { belowParCount: below, parSetCount: set, productCount: count };
  }, [groups, stockMap, parEdits]);

  // ── Filtering → the groups actually shown ───────────────────────────────────
  const displayGroups = useMemo(() => {
    const q = search.trim().toLowerCase();
    return groups
      .filter(g => !selectedCategory || g.category === selectedCategory)
      .filter(g => !selectedPackage || g.code === selectedPackage)
      .map(g => {
        const groupMatch = q && (
          g.fullLabel.toLowerCase().includes(q) || g.categoryLabel.toLowerCase().includes(q)
        );
        const meals = g.meals.filter(({ baseName, product }) => {
          if (q && !groupMatch
            && !baseName.toLowerCase().includes(q)
            && !(product.name || '').toLowerCase().includes(q)
            && !(product.sku || '').toLowerCase().includes(q)) return false;
          if (belowParOnly) {
            const soh = stockMap[product.id]?.qty_on_hand || 0;
            const com = stockMap[product.id]?.qty_committed || 0;
            const par = effectivePar(product, parEdits);
            if (par === 0 || (soh - com) >= par) return false;
          }
          return true;
        });
        return { ...g, meals };
      })
      .filter(g => g.meals.length > 0);
  }, [groups, selectedCategory, selectedPackage, search, belowParOnly, stockMap, parEdits]);

  const visibleIds = useMemo(
    () => displayGroups.flatMap(g => g.meals.map(m => m.product.id)),
    [displayGroups]
  );

  // Cards for the selected category's subcategories (hidden in the "All" view).
  const categoryGroups = useMemo(
    () => (selectedCategory ? groups.filter(g => g.category === selectedCategory) : []),
    [groups, selectedCategory]
  );

  // ── Auto-save ────────────────────────────────────────────────────────────────
  // Debounced background save: writes only par values that differ from what's
  // stored, straight to products.par_level. Blank edits ('') are skipped, so
  // clearing a box never wipes a par to zero — type 0 for that.
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
    queryClient.invalidateQueries({ queryKey: ['par-products'] });
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

  // Par edits auto-save (debounced) — guard the pending/in-flight window plus
  // 'error' (a failed save still holds unpersisted edits) so a value typed just
  // before leaving the tab isn't silently dropped.
  useUnsavedChanges(['unsaved', 'saving', 'error'].includes(autoSave.status), {
    message: 'A par level you just changed is still saving. Leave anyway?',
  });

  // ── Selection ────────────────────────────────────────────────────────────────
  const toggleOne = (id) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };
  const toggleMany = (ids, checked) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      ids.forEach(id => { checked ? next.add(id) : next.delete(id); });
      return next;
    });
  };
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every(id => selectedIds.has(id));
  const selectAllVisible = () => toggleMany(visibleIds, !allVisibleSelected);
  const clearSelection = () => setSelectedIds(new Set());

  // Apply the bulk value to every selected product (feeds the same auto-save).
  const applyBulk = () => {
    const n = Number(bulkValue);
    if (bulkValue === '' || Number.isNaN(n) || n < 0) return;
    setParEdits(prev => {
      const next = { ...prev };
      selectedIds.forEach(id => { next[id] = String(n); });
      return next;
    });
    setBulkValue('');
  };

  // Drop selections that scroll out of view when filters change (keeps the
  // "N selected" count honest about what Apply will touch).
  useEffect(() => {
    setSelectedIds(prev => {
      if (prev.size === 0) return prev;
      const visible = new Set(visibleIds);
      const next = new Set([...prev].filter(id => visible.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [visibleIds]);

  // ── Render ─────────────────────────────────────────────────────────────────
  if (isLoading) {
    return <div className="text-center py-12 text-sm text-muted-foreground">Loading products…</div>;
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
          <p className="text-lg font-bold text-foreground">{parSetCount}<span className="text-sm text-muted-foreground font-medium">/{productCount}</span></p>
        </div>
        <div className="w-px h-8 bg-border" />
        <div>
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold">Products</p>
          <p className="text-lg font-bold text-foreground">{productCount}</p>
        </div>
        <div className="w-px h-8 bg-border" />
        <div>
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold">Categories</p>
          <p className="text-lg font-bold text-foreground">{categories.length}</p>
        </div>

        <div className="ml-auto">
          <AutoSaveStatus status={autoSave.status} />
        </div>
      </div>

      {/* Category nav chips */}
      <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
        <CategoryChip
          label="All Products"
          active={selectedCategory === null}
          onClick={() => setSelectedCategory(null)}
        />
        {categories.map(c => (
          <CategoryChip
            key={c.category}
            label={c.label}
            active={selectedCategory === c.category}
            onClick={() => setSelectedCategory(prev => prev === c.category ? null : c.category)}
          />
        ))}
      </div>

      {/* Search + filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search products, SKUs, categories…"
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
        <Button
          variant="outline"
          size="sm"
          onClick={selectAllVisible}
          disabled={visibleIds.length === 0}
          className="gap-1.5 h-9"
        >
          <ListChecks className="w-3.5 h-3.5" />
          {allVisibleSelected ? 'Clear selection' : `Select all in view (${visibleIds.length})`}
        </Button>
      </div>

      {/* Subcategory summary cards (only when a category is selected) */}
      {categoryGroups.length > 0 && (
        <div className="flex gap-3 overflow-x-auto pb-1 -mx-1 px-1">
          {categoryGroups.map(g => (
            <ParPackageSummaryCard
              key={g.code}
              pkg={g}
              stats={groupStats[g.code] || { totalMeals: 0, parSet: 0, belowPar: 0, onParPct: 100, avgPar: 0 }}
              selected={selectedPackage === g.code}
              onClick={() => setSelectedPackage(prev => prev === g.code ? null : g.code)}
            />
          ))}
        </div>
      )}

      {/* Bulk-edit action bar */}
      {selectedIds.size > 0 && (
        <div className="sticky top-2 z-20 flex items-center gap-3 bg-primary/10 border border-primary/30 rounded-xl px-4 py-2.5 backdrop-blur-sm flex-wrap shadow-sm">
          <span className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
            <CheckSquare className="w-4 h-4 text-primary" />
            {selectedIds.size} selected
          </span>
          <div className="w-px h-6 bg-primary/20" />
          <label className="text-xs text-muted-foreground font-medium">Set par level to</label>
          <Input
            type="number"
            min="0"
            placeholder="e.g. 75"
            value={bulkValue}
            onChange={e => setBulkValue(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') applyBulk(); }}
            className="w-28 h-8"
          />
          <Button size="sm" onClick={applyBulk} disabled={bulkValue === ''} className="h-8 gap-1.5">
            <Check className="w-3.5 h-3.5" /> Apply to {selectedIds.size}
          </Button>
          <Button variant="ghost" size="sm" onClick={clearSelection} className="h-8 gap-1 ml-auto">
            <X className="w-3.5 h-3.5" /> Clear
          </Button>
        </div>
      )}

      {/* Detail sections */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-sm font-semibold text-foreground">Par Levels</h2>
          <p className="text-xs text-muted-foreground">Set the par level per product — saves automatically. Tick rows to set many at once.</p>
        </div>
        <ParPackageDetailTable
          packages={displayGroups}
          stockMap={stockMap}
          parEdits={parEdits}
          onParChange={handleParChange}
          selectedIds={selectedIds}
          onToggleOne={toggleOne}
          onToggleMany={toggleMany}
          expandAll={!!search || belowParOnly || !!selectedPackage || displayGroups.length <= 3}
        />
      </div>
    </div>
  );
}

// Category nav chip
function CategoryChip({ label, active, onClick }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'px-4 py-2 rounded-lg border text-xs font-semibold shrink-0 transition-all whitespace-nowrap',
        active
          ? 'border-primary border-2 bg-primary/5 text-primary shadow-sm'
          : 'border-border bg-card text-muted-foreground hover:border-primary/40'
      )}
    >
      {label}
    </button>
  );
}

// Small inline indicator for the debounced auto-save state.
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
