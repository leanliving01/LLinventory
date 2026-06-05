import React, { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Plus, Trash2, ChevronDown, ChevronRight, Loader2, FolderTree, Tag,
  Sparkles, X, AlertTriangle, GitMerge,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  CATEGORY_LABELS, CATEGORY_ORDER, SUBCATEGORIES_BY_CATEGORY,
} from '@/lib/productClassification';

const TYPE_OPTIONS = CATEGORY_ORDER.map(value => ({ value, label: CATEGORY_LABELS[value] || value }));

/**
 * Settings → Categories.
 *
 * The top-level Categories ARE the product types (CATEGORY_LABELS). They are
 * always shown grouped, each with its subcategories beneath — the canonical
 * defaults appear as greyed "suggested" rows you can one-click add. Adding a
 * subcategory writes a product_subcategories row (shared with the Products page
 * via the ['product-subcategories'] cache key). Removing a subcategory that is
 * in use forces a merge into another subcategory first; merging a whole
 * category reassigns its products' type into the target category.
 */
export default function SettingsCategoriesTab() {
  const queryClient = useQueryClient();
  const [typeFilter, setTypeFilter] = useState('all');
  const [expandedCats, setExpandedCats] = useState({});
  const [newSubNames, setNewSubNames] = useState({});
  const [addingSub, setAddingSub] = useState({});
  const [seeding, setSeeding] = useState(false);
  const [merge, setMerge] = useState(null); // { mode, source, label, count }

  const { data: categories = [], isLoading: loadingCats } = useQuery({
    queryKey: ['product-categories'],
    queryFn: () => base44.entities.ProductCategory.filter({ is_active: true }, 'sort_order', 200),
  });

  const { data: subcategories = [], isLoading: loadingSubs } = useQuery({
    queryKey: ['product-subcategories'],
    queryFn: () => base44.entities.ProductSubcategory.filter({ is_active: true }, 'sort_order', 500),
  });

  const { data: products = [] } = useQuery({
    queryKey: ['products', 'category-counts'],
    queryFn: () => base44.entities.Product.list('-created_date', 5000),
    staleTime: 60_000,
  });

  // Product counts per type and per stored subcategory (type::name lowercased).
  const { countByType, countBySub } = useMemo(() => {
    const ct = {}, cs = {};
    products.forEach(p => {
      ct[p.type] = (ct[p.type] || 0) + 1;
      const sc = (p.subcategory || '').trim();
      if (sc) {
        const k = `${p.type}::${sc.toLowerCase()}`;
        cs[k] = (cs[k] || 0) + 1;
      }
    });
    return { countByType: ct, countBySub: cs };
  }, [products]);

  // Build a section per product type, in canonical order.
  const sections = useMemo(() => {
    return CATEGORY_ORDER
      .filter(type => typeFilter === 'all' || type === typeFilter)
      .map(type => {
        const cat = categories.find(c => c.product_type === type) || null;
        const dbSubs = subcategories
          .filter(s => s.product_type === type)
          .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
        const dbNames = new Set(dbSubs.map(s => (s.name || '').toLowerCase()));
        const suggested = (SUBCATEGORIES_BY_CATEGORY[type] || [])
          .filter(n => !dbNames.has(n.toLowerCase()));
        return { type, label: CATEGORY_LABELS[type] || type, cat, dbSubs, suggested };
      });
  }, [categories, subcategories, typeFilter]);

  const toggleCat = (type) => setExpandedCats(prev => ({ ...prev, [type]: !prev[type] }));
  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['product-categories'] });
    queryClient.invalidateQueries({ queryKey: ['product-subcategories'] });
    queryClient.invalidateQueries({ queryKey: ['products'] });
  };

  // Find-or-create the canonical category row for a product type (parent for
  // subcategory rows, whose category_id is NOT NULL).
  const ensureCategory = async (type) => {
    const existing = categories.find(c => c.product_type === type);
    if (existing) return existing;
    const created = await base44.entities.ProductCategory.create({
      name: CATEGORY_LABELS[type] || type,
      product_type: type,
      sort_order: CATEGORY_ORDER.indexOf(type),
    });
    queryClient.invalidateQueries({ queryKey: ['product-categories'] });
    return created;
  };

  // One-click seed: canonical category per type + its standard subcategories.
  const handleSeedDefaults = async () => {
    setSeeding(true);
    try {
      let created = 0;
      for (const type of CATEGORY_ORDER) {
        const cat = await ensureCategory(type);
        const existing = new Set(
          subcategories.filter(s => s.category_id === cat.id).map(s => (s.name || '').toLowerCase())
        );
        const subs = SUBCATEGORIES_BY_CATEGORY[type] || [];
        for (let i = 0; i < subs.length; i++) {
          if (existing.has(subs[i].toLowerCase())) continue;
          await base44.entities.ProductSubcategory.create({
            name: subs[i],
            category_id: cat.id,
            category_name: cat.name,
            product_type: type,
            sort_order: i,
          });
          created++;
        }
      }
      invalidate();
      toast.success(created ? `Loaded ${created} default subcategories` : 'Defaults already present');
    } catch (err) {
      toast.error('Load defaults failed: ' + (err.message || 'Unknown error'));
    } finally {
      setSeeding(false);
    }
  };

  const handleAddSubcategory = async (type, presetName) => {
    const name = (presetName ?? newSubNames[type] ?? '').trim();
    if (!name) return;
    setAddingSub(prev => ({ ...prev, [type]: true }));
    try {
      const cat = await ensureCategory(type);
      const dupe = subcategories.some(s =>
        s.product_type === type && (s.name || '').toLowerCase() === name.toLowerCase());
      if (dupe) {
        toast.error(`"${name}" already exists under ${CATEGORY_LABELS[type]}`);
        return;
      }
      await base44.entities.ProductSubcategory.create({
        name,
        category_id: cat.id,
        category_name: cat.name,
        product_type: type,
        sort_order: subcategories.filter(s => s.product_type === type).length,
      });
      invalidate();
      toast.success(`Subcategory "${name}" added under "${CATEGORY_LABELS[type]}"`);
      if (presetName == null) setNewSubNames(prev => ({ ...prev, [type]: '' }));
    } catch (err) {
      toast.error('Add failed: ' + (err.message || 'Unknown error'));
    } finally {
      setAddingSub(prev => ({ ...prev, [type]: false }));
    }
  };

  const handleRemoveSubcategory = (sub) => {
    const inUse = countBySub[`${sub.product_type}::${(sub.name || '').toLowerCase()}`] || 0;
    if (inUse > 0) {
      // Force a merge: reassign products onto another subcategory first.
      setMerge({ mode: 'subcategory', source: sub, label: sub.name, count: inUse });
      return;
    }
    deleteSubcategoryRow(sub);
  };

  const deleteSubcategoryRow = async (sub) => {
    try {
      await base44.entities.ProductSubcategory.update(sub.id, { is_active: false });
      invalidate();
      toast.success(`Subcategory "${sub.name}" removed`);
    } catch (err) {
      toast.error('Remove failed: ' + (err.message || 'Unknown error'));
    }
  };

  const openCategoryMerge = (section) => {
    setMerge({
      mode: 'category',
      source: { type: section.type },
      label: section.label,
      count: countByType[section.type] || 0,
    });
  };

  if (loadingCats || loadingSubs) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-bold flex items-center gap-2">
            <FolderTree className="w-5 h-5" /> Product Categories
          </h3>
          <p className="text-sm text-muted-foreground mt-1">
            Every product category, with its subcategories. Greyed rows are
            suggested defaults — click + to add them. Products are grouped by
            these in the catalog.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={handleSeedDefaults} disabled={seeding} className="gap-1.5 shrink-0">
          {seeding ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
          Load defaults
        </Button>
      </div>

      {/* Filter by type */}
      <div className="flex items-center gap-3">
        <span className="text-sm font-medium text-muted-foreground">Filter by category:</span>
        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Categories</SelectItem>
            {TYPE_OPTIONS.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {/* Category list */}
      <div className="space-y-2">
        {sections.map(section => {
          const { type, label, dbSubs, suggested } = section;
          const isOpen = expandedCats[type];
          const subCount = dbSubs.length;
          const prodCount = countByType[type] || 0;

          return (
            <div key={type} className="border border-border rounded-xl overflow-hidden">
              {/* Category header */}
              <div className="flex items-center gap-3 px-4 py-3 bg-muted/30">
                <button onClick={() => toggleCat(type)} className="shrink-0">
                  {isOpen
                    ? <ChevronDown className="w-4 h-4 text-muted-foreground" />
                    : <ChevronRight className="w-4 h-4 text-muted-foreground" />
                  }
                </button>
                <FolderTree className="w-4 h-4 text-primary shrink-0" />
                <div className="flex-1 min-w-0">
                  <span className="text-sm font-semibold">{label}</span>
                  <span className="text-[10px] text-muted-foreground ml-2">
                    {subCount} subcategor{subCount === 1 ? 'y' : 'ies'} · {prodCount} product{prodCount === 1 ? '' : 's'}
                  </span>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 gap-1.5 text-muted-foreground hover:text-foreground"
                  onClick={() => openCategoryMerge(section)}
                  disabled={prodCount === 0}
                  title={prodCount === 0 ? 'No products to merge' : 'Move all products into another category'}
                >
                  <GitMerge className="w-3.5 h-3.5" /> Merge
                </Button>
              </div>

              {/* Subcategories */}
              {isOpen && (
                <div className="px-4 py-3 space-y-2 border-t border-border bg-card">
                  {dbSubs.map(sub => {
                    const used = countBySub[`${type}::${(sub.name || '').toLowerCase()}`] || 0;
                    return (
                      <div key={sub.id} className="flex items-center gap-3 pl-6">
                        <Tag className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                        <span className="text-sm flex-1">{sub.name}</span>
                        {used > 0 && (
                          <span className="text-[10px] text-muted-foreground">{used} product{used === 1 ? '' : 's'}</span>
                        )}
                        <Button
                          variant="ghost"
                          size="icon"
                          className="w-7 h-7 text-destructive hover:text-destructive"
                          onClick={() => handleRemoveSubcategory(sub)}
                          title={used > 0 ? 'In use — will ask where to merge' : 'Remove'}
                        >
                          <Trash2 className="w-3 h-3" />
                        </Button>
                      </div>
                    );
                  })}

                  {/* Suggested (canonical) defaults not yet added */}
                  {suggested.map(name => (
                    <div key={`sugg-${name}`} className="flex items-center gap-3 pl-6 opacity-55">
                      <Tag className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                      <span className="text-sm flex-1 italic">{name}</span>
                      <span className="text-[10px] text-muted-foreground">suggested</span>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="w-7 h-7 text-primary hover:text-primary"
                        onClick={() => handleAddSubcategory(type, name)}
                        disabled={addingSub[type]}
                        title="Add this subcategory"
                      >
                        <Plus className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  ))}

                  {dbSubs.length === 0 && suggested.length === 0 && (
                    <p className="text-xs text-muted-foreground pl-6">No subcategories yet.</p>
                  )}

                  {/* Add subcategory inline */}
                  <div className="flex items-center gap-2 pl-6 pt-1">
                    <Input
                      placeholder="New subcategory name..."
                      value={newSubNames[type] || ''}
                      onChange={e => setNewSubNames(prev => ({ ...prev, [type]: e.target.value }))}
                      onKeyDown={e => e.key === 'Enter' && handleAddSubcategory(type)}
                      className="h-8 text-sm"
                    />
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleAddSubcategory(type)}
                      disabled={addingSub[type] || !(newSubNames[type] || '').trim()}
                      className="gap-1 h-8"
                    >
                      {addingSub[type] ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />}
                      Add
                    </Button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {merge && (
        <MergeDialog
          merge={merge}
          subcategories={subcategories}
          products={products}
          onClose={() => setMerge(null)}
          onDone={() => { setMerge(null); invalidate(); }}
        />
      )}
    </div>
  );
}

/**
 * Reassign products off a subcategory (or whole category) onto a chosen target,
 * then deactivate the source rows. Mode 'subcategory' moves products to another
 * subcategory within the same category; mode 'category' moves all products into
 * another category (their type), clearing their stored subcategory.
 */
function MergeDialog({ merge, subcategories, products, onClose, onDone }) {
  const { mode, source, label, count } = merge;
  const [target, setTarget] = useState('');
  const [busy, setBusy] = useState(false);

  const targetOptions = useMemo(() => {
    if (mode === 'subcategory') {
      return subcategories
        .filter(s => s.product_type === source.product_type && s.id !== source.id)
        .map(s => ({ value: s.name, label: s.name }));
    }
    // category mode → other product types
    return CATEGORY_ORDER
      .filter(t => t !== source.type)
      .map(t => ({ value: t, label: CATEGORY_LABELS[t] || t }));
  }, [mode, source, subcategories]);

  const submit = async () => {
    if (!target) { toast.error('Choose a target first'); return; }
    setBusy(true);
    let ok = 0, fail = 0;
    try {
      if (mode === 'subcategory') {
        const srcName = (source.name || '').toLowerCase();
        const affected = products.filter(p =>
          p.type === source.product_type && (p.subcategory || '').trim().toLowerCase() === srcName);
        for (const p of affected) {
          try { await base44.entities.Product.update(p.id, { subcategory: target }); ok++; } catch { fail++; }
        }
        await base44.entities.ProductSubcategory.update(source.id, { is_active: false });
        toast[fail ? 'warning' : 'success'](`Moved ${ok} product${ok === 1 ? '' : 's'} to "${target}"${fail ? `, ${fail} failed` : ''}; "${label}" removed`);
      } else {
        const affected = products.filter(p => p.type === source.type);
        for (const p of affected) {
          // Clear subcategory so it re-detects under the new category.
          try { await base44.entities.Product.update(p.id, { type: target, subcategory: '' }); ok++; } catch { fail++; }
        }
        // Deactivate the merged category's rows.
        for (const s of subcategories.filter(s => s.product_type === source.type)) {
          try { await base44.entities.ProductSubcategory.update(s.id, { is_active: false }); } catch { /* noop */ }
        }
        const targetLabel = CATEGORY_LABELS[target] || target;
        toast[fail ? 'warning' : 'success'](`Moved ${ok} product${ok === 1 ? '' : 's'} into "${targetLabel}"${fail ? `, ${fail} failed` : ''}`);
      }
      onDone();
    } catch (err) {
      toast.error('Merge failed: ' + (err.message || 'Unknown error'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-card rounded-xl shadow-xl w-full max-w-md" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-border flex items-center justify-between">
          <h2 className="text-base font-bold flex items-center gap-2">
            <GitMerge className="w-4 h-4 text-primary" />
            {mode === 'subcategory' ? 'Move subcategory' : 'Merge category'}
          </h2>
          <Button variant="ghost" size="icon" onClick={onClose}><X className="w-5 h-5" /></Button>
        </div>

        <div className="px-5 py-4 space-y-4">
          <div className="flex items-start gap-2 text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-3">
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
            <div className="text-sm">
              <strong>{count}</strong> product{count === 1 ? '' : 's'} {count === 1 ? 'is' : 'are'} in
              {' '}<strong>{label}</strong>. Choose where to move {count === 1 ? 'it' : 'them'} before removing.
              {mode === 'category' && (
                <div className="mt-1">Changing category clears each product's subcategory so it re-detects, and may affect filters, recipes, production and Shopify sync.</div>
              )}
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">
              {mode === 'subcategory' ? 'Move products to subcategory' : 'Merge into category'}
            </label>
            <Select value={target} onValueChange={setTarget}>
              <SelectTrigger className="h-9">
                <SelectValue placeholder={mode === 'subcategory' ? 'Select subcategory' : 'Select category'} />
              </SelectTrigger>
              <SelectContent>
                {targetOptions.length === 0 && <div className="px-3 py-2 text-xs text-muted-foreground">No target available</div>}
                {targetOptions.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="px-5 py-3 border-t border-border flex justify-end gap-2">
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={submit} disabled={busy || !target} className="gap-2">
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <GitMerge className="w-4 h-4" />}
            {busy ? 'Moving…' : `Move ${count} & remove`}
          </Button>
        </div>
      </div>
    </div>
  );
}
