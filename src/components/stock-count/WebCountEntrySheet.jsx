import React, { useState, useMemo, useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Save, CheckCircle2, Search, Plus, ChevronDown, ChevronRight, ChevronsDownUp, ChevronsUpDown, Loader2, Check, AlertCircle } from 'lucide-react';
import { toast } from 'sonner';
import { saveFloorCounts, completeFloorCount, addCountLine, convertedFromLine, buildUomOptions, STOCK_UOM_KEY } from '@/lib/stockCount';
import { useAutoSave } from '@/lib/useAutoSave';
import { useUnsavedChanges } from '@/lib/navigationGuard';
import { CATEGORY_LABELS, CATEGORY_ORDER, CATEGORY_HEADER_BG, getSubcategoryColor, resolveSubcategory, hexToRgba, makeSubcategorySorter } from '@/lib/productClassification';
import { compareNatural } from '@/lib/naturalSort';
import { useSubcategories } from '@/lib/useSubcategories';
import { cn } from '@/lib/utils';

const fmtQty = (n) => {
  const v = Number(n);
  if (isNaN(v)) return '—';
  return Number.isInteger(v) ? String(v) : v.toFixed(2).replace(/\.?0+$/, '');
};

const STOCK_KEY = STOCK_UOM_KEY;

// Dropdown label: base unit shows just the unit; others show name + conversion hint.
const optionLabel = (o, stockUom) => {
  if ((o.key || STOCK_KEY) === STOCK_KEY) return o.count_uom;
  const name = o.count_uom_label ? `${o.count_uom} — ${o.count_uom_label}` : o.count_uom;
  return `${name}  (×${fmtQty(o.conversion_factor)} ${stockUom})`;
};

export default function WebCountEntrySheet({ countId, header, lines, products, sohByKey = {}, onSaved, onSubmitted }) {
  const { getSubcategoryHex } = useSubcategories();
  const productById = useMemo(() => Object.fromEntries(products.map(p => [p.id, p])), [products]);

  // Per-line input state.
  const [entries, setEntries] = useState({});   // lineId → counted qty (string, in the selected UOM)
  const [uomKey, setUomKey] = useState({});      // lineId → selected count-UOM option key
  const [broken, setBroken] = useState({});      // lineId → loose remainder (string, in the main stock UOM)
  const [seeded, setSeeded] = useState(false);

  const [saving, setSaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Collapsed tracks keys the user has closed (true = closed). Everything starts
  // CLOSED — the effect below initialises new groups to true so the sheet opens
  // fully collapsed and the user expands only what they're counting.
  const [collapsed, setCollapsed] = useState({});
  const toggleCollapse = (key) =>
    setCollapsed(prev => ({ ...prev, [key]: !prev[key] }));

  // Add-item state
  const [addSearch, setAddSearch] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [addingLine, setAddingLine] = useState(false);

  // ── Count-UOM options per product (base unit + Stock Count Units + Purchasing Units) ─
  const productIds = useMemo(() => Array.from(new Set(lines.map(l => l.product_id))), [lines]);
  const { data: countUoms = [], isLoading: uomsLoading } = useQuery({
    queryKey: ['web-count-uoms', countId, productIds.length],
    queryFn: () => base44.entities.StockCountUom.filter({ product_id: productIds }, 'count_uom', 5000),
    enabled: productIds.length > 0,
  });
  const { data: supplierProducts = [], isLoading: spLoading } = useQuery({
    queryKey: ['web-count-supplier-uoms', countId, productIds.length],
    queryFn: () => base44.entities.SupplierProduct.filter({ product_id: productIds }, 'purchase_uom_label', 5000),
    enabled: productIds.length > 0,
  });

  const optionsByLine = useMemo(() => {
    const cuByProduct = {}, spByProduct = {};
    countUoms.forEach(u => { (cuByProduct[u.product_id] = cuByProduct[u.product_id] || []).push(u); });
    supplierProducts.forEach(sp => { (spByProduct[sp.product_id] = spByProduct[sp.product_id] || []).push(sp); });
    const map = {};
    lines.forEach(l => {
      map[l.id] = buildUomOptions(l.stock_uom, cuByProduct[l.product_id] || [], spByProduct[l.product_id] || []);
    });
    return map;
  }, [lines, countUoms, supplierProducts]);

  // ── Seed inputs from saved lines (once UOM options are loaded) ───────────────
  useEffect(() => {
    if (seeded || !lines.length) return;
    if (productIds.length && (uomsLoading || spLoading)) return; // wait for registered UOMs so we seed the right unit
    const initEntries = {}, initUom = {}, initBroken = {};
    lines.forEach(l => {
      if (l.counted_qty != null) initEntries[l.id] = String(l.counted_qty);
      if (l.broken_units != null && Number(l.broken_units) !== 0) initBroken[l.id] = String(l.broken_units);
      const opts = optionsByLine[l.id] || [];
      const match = opts.find(o =>
        o.key !== STOCK_KEY &&
        o.count_uom === l.count_uom &&
        Number(o.conversion_factor) === Number(l.conversion_factor)
      );
      initUom[l.id] = match ? match.key : STOCK_KEY;
    });
    setEntries(initEntries);
    setUomKey(initUom);
    setBroken(initBroken);
    setSeeded(true);
  }, [seeded, lines, productIds.length, uomsLoading, spLoading, optionsByLine]);

  // ── Grouping: category → subcategory → product name ──────────────────────────
  const grouped = useMemo(() => {
    const cats = {}; // { [cat]: { [sub]: { [productName]: line[] } } }
    for (const line of lines) {
      const product = productById[line.product_id];
      const cat = product?.type || '__unknown__';
      const sub = product ? resolveSubcategory(product) : 'Unknown';
      const pname = line.product_name || 'Unknown Product';
      if (!cats[cat]) cats[cat] = {};
      if (!cats[cat][sub]) cats[cat][sub] = {};
      if (!cats[cat][sub][pname]) cats[cat][sub][pname] = [];
      cats[cat][sub][pname].push(line);
    }
    const order = [...CATEGORY_ORDER.filter(c => cats[c]), ...(cats['__unknown__'] ? ['__unknown__'] : [])];
    return { order, cats };
  }, [lines, productById]);

  // Every collapsible key (categories + each category::subcategory).
  const allKeys = useMemo(() => {
    const keys = [];
    grouped.order.forEach(cat => {
      keys.push(cat);
      Object.keys(grouped.cats[cat] || {}).forEach(sub => keys.push(`${cat}::${sub}`));
    });
    return keys;
  }, [grouped]);

  // Initialise every new group key as CLOSED (true) the moment it appears.
  useEffect(() => {
    if (!allKeys.length) return;
    setCollapsed(prev => {
      const next = { ...prev };
      let changed = false;
      allKeys.forEach(k => { if (!(k in next)) { next[k] = true; changed = true; } });
      return changed ? next : prev;
    });
  }, [allKeys]);

  const setAllCollapsed = (val) => setCollapsed(Object.fromEntries(allKeys.map(k => [k, val])));
  const allOpen = allKeys.length > 0 && allKeys.every(k => !collapsed[k]);

  // ── Counts ───────────────────────────────────────────────────────────────────
  const enteredCount = useMemo(() => {
    const ids = new Set();
    Object.entries(entries).forEach(([id, v]) => { if (v !== '' && v != null) ids.add(id); });
    Object.entries(broken).forEach(([id, v]) => { if (v !== '' && v != null) ids.add(id); });
    return ids.size;
  }, [entries, broken]);

  // Only persist lines that carry a value now, OR were already counted (so
  // clearing a previously-saved count is written back). Untouched, never-counted
  // lines are skipped — keeps each save small even for a big count.
  const buildPayload = () => lines
    .filter(l => {
      const hasEntry = entries[l.id] !== '' && entries[l.id] != null;
      const hasBroken = broken[l.id] !== '' && broken[l.id] != null;
      const wasCounted = l.counted_qty != null || (l.broken_units != null && Number(l.broken_units) !== 0);
      return hasEntry || hasBroken || wasCounted;
    })
    .map(l => {
      const opts = optionsByLine[l.id] || [];
      const sel = opts.find(o => o.key === (uomKey[l.id] || STOCK_KEY)) || opts[0];
      return {
        id: l.id,
        counted_qty: entries[l.id] ?? null,
        broken_units: broken[l.id] ?? null,
        count_uom: sel?.count_uom,
        count_uom_label: sel?.count_uom_label || null,
        conversion_factor: sel?.conversion_factor || 1,
      };
    });

  // ── Auto-save ───────────────────────────────────────────────────────────────
  // Debounced background save so a dropped connection / closed tab never loses
  // more than the last line typed. Saves silently; the indicator shows status.
  const autoSave = useAutoSave(async () => {
    await saveFloorCounts(countId, buildPayload(), 'web');
  });

  // Trigger an auto-save whenever the user changes a count, unit, or loose qty —
  // but not on the initial seed (firstRun guard).
  const firstRun = useRef(true);
  useEffect(() => {
    if (!seeded) return;
    if (firstRun.current) { firstRun.current = false; return; }
    autoSave.trigger();
  }, [entries, broken, uomKey, seeded]); // eslint-disable-line react-hooks/exhaustive-deps

  // Counts auto-save (debounced), so the only truly-unsaved window is the gap
  // between typing and the next flush — plus 'error' (a failed save still holds
  // unpersisted edits) so a dropped count can't be silently lost on leave.
  useUnsavedChanges(['unsaved', 'saving', 'error'].includes(autoSave.status), {
    message: 'A stock count you just entered is still saving. Leave anyway?',
  });

  // ── Save draft ────────────────────────────────────────────────────────────────
  const handleSaveDraft = async () => {
    autoSave.cancel();
    setSaving(true);
    try {
      await saveFloorCounts(countId, buildPayload(), 'web');
      autoSave.markSaved();
      toast.success('Draft saved');
      onSaved?.();
    } catch (err) {
      toast.error('Save failed: ' + (err.message || 'Unknown error'));
    } finally {
      setSaving(false);
    }
  };

  // ── Submit for review ─────────────────────────────────────────────────────────
  const handleSubmit = async () => {
    if (enteredCount === 0) { toast.error('Enter at least one count before submitting'); return; }
    autoSave.cancel();
    setSubmitting(true);
    try {
      await saveFloorCounts(countId, buildPayload(), 'web');
      await completeFloorCount(countId, 'web');
      toast.success('Count submitted for review');
      onSubmitted?.();
    } catch (err) {
      toast.error('Submit failed: ' + (err.message || 'Unknown error'));
    } finally {
      setSubmitting(false);
    }
  };

  // ── Add item ──────────────────────────────────────────────────────────────────
  const existingProductIds = useMemo(() => new Set(lines.map(l => l.product_id)), [lines]);

  const addResults = useMemo(() => {
    if (!addSearch.trim()) return [];
    const q = addSearch.toLowerCase();
    return products
      .filter(p =>
        !existingProductIds.has(p.id) &&
        (p.name?.toLowerCase().includes(q) || (p.sku || '').toLowerCase().includes(q))
      )
      .slice(0, 8);
  }, [addSearch, products, existingProductIds]);

  const handleAddProduct = async (product) => {
    setAddingLine(true);
    try {
      await addCountLine(countId, product, header.location_id, header.location_name);
      setAddSearch('');
      setShowAdd(false);
      toast.success(`${product.name} added to count`);
      onSaved?.();
    } catch (err) {
      toast.error('Failed to add: ' + (err.message || 'Unknown error'));
    } finally {
      setAddingLine(false);
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-3">
      {/* Action bar */}
      <div className="flex items-center justify-between flex-wrap gap-2 bg-card border border-border rounded-xl px-4 py-3">
        <div className="flex items-center gap-3 flex-wrap">
          <p className="text-sm text-muted-foreground">
            <span className="font-semibold text-foreground">{enteredCount}</span> of{' '}
            <span className="font-semibold text-foreground">{lines.length}</span> lines entered
          </p>
          <AutoSaveStatus status={autoSave.status} />
          {allKeys.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setAllCollapsed(allOpen)}
              className="gap-1.5 text-muted-foreground h-7 px-2"
            >
              {allOpen ? <ChevronsDownUp className="w-3.5 h-3.5" /> : <ChevronsUpDown className="w-3.5 h-3.5" />}
              {allOpen ? 'Collapse all' : 'Expand all'}
            </Button>
          )}
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={handleSaveDraft} disabled={saving || submitting} className="gap-1.5">
            <Save className="w-3.5 h-3.5" />
            {saving ? 'Saving…' : 'Save Draft'}
          </Button>
          <Button size="sm" onClick={handleSubmit} disabled={saving || submitting} className="gap-1.5 bg-green-600 hover:bg-green-700">
            <CheckCircle2 className="w-3.5 h-3.5" />
            {submitting ? 'Submitting…' : 'Submit for Review'}
          </Button>
        </div>
      </div>

      {/* Grouped lines */}
      {grouped.order.map(cat => {
        const subMap = grouped.cats[cat];
        const catLabel = CATEGORY_LABELS[cat] || 'Unknown';
        const catCollapsed = collapsed[cat];
        return (
          <div key={cat} className="rounded-xl border border-border overflow-hidden">
            {/* Category header */}
            <button
              type="button"
              onClick={() => toggleCollapse(cat)}
              className={cn(
                'w-full flex items-center justify-between px-4 py-3 border-b border-black/10 text-gray-900 transition-colors',
                CATEGORY_HEADER_BG[cat] || 'bg-gray-300'
              )}
            >
              <span className="text-xs font-bold uppercase tracking-wider">{catLabel}</span>
              {catCollapsed ? <ChevronRight className="w-3.5 h-3.5 opacity-40" /> : <ChevronDown className="w-3.5 h-3.5 opacity-40" />}
            </button>

            {!catCollapsed && Object.entries(subMap)
              .sort(([a], [b]) => makeSubcategorySorter(cat)(a, b))
              .map(([sub, productMap]) => {
                const subKey = `${cat}::${sub}`;
                const subCollapsed = collapsed[subKey];
                const subHex = getSubcategoryHex(sub);
                return (
                  <div key={sub}>
                    {/* Subcategory header */}
                    <button
                      type="button"
                      onClick={() => toggleCollapse(subKey)}
                      className={cn(
                        'w-full flex items-center justify-between px-4 py-1.5 border-b border-black/10 text-gray-900 transition-colors',
                        !subHex && (getSubcategoryColor(sub) || 'bg-gray-100')
                      )}
                      style={subHex ? { backgroundColor: hexToRgba(subHex, 0.18) } : undefined}
                    >
                      <span className="text-xs font-semibold">{sub}</span>
                      {subCollapsed ? <ChevronRight className="w-3 h-3 opacity-40" /> : <ChevronDown className="w-3 h-3 opacity-40" />}
                    </button>

                    {!subCollapsed && Object.entries(productMap)
                      .sort(([, aLines], [, bLines]) => compareNatural(aLines[0]?.product_sku, bLines[0]?.product_sku))
                      .map(([pname, plines]) => {
                        // For products that appear in multiple locations, show ONE row using
                        // the line at the product's default location (or highest system qty).
                        const primaryLine = (() => {
                          if (plines.length === 1) return plines[0];
                          const defLocId = productById[plines[0].product_id]?.default_location_id;
                          return (defLocId && plines.find(l => l.location_id === defLocId))
                            || plines.reduce((best, l) =>
                              (Number(l.system_qty) || 0) >= (Number(best.system_qty) || 0) ? l : best, plines[0]);
                        })();
                        return (
                          <div key={pname} className="border-b border-border last:border-b-0">
                            <SingleLineRow
                              line={primaryLine}
                              pname={pname}
                              systemQty={primaryLine.system_qty != null
                                ? Number(primaryLine.system_qty)
                                : (sohByKey[`${primaryLine.product_id}_${primaryLine.location_id}`] ?? 0)}
                              options={optionsByLine[primaryLine.id] || []}
                              uomKey={uomKey[primaryLine.id] || STOCK_KEY}
                              value={entries[primaryLine.id] ?? ''}
                              brokenValue={broken[primaryLine.id] ?? ''}
                              onUomChange={k => setUomKey(prev => ({ ...prev, [primaryLine.id]: k }))}
                              onChange={val => setEntries(prev => ({ ...prev, [primaryLine.id]: val }))}
                              onBrokenChange={val => setBroken(prev => ({ ...prev, [primaryLine.id]: val }))}
                            />
                          </div>
                        );
                      })}
                  </div>
                );
              })}
          </div>
        );
      })}

      {lines.length === 0 && (
        <p className="text-sm text-muted-foreground text-center py-8">No lines in this count. Add items below.</p>
      )}

      {/* Add item */}
      <div className="rounded-xl border border-dashed border-border p-3">
        {!showAdd ? (
          <button
            type="button"
            onClick={() => setShowAdd(true)}
            className="w-full flex items-center justify-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors py-1"
          >
            <Plus className="w-4 h-4" /> Add item not on the list
          </button>
        ) : (
          <div className="space-y-2">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
              <Input
                autoFocus
                placeholder="Search product name or SKU…"
                value={addSearch}
                onChange={e => setAddSearch(e.target.value)}
                className="pl-8 h-8 text-sm"
              />
            </div>
            {addResults.length > 0 && (
              <div className="border border-border rounded-lg overflow-hidden divide-y divide-border">
                {addResults.map(p => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => handleAddProduct(p)}
                    disabled={addingLine}
                    className="w-full flex items-center justify-between px-3 py-2 hover:bg-muted/50 transition-colors text-sm text-left"
                  >
                    <span className="font-medium truncate">{p.name}</span>
                    <span className="text-xs text-muted-foreground font-mono ml-2 shrink-0">{p.sku}</span>
                  </button>
                ))}
              </div>
            )}
            {addSearch.trim() && addResults.length === 0 && (
              <p className="text-xs text-muted-foreground text-center py-2">No products found</p>
            )}
            <button
              type="button"
              onClick={() => { setShowAdd(false); setAddSearch(''); }}
              className="text-xs text-muted-foreground hover:text-foreground underline"
            >
              Cancel
            </button>
          </div>
        )}
      </div>

      {/* Repeat action bar at bottom when list is long */}
      {lines.length > 10 && (
        <div className="flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={handleSaveDraft} disabled={saving || submitting} className="gap-1.5">
            <Save className="w-3.5 h-3.5" /> {saving ? 'Saving…' : 'Save Draft'}
          </Button>
          <Button size="sm" onClick={handleSubmit} disabled={saving || submitting} className="gap-1.5 bg-green-600 hover:bg-green-700">
            <CheckCircle2 className="w-3.5 h-3.5" /> {submitting ? 'Submitting…' : 'Submit for Review'}
          </Button>
        </div>
      )}
    </div>
  );
}

// Small inline indicator for the debounced auto-save state.
function AutoSaveStatus({ status }) {
  if (status === 'idle') return null;
  const map = {
    unsaved: { icon: <Save className="w-3.5 h-3.5" />, text: 'Unsaved changes…', cls: 'text-muted-foreground' },
    saving: { icon: <Loader2 className="w-3.5 h-3.5 animate-spin" />, text: 'Saving…', cls: 'text-muted-foreground' },
    saved: { icon: <Check className="w-3.5 h-3.5" />, text: 'All changes saved', cls: 'text-green-600' },
    error: { icon: <AlertCircle className="w-3.5 h-3.5" />, text: 'Auto-save failed — keep this tab open', cls: 'text-red-600' },
  };
  const s = map[status];
  if (!s) return null;
  return (
    <span className={cn('inline-flex items-center gap-1.5 text-xs font-medium', s.cls)}>
      {s.icon}{s.text}
    </span>
  );
}

function SingleLineRow({ line, pname, systemQty, options, uomKey, value, brokenValue, onUomChange, onChange, onBrokenChange }) {
  const stockUom = line.stock_uom || 'pcs';
  const sel = options.find(o => o.key === uomKey) || options[0] || { count_uom: stockUom, conversion_factor: 1 };
  const inBaseUnit = (sel.key || '__stock__') === '__stock__';
  const cf = Number(sel.conversion_factor) || 1;

  // Total stock-on-hand this line represents = qty in selected UOM × factor + loose remainder.
  const hasQty = value !== '' && value != null;
  const hasBroken = brokenValue !== '' && brokenValue != null;
  const showTotal = !inBaseUnit || hasBroken;
  const total = convertedFromLine(hasQty ? value : 0, cf, hasBroken ? brokenValue : 0);

  return (
    <div className="flex items-center gap-2 px-4 py-2 hover:bg-muted/20 flex-wrap">
      <span className="text-sm font-medium flex-1 min-w-[8rem] truncate">{pname}</span>
      <span className="text-xs font-mono text-muted-foreground hidden lg:block w-24 shrink-0 truncate">{line.product_sku}</span>
      <span className="text-xs text-muted-foreground tabular-nums w-24 text-right shrink-0" title="System on-hand quantity">
        {fmtQty(systemQty ?? 0)} system
      </span>

      {/* Count UOM picker (base unit + Stock Count Units + Purchasing Units) */}
      {options.length > 1 ? (
        <Select value={uomKey} onValueChange={onUomChange}>
          <SelectTrigger className="h-7 text-xs w-auto min-w-[5rem] max-w-[12rem] gap-1 px-2 shrink-0 truncate"><SelectValue /></SelectTrigger>
          <SelectContent>
            {options.map(o => (
              <SelectItem key={o.key} value={o.key}>
                {optionLabel(o, stockUom)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : (
        <span className="text-xs text-muted-foreground w-16 text-right shrink-0">{stockUom}</span>
      )}

      {/* Quantity in the selected UOM */}
      <Input
        type="number" min="0" step="any"
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder="—"
        title={inBaseUnit ? `Count in ${stockUom}` : `Number of ${sel.count_uom}${sel.count_uom_label ? ` (${sel.count_uom_label})` : ''}`}
        className={cn(
          'w-20 h-7 text-right text-sm tabular-nums shrink-0',
          hasQty ? 'border-primary/60 bg-primary/5' : ''
        )}
      />

      {/* Loose / broken remainder, entered directly in the main stock unit */}
      {!inBaseUnit && (
        <div className="flex items-center gap-1 shrink-0">
          <span className="text-xs text-muted-foreground">+</span>
          <Input
            type="number" min="0" step="any"
            value={brokenValue}
            onChange={e => onBrokenChange(e.target.value)}
            placeholder="0"
            title={`Loose / open stock in ${stockUom} (e.g. an open packet or bucket)`}
            className={cn(
              'w-16 h-7 text-right text-sm tabular-nums',
              hasBroken ? 'border-amber-400/70 bg-amber-50' : ''
            )}
          />
          <span className="text-[11px] text-muted-foreground">{stockUom}</span>
        </div>
      )}

      {/* Resulting on-hand total in the main stock unit */}
      <span className={cn(
        'text-xs tabular-nums w-24 text-right shrink-0',
        showTotal ? 'font-semibold text-foreground' : 'text-muted-foreground/0'
      )}>
        {showTotal ? `= ${fmtQty(total)} ${stockUom}` : ''}
      </span>
    </div>
  );
}
