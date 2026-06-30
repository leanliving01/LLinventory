import React, { useState, useEffect } from 'react';
import { Input } from '@/components/ui/input';
import { ChevronDown, ChevronRight, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { hexToRgba } from '@/lib/productClassification';

function StatusBar({ pct }) {
  const clamped = Math.min(100, Math.max(0, pct));
  return (
    <div className="flex items-center gap-2 min-w-[80px]">
      <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
        <div
          className={cn(
            'h-full rounded-full transition-all',
            clamped >= 100 ? 'bg-emerald-500' : clamped >= 60 ? 'bg-amber-400' : 'bg-red-500'
          )}
          style={{ width: `${clamped}%` }}
        />
      </div>
      <span className="text-[10px] tabular-nums text-muted-foreground w-7 text-right">{Math.round(clamped)}%</span>
    </div>
  );
}

// Short, human reason for why the engine recommends (or skips) a meal.
const REASON_BADGE = {
  backorder:    { label: 'Backorder', cls: 'text-red-600' },
  below_par:    { label: 'Below par', cls: 'text-amber-600' },
  catch_up:     { label: 'Catch-up', cls: 'text-indigo-600' },
  within_10pct: { label: 'Within 10%', cls: 'text-muted-foreground' },
  at_par:       { label: 'At par', cls: 'text-emerald-600' },
  no_par:       { label: 'No par', cls: 'text-muted-foreground' },
};

function PackageSection({ pkg, stockMap, recoMap, overrides, onOverride, search, belowParOnly, defaultExpanded }) {
  const [expanded, setExpanded] = useState(defaultExpanded ?? true);
  const { fullLabel, label, color, meals } = pkg;
  const dotColor = color || '#6b7280';

  // Sync expanded state when the parent changes defaultExpanded (e.g. package card selected/deselected)
  useEffect(() => { setExpanded(defaultExpanded ?? true); }, [defaultExpanded]);

  // If the search term matches the package name itself, show all meals in this section
  const packageMatch = search && (
    fullLabel.toLowerCase().includes(search.toLowerCase()) ||
    label.toLowerCase().includes(search.toLowerCase())
  );

  const filtered = meals.filter(({ baseName, product }) => {
    if (search && !packageMatch && !baseName.toLowerCase().includes(search.toLowerCase())) return false;
    if (belowParOnly) {
      const soh = stockMap[product.id]?.qty_on_hand || 0;
      const committed = stockMap[product.id]?.qty_committed || 0;
      const par = product.par_level || 0;
      if (par === 0 || (soh - committed) >= par) return false;
    }
    return true;
  });

  if (filtered.length === 0) return null;

  const sectionBelowPar = meals.filter(({ product }) => {
    const soh = stockMap[product.id]?.qty_on_hand || 0;
    const committed = stockMap[product.id]?.qty_committed || 0;
    const par = product.par_level || 0;
    return par > 0 && (soh - committed) < par;
  }).length;

  return (
    <div className="border border-border rounded-xl overflow-hidden">
      {/* Section header — acts as collapse toggle */}
      <button
        onClick={() => setExpanded(e => !e)}
        className="w-full flex items-center gap-3 px-5 py-3 text-left border-b border-border"
        style={{ backgroundColor: hexToRgba(dotColor, 0.12) }}
      >
        {expanded
          ? <ChevronDown className="w-4 h-4 shrink-0 text-muted-foreground" />
          : <ChevronRight className="w-4 h-4 shrink-0 text-muted-foreground" />}
        <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: dotColor }} />
        <span className="text-xs font-bold uppercase tracking-wide text-foreground">{fullLabel}</span>
        <span className="text-xs text-muted-foreground">{meals.length} meals</span>
        {sectionBelowPar > 0 && (
          <span className="ml-2 flex items-center gap-1 text-[11px] text-red-500 font-medium">
            <AlertTriangle className="w-3 h-3" />
            {sectionBelowPar} below par
          </span>
        )}
      </button>

      {expanded && (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr className="bg-muted/30 border-b border-border">
                <th className="text-left px-4 py-2 text-[10px] text-muted-foreground uppercase font-semibold tracking-wide sticky left-0 bg-muted/30 min-w-[220px]">
                  Meal
                </th>
                <th className="text-right px-3 py-2 text-[10px] text-muted-foreground uppercase font-semibold tracking-wide">SOH</th>
                <th className="text-right px-3 py-2 text-[10px] text-muted-foreground uppercase font-semibold tracking-wide">Committed</th>
                <th className="text-right px-3 py-2 text-[10px] text-muted-foreground uppercase font-semibold tracking-wide">Available</th>
                <th className="text-right px-3 py-2 text-[10px] text-muted-foreground uppercase font-semibold tracking-wide">Par</th>
                <th className="text-right px-3 py-2 text-[10px] text-muted-foreground uppercase font-semibold tracking-wide">Recommended</th>
                <th className="text-center px-3 py-2 text-[10px] text-muted-foreground uppercase font-semibold tracking-wide">Final</th>
                <th className="px-3 py-2 text-[10px] text-muted-foreground uppercase font-semibold tracking-wide">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filtered.map(({ baseName, product }) => {
                const soh = stockMap[product.id]?.qty_on_hand || 0;
                const committed = stockMap[product.id]?.qty_committed || 0;
                const available = soh - committed;
                const par = product.par_level || 0;
                const reco = recoMap?.[product.id] || {};
                const recommended = reco.recommended || 0;
                const finalQty = overrides[product.id] !== undefined ? Number(overrides[product.id]) : recommended;
                const isBelowPar = par > 0 && available < par;
                const pct = par > 0 ? (available / par) * 100 : 100;
                const badge = REASON_BADGE[reco.reason];

                return (
                  <tr
                    key={product.id}
                    className={cn(
                      'hover:bg-muted/20 transition-colors',
                      isBelowPar && 'bg-red-50/40 dark:bg-red-950/10'
                    )}
                  >
                    {/* Meal name */}
                    <td className="px-4 py-2.5 sticky left-0 bg-card">
                      <div className="flex items-center gap-2">
                        {isBelowPar
                          ? <AlertTriangle className="w-3.5 h-3.5 text-red-500 shrink-0" />
                          : <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />}
                        <span className="text-sm font-medium text-foreground">{baseName}</span>
                      </div>
                    </td>

                    {/* SOH */}
                    <td className="px-3 py-2.5 text-right text-xs tabular-nums text-foreground">{soh}</td>

                    {/* Committed */}
                    <td className={cn(
                      'px-3 py-2.5 text-right text-xs tabular-nums',
                      committed > 0 ? 'text-amber-600 font-medium' : 'text-muted-foreground'
                    )}>
                      {committed > 0 ? committed : '—'}
                    </td>

                    {/* Available */}
                    <td className={cn(
                      'px-3 py-2.5 text-right text-xs tabular-nums font-medium',
                      available < 0 ? 'text-red-600' : isBelowPar ? 'text-amber-600' : 'text-foreground'
                    )}>
                      {available}
                    </td>

                    {/* Par */}
                    <td className="px-3 py-2.5 text-right text-xs tabular-nums text-muted-foreground">
                      {par || '—'}
                    </td>

                    {/* Recommended (engine: backorder-first, >10% trigger, 6-day cap) */}
                    <td className={cn(
                      'px-3 py-2.5 text-right text-xs tabular-nums font-semibold',
                      recommended > 0 ? 'text-foreground' : 'text-muted-foreground'
                    )}>
                      <div className="flex flex-col items-end leading-tight">
                        <span>{recommended > 0 ? recommended : '—'}</span>
                        {badge && (
                          <span className={cn('text-[9px] font-medium uppercase tracking-wide', badge.cls)}>
                            {reco.capped ? 'Capped 6d' : badge.label}
                          </span>
                        )}
                      </div>
                    </td>

                    {/* Final (editable) */}
                    <td className="px-3 py-2.5 text-center">
                      <Input
                        type="number"
                        min="0"
                        value={overrides[product.id] ?? recommended}
                        onChange={e => onOverride(product.id, e.target.value)}
                        className="w-16 text-right h-7 text-[11px] px-1 mx-auto"
                      />
                    </td>

                    {/* Status bar */}
                    <td className="px-3 py-2.5">
                      <StatusBar pct={pct} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/**
 * Renders all packages as collapsible sections, each with a meal-level table.
 * When selectedPackage is set, only that package section is shown.
 *
 * Props:
 *   packages        – from groupMealsByPackage()
 *   selectedPackage – code string or null (null = all)
 *   stockMap        – { productId: { qty_on_hand, qty_committed } }
 *   overrides       – { productId: number }
 *   onOverride      – (productId, value) => void
 *   search          – string
 *   belowParOnly    – boolean
 */
export default function PackageDetailTable({
  packages,
  selectedPackage,
  stockMap,
  recoMap,
  overrides,
  onOverride,
  search,
  belowParOnly,
}) {
  const visible = selectedPackage
    ? packages.filter(p => p.code === selectedPackage)
    : packages;

  if (visible.length === 0) return (
    <div className="text-center py-12 text-sm text-muted-foreground">No meals match the current filters.</div>
  );

  // Check whether any section would actually render (post-filter)
  const anyVisible = visible.some(pkg => {
    const packageMatch = search && (
      pkg.fullLabel.toLowerCase().includes(search.toLowerCase()) ||
      pkg.label.toLowerCase().includes(search.toLowerCase())
    );
    return pkg.meals.some(({ baseName, product }) => {
      if (search && !packageMatch && !baseName.toLowerCase().includes(search.toLowerCase())) return false;
      if (belowParOnly) {
        const soh = stockMap[product.id]?.qty_on_hand || 0;
        const committed = stockMap[product.id]?.qty_committed || 0;
        const par = product.par_level || 0;
        if (par === 0 || (soh - committed) >= par) return false;
      }
      return true;
    });
  });

  if (!anyVisible) return (
    <div className="text-center py-12 text-sm text-muted-foreground">No meals match the current filters.</div>
  );

  return (
    <div className="space-y-3">
      {visible.map(pkg => (
        <PackageSection
          key={pkg.code}
          pkg={pkg}
          stockMap={stockMap}
          recoMap={recoMap}
          overrides={overrides}
          onOverride={onOverride}
          search={search}
          belowParOnly={belowParOnly}
          defaultExpanded={!!selectedPackage || visible.length <= 2}
        />
      ))}
    </div>
  );
}
