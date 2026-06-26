import React, { useState, useEffect, useRef } from 'react';
import { Input } from '@/components/ui/input';
import { ChevronDown, ChevronRight, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { hexToRgba } from '@/lib/productClassification';

// The effective par for a product = the in-progress edit if present, else the
// persisted products.par_level. Lets the below-par state update live as you type.
// A blank edit ('') means "left empty / unchanged" — it falls back to the stored
// value rather than 0, so clearing a box never silently wipes a par to zero (the
// same rule the auto-save uses; type an explicit 0 to set zero).
export function effectivePar(product, parEdits) {
  const edit = parEdits[product.id];
  if (edit === undefined || edit === '') return product.par_level || 0;
  const n = Number(edit);
  return Number.isNaN(n) ? (product.par_level || 0) : n;
}

// Coverage bar — identical to the Production Planning detail table.
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

// A native checkbox that supports the indeterminate (partial) state via ref.
function TriCheckbox({ checked, indeterminate, onChange, className, ariaLabel }) {
  const ref = useRef(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = !checked && !!indeterminate;
  }, [checked, indeterminate]);
  return (
    <input
      ref={ref}
      type="checkbox"
      aria-label={ariaLabel}
      checked={checked}
      onChange={e => onChange(e.target.checked)}
      onClick={e => e.stopPropagation()}
      className={cn('accent-primary w-4 h-4 shrink-0 cursor-pointer', className)}
    />
  );
}

function PackageSection({
  pkg, stockMap, parEdits, onParChange,
  selectedIds, onToggleOne, onToggleMany,
  defaultExpanded,
}) {
  const [expanded, setExpanded] = useState(defaultExpanded ?? true);
  const { fullLabel, categoryLabel, category, color, meals } = pkg;
  const dotColor = color || '#6b7280';
  const noun = category === 'finished_meal' ? 'meals' : 'items';

  useEffect(() => { setExpanded(defaultExpanded ?? true); }, [defaultExpanded]);

  if (meals.length === 0) return null;

  const ids = meals.map(({ product }) => product.id);
  const selectedCount = ids.filter(id => selectedIds.has(id)).length;
  const allSelected = selectedCount === ids.length && ids.length > 0;
  const someSelected = selectedCount > 0 && !allSelected;

  const sectionBelowPar = meals.filter(({ product }) => {
    const soh = stockMap[product.id]?.qty_on_hand || 0;
    const committed = stockMap[product.id]?.qty_committed || 0;
    const par = effectivePar(product, parEdits);
    return par > 0 && (soh - committed) < par;
  }).length;

  return (
    <div className="border border-border rounded-xl overflow-hidden">
      {/* Section header — collapse toggle + select-all */}
      <div
        className="w-full flex items-center gap-3 px-5 py-3 border-b border-border"
        style={{ backgroundColor: hexToRgba(dotColor, 0.12) }}
      >
        <TriCheckbox
          checked={allSelected}
          indeterminate={someSelected}
          onChange={(c) => onToggleMany(ids, c)}
          ariaLabel={`Select all ${fullLabel}`}
        />
        <button onClick={() => setExpanded(e => !e)} className="flex items-center gap-3 text-left flex-1 min-w-0">
          {expanded
            ? <ChevronDown className="w-4 h-4 shrink-0 text-muted-foreground" />
            : <ChevronRight className="w-4 h-4 shrink-0 text-muted-foreground" />}
          <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: dotColor }} />
          <span className="text-xs font-bold uppercase tracking-wide text-foreground truncate">{fullLabel}</span>
          <span className="text-[10px] text-muted-foreground uppercase tracking-wider shrink-0 hidden sm:inline">{categoryLabel}</span>
          <span className="text-xs text-muted-foreground shrink-0">{meals.length} {noun}</span>
          {selectedCount > 0 && (
            <span className="text-[11px] text-primary font-semibold shrink-0">{selectedCount} selected</span>
          )}
          {sectionBelowPar > 0 && (
            <span className="ml-1 flex items-center gap-1 text-[11px] text-red-500 font-medium shrink-0">
              <AlertTriangle className="w-3 h-3" />
              {sectionBelowPar} below par
            </span>
          )}
        </button>
      </div>

      {expanded && (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr className="bg-muted/30 border-b border-border">
                <th className="w-10 px-3 py-2 sticky left-0 bg-muted/30">
                  <TriCheckbox
                    checked={allSelected}
                    indeterminate={someSelected}
                    onChange={(c) => onToggleMany(ids, c)}
                    ariaLabel={`Select all ${fullLabel}`}
                  />
                </th>
                <th className="text-left px-4 py-2 text-[10px] text-muted-foreground uppercase font-semibold tracking-wide sticky left-10 bg-muted/30 min-w-[220px]">
                  Product
                </th>
                <th className="text-right px-3 py-2 text-[10px] text-muted-foreground uppercase font-semibold tracking-wide">SOH</th>
                <th className="text-right px-3 py-2 text-[10px] text-muted-foreground uppercase font-semibold tracking-wide">Committed</th>
                <th className="text-right px-3 py-2 text-[10px] text-muted-foreground uppercase font-semibold tracking-wide">Available</th>
                <th className="text-center px-3 py-2 text-[10px] text-muted-foreground uppercase font-semibold tracking-wide">Par Level</th>
                <th className="px-3 py-2 text-[10px] text-muted-foreground uppercase font-semibold tracking-wide">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {meals.map(({ baseName, product }) => {
                const soh = stockMap[product.id]?.qty_on_hand || 0;
                const committed = stockMap[product.id]?.qty_committed || 0;
                const available = soh - committed;
                const par = effectivePar(product, parEdits);
                const isBelowPar = par > 0 && available < par;
                const pct = par > 0 ? (available / par) * 100 : 100;
                const inputValue = parEdits[product.id] ?? (product.par_level || '');
                const isSelected = selectedIds.has(product.id);

                return (
                  <tr
                    key={product.id}
                    className={cn(
                      'hover:bg-muted/20 transition-colors',
                      isSelected && 'bg-primary/5',
                      !isSelected && isBelowPar && 'bg-red-50/40 dark:bg-red-950/10'
                    )}
                  >
                    {/* Row select */}
                    <td className="w-10 px-3 py-2.5 sticky left-0 bg-card">
                      <TriCheckbox
                        checked={isSelected}
                        onChange={() => onToggleOne(product.id)}
                        ariaLabel={`Select ${baseName}`}
                      />
                    </td>

                    {/* Product name */}
                    <td className="px-4 py-2.5 sticky left-10 bg-card">
                      <div className="flex items-center gap-2">
                        {par === 0
                          ? <span className="w-3.5 h-3.5 shrink-0" />
                          : isBelowPar
                            ? <AlertTriangle className="w-3.5 h-3.5 text-red-500 shrink-0" />
                            : <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />}
                        <span className="text-sm font-medium text-foreground">{baseName}</span>
                        {product.sku && (
                          <span className="text-[10px] font-mono text-muted-foreground shrink-0">{product.sku}</span>
                        )}
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

                    {/* Par level (editable) */}
                    <td className="px-3 py-2.5 text-center">
                      <Input
                        type="number"
                        min="0"
                        placeholder="Set…"
                        value={inputValue}
                        onChange={e => onParChange(product.id, e.target.value)}
                        className="w-20 text-right h-7 text-[11px] px-1 mx-auto"
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
 * Renders pre-filtered (category, subcategory) groups as collapsible sections,
 * each with a per-product par table and multi-select checkboxes. Filtering is
 * done by the parent (ParLevelsTab) so this stays a dumb renderer.
 *
 * Props:
 *   packages     – filtered groups from groupProductsForPar()
 *   stockMap     – { productId: { qty_on_hand, qty_committed } }
 *   parEdits     – { productId: string } in-progress edits
 *   onParChange  – (productId, value) => void
 *   selectedIds  – Set<string>
 *   onToggleOne  – (productId) => void
 *   onToggleMany – (ids[], checked) => void
 *   expandAll    – boolean (expand every section, e.g. when search/filter active)
 */
export default function ParPackageDetailTable({
  packages,
  stockMap,
  parEdits,
  onParChange,
  selectedIds,
  onToggleOne,
  onToggleMany,
  expandAll,
}) {
  if (!packages || packages.length === 0) return (
    <div className="text-center py-12 text-sm text-muted-foreground">No products match the current filters.</div>
  );

  return (
    <div className="space-y-3">
      {packages.map(pkg => (
        <PackageSection
          key={pkg.code}
          pkg={pkg}
          stockMap={stockMap}
          parEdits={parEdits}
          onParChange={onParChange}
          selectedIds={selectedIds}
          onToggleOne={onToggleOne}
          onToggleMany={onToggleMany}
          defaultExpanded={expandAll || packages.length <= 3}
        />
      ))}
    </div>
  );
}
