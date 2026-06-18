import React, { useState, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Save, CheckCircle2, Search, Plus, ChevronDown, ChevronRight } from 'lucide-react';
import { toast } from 'sonner';
import { saveFloorCounts, completeFloorCount, addCountLine } from '@/lib/stockCount';
import { CATEGORY_LABELS, CATEGORY_ORDER, resolveSubcategory } from '@/lib/productClassification';
import { cn } from '@/lib/utils';

const fmtQty = (n) => {
  const v = Number(n);
  if (isNaN(v)) return '—';
  return Number.isInteger(v) ? String(v) : v.toFixed(3).replace(/\.?0+$/, '');
};

export default function WebCountEntrySheet({ countId, header, lines, products, onSaved, onSubmitted }) {
  const productById = useMemo(() => Object.fromEntries(products.map(p => [p.id, p])), [products]);

  const [entries, setEntries] = useState(() => {
    const init = {};
    lines.forEach(l => { if (l.counted_qty != null) init[l.id] = String(l.counted_qty); });
    return init;
  });
  const [saving, setSaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Collapsed state per category key (all open by default)
  const [collapsed, setCollapsed] = useState({});
  const toggleCollapse = (key) => setCollapsed(prev => ({ ...prev, [key]: !prev[key] }));

  // Add-item state
  const [addSearch, setAddSearch] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [addingLine, setAddingLine] = useState(false);

  // ── Group lines: category → subcategory → product name ──────────────────────
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

  // ── Counts ───────────────────────────────────────────────────────────────────
  const enteredCount = useMemo(
    () => Object.values(entries).filter(v => v !== '' && v != null).length,
    [entries]
  );

  const handleChange = (lineId, val) => setEntries(prev => ({ ...prev, [lineId]: val }));

  // ── Save draft ────────────────────────────────────────────────────────────────
  const handleSaveDraft = async () => {
    setSaving(true);
    try {
      const payload = lines.map(l => ({ id: l.id, counted_qty: entries[l.id] ?? null }));
      await saveFloorCounts(countId, payload, 'web');
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
    setSubmitting(true);
    try {
      const payload = lines.map(l => ({ id: l.id, counted_qty: entries[l.id] ?? null }));
      await saveFloorCounts(countId, payload, 'web');
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
        <p className="text-sm text-muted-foreground">
          <span className="font-semibold text-foreground">{enteredCount}</span> of{' '}
          <span className="font-semibold text-foreground">{lines.length}</span> lines entered
        </p>
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
              className="w-full flex items-center justify-between px-4 py-2.5 bg-muted/70 border-b border-border hover:bg-muted transition-colors"
            >
              <span className="text-xs font-bold uppercase tracking-wider text-foreground">{catLabel}</span>
              {catCollapsed ? <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" /> : <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />}
            </button>

            {!catCollapsed && Object.entries(subMap)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([sub, productMap]) => {
                const subKey = `${cat}::${sub}`;
                const subCollapsed = collapsed[subKey];
                return (
                  <div key={sub}>
                    {/* Subcategory header */}
                    <button
                      type="button"
                      onClick={() => toggleCollapse(subKey)}
                      className="w-full flex items-center justify-between px-4 py-1.5 bg-muted/30 border-b border-border hover:bg-muted/50 transition-colors"
                    >
                      <span className="text-xs font-semibold text-muted-foreground">{sub}</span>
                      {subCollapsed ? <ChevronRight className="w-3 h-3 text-muted-foreground" /> : <ChevronDown className="w-3 h-3 text-muted-foreground" />}
                    </button>

                    {!subCollapsed && Object.entries(productMap)
                      .sort(([a], [b]) => a.localeCompare(b))
                      .map(([pname, plines]) => {
                        const multiLoc = plines.length > 1;
                        return (
                          <div key={pname} className="border-b border-border last:border-b-0">
                            {multiLoc ? (
                              // Product-name row + location sub-rows
                              <>
                                <div className="px-4 py-1.5 bg-muted/10 flex items-center gap-2">
                                  <span className="text-sm font-medium text-foreground">{pname}</span>
                                  <span className="text-[10px] text-muted-foreground bg-muted rounded px-1.5 py-0.5">{plines.length} locations</span>
                                  <span className="text-xs font-mono text-muted-foreground ml-1">{plines[0].product_sku}</span>
                                </div>
                                {plines.map(line => (
                                  <div key={line.id} className="flex items-center gap-3 px-6 py-2 border-t border-border/50 hover:bg-muted/20">
                                    <span className="text-xs text-muted-foreground flex-1 truncate">{line.location_name || '—'}</span>
                                    <span className="text-xs text-muted-foreground tabular-nums w-16 text-right">{fmtQty(line.system_qty ?? null)} sys</span>
                                    <Input
                                      type="number" min="0" step="any"
                                      value={entries[line.id] ?? ''}
                                      onChange={e => handleChange(line.id, e.target.value)}
                                      placeholder="—"
                                      className={cn('w-24 h-7 text-right text-sm tabular-nums', entries[line.id] !== undefined && entries[line.id] !== '' ? 'border-primary/60 bg-primary/5' : '')}
                                    />
                                    <span className="text-xs text-muted-foreground w-8">{line.stock_uom || 'pcs'}</span>
                                  </div>
                                ))}
                              </>
                            ) : (
                              // Single-location — one flat row
                              <SingleLineRow
                                line={plines[0]}
                                pname={pname}
                                value={entries[plines[0].id] ?? ''}
                                onChange={val => handleChange(plines[0].id, val)}
                              />
                            )}
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

function SingleLineRow({ line, pname, value, onChange }) {
  return (
    <div className="flex items-center gap-3 px-4 py-2 hover:bg-muted/20">
      <span className="text-sm font-medium flex-1 truncate">{pname}</span>
      <span className="text-xs font-mono text-muted-foreground hidden sm:block w-28 shrink-0">{line.product_sku}</span>
      <span className="text-xs text-muted-foreground tabular-nums w-16 text-right shrink-0">{line.system_qty != null ? fmtQty(line.system_qty) : '—'} sys</span>
      <Input
        type="number" min="0" step="any"
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder="—"
        className={cn(
          'w-24 h-7 text-right text-sm tabular-nums shrink-0',
          value !== '' ? 'border-primary/60 bg-primary/5' : ''
        )}
      />
      <span className="text-xs text-muted-foreground w-8 shrink-0">{line.stock_uom || 'pcs'}</span>
    </div>
  );
}
