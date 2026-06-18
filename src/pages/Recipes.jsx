import React, { useState, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Search, X, ChevronRight, Plus, Trash2, ArrowUp, ArrowDown, ChevronsUpDown, Loader2 } from 'lucide-react';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { toast } from 'sonner';
import CreateBomModal from '@/components/recipes/CreateBomModal';
import TablePagination from '@/components/shared/TablePagination';
import { parseSubcategories } from '@/lib/bomSubcategories';
import { useAuth } from '@/lib/AuthContext';
import { getUserPermissions } from '@/lib/permissions';
import { useCustomRoles } from '@/components/settings/CustomRolesManager';

export default function Recipes() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { user } = useAuth();
  const customRoles = useCustomRoles();
  const perms = getUserPermissions(user || {}, customRoles);
  const canEdit = !!perms.recipes_edit;
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(15);
  const [showCreate, setShowCreate] = useState(false);
  const [createDefaults, setCreateDefaults] = useState(null);
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [subcategoryFilter, setSubcategoryFilter] = useState('all');
  const [activeFilter, setActiveFilter] = useState('all');
  const [sortConfig, setSortConfig] = useState({ field: null, dir: 'asc' });
  const [selected, setSelected] = useState([]);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Support URL params: ?search=X or ?create=cook&productId=ID
  const urlParams = new URLSearchParams(window.location.search);
  const [search, setSearch] = useState(urlParams.get('search') || '');

  // Auto-open Create BOM modal if deep-linked from Product page
  React.useEffect(() => {
    const createType = urlParams.get('create');
    const productId = urlParams.get('productId');
    if (createType && productId) {
      setCreateDefaults({ bomType: createType, productId });
      setShowCreate(true);
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, []);

  const { data: boms = [], isLoading } = useQuery({
    queryKey: ['recipes-boms'],
    queryFn: () => base44.entities.Bom.list('-created_date', 500),
  });

  // Products + categories — to derive each output's category.
  const { data: products = [] } = useQuery({
    queryKey: ['recipes-products'],
    queryFn: () => base44.entities.Product.list('-created_date', 5000),
  });
  const { data: productCategories = [] } = useQuery({
    queryKey: ['product-categories'],
    queryFn: () => base44.entities.ProductCategory.list('sort_order', 500),
  });

  const productById = useMemo(
    () => Object.fromEntries(products.map(p => [p.id, p])), [products]);
  const catNameById = useMemo(
    () => Object.fromEntries(productCategories.map(c => [c.id, c.name])), [productCategories]);

  // Category of an output = its product's category (by id, else legacy text).
  const categoryOf = (row) => {
    const p = productById[row.product_id];
    if (!p) return '';
    return catNameById[p.category_id] || p.category || '';
  };

  // Product types that have a cook/portion recipe (as opposed to pack BOMs which live elsewhere).
  const RECIPE_TYPES = new Set(['finished_meal', 'wip_bulk', 'sauce']);

  // Collapse all BOM rows to ONE row per output product. Each output's layers
  // (Prep/Cook/Portion/Pack) live inside the consolidated detail page.
  // Also seeds from ALL products of relevant types so new products appear even
  // before their first BOM is created.
  const productRows = useMemo(() => {
    const byProduct = {};

    // Seed with every relevant product so "no recipe yet" products appear in the list.
    products.filter(p => RECIPE_TYPES.has(p.type)).forEach(p => {
      byProduct[p.id] = {
        key: p.id,
        product_id: p.id,
        product_sku: p.sku || '',
        product_name: p.name || '',
        subSet: new Set(),
        boms: [],
        hasBom: false,
      };
    });

    // Overlay existing BOM data.
    boms.forEach(b => {
      const key = b.product_id || `bom:${b.id}`;
      if (!byProduct[key]) {
        byProduct[key] = {
          key,
          product_id: b.product_id || null,
          product_sku: b.product_sku || '',
          product_name: b.product_name || '',
          subSet: new Set(),
          boms: [],
          hasBom: false,
        };
      }
      const row = byProduct[key];
      row.boms.push(b);
      row.hasBom = true;
      parseSubcategories(b.subcategory).forEach(s => row.subSet.add(s));
    });

    return Object.values(byProduct).map(r => {
      const versions = r.boms.map(b => Number(b.version || 1));
      const updated = r.boms
        .map(b => b.updated_date || b.created_date)
        .filter(Boolean)
        .sort()
        .pop() || null;
      // Representative BOM for the headline yield/output.
      const rep = r.boms.find(b => b.bom_type === 'portion')
        || r.boms.find(b => b.bom_type === 'cook')
        || r.boms[0];
      return {
        key: r.key,
        product_id: r.product_id,
        product_sku: r.product_sku,
        product_name: r.product_name,
        subcategory: [...r.subSet].sort().join(', '),
        version: versions.length ? Math.max(...versions) : null,
        is_active: r.hasBom ? r.boms.some(b => b.is_active !== false) : true,
        yield_qty: rep?.yield_qty,
        yield_uom: rep?.yield_uom,
        layer_count: r.boms.length,
        updated_date: updated,
        bomIds: r.boms.map(b => b.id),
        hasBom: r.hasBom,
      };
    });
  }, [boms, products]);

  const filtered = useMemo(() => {
    return productRows.filter(row => {
      if (categoryFilter !== 'all' && (categoryOf(row) || 'Uncategorised') !== categoryFilter) return false;
      if (subcategoryFilter !== 'all') {
        const subs = row.subcategory ? row.subcategory.split(', ') : [];
        const effectiveSubs = subs.length > 0 ? subs : ['Uncategorised'];
        if (!effectiveSubs.includes(subcategoryFilter)) return false;
      }
      if (activeFilter !== 'all') {
        if (activeFilter === 'active' && !row.is_active) return false;
        if (activeFilter === 'inactive' && row.is_active) return false;
      }
      if (search) {
        const s = search.toLowerCase();
        return (row.product_sku || '').toLowerCase().includes(s) ||
               (row.product_name || '').toLowerCase().includes(s);
      }
      return true;
    });
  }, [productRows, search, categoryFilter, subcategoryFilter, activeFilter, productById, catNameById]);

  // Sort. Default grouping is category → subcategory → name.
  const sorted = useMemo(() => {
    const dir = sortConfig.dir === 'asc' ? 1 : -1;
    const val = (row) => {
      switch (sortConfig.field) {
        case 'category': return categoryOf(row) || '';
        case 'subcategory': return row.subcategory || '';
        case 'product_sku': return row.product_sku || '';
        case 'product_name': return row.product_name || '';
        case 'version': return Number(row.version || 0);
        case 'is_active': return row.is_active ? 1 : 0;
        case 'updated_date': return row.updated_date || '';
        default: return null;
      }
    };
    const arr = [...filtered];
    if (!sortConfig.field) {
      // Default: category, then subcategory, then name
      return arr.sort((a, b) =>
        (categoryOf(a) || 'zzz').localeCompare(categoryOf(b) || 'zzz')
        || (a.subcategory || 'zzz').localeCompare(b.subcategory || 'zzz')
        || (a.product_name || '').localeCompare(b.product_name || ''));
    }
    return arr.sort((a, b) => {
      const av = val(a), bv = val(b);
      let cmp = typeof av === 'number' ? av - bv : String(av).localeCompare(String(bv));
      if (cmp === 0 && sortConfig.field === 'category') {
        cmp = (a.subcategory || '').localeCompare(b.subcategory || '');
      }
      return cmp * dir;
    });
  }, [filtered, sortConfig, productById, catNameById]);

  const pageRows = sorted.slice(page * pageSize, (page + 1) * pageSize);

  // Distinct category / subcategory options.
  const categoryOptions = useMemo(() => {
    const set = new Set();
    productRows.forEach(row => set.add(categoryOf(row) || 'Uncategorised'));
    return [...set].sort();
  }, [productRows, productById, catNameById]);

  const subcategoryOptions = useMemo(() => {
    const set = new Set();
    productRows.forEach(row => {
      const subs = row.subcategory ? row.subcategory.split(', ') : [];
      if (subs.length === 0) set.add('Uncategorised');
      else subs.forEach(s => set.add(s));
    });
    return [...set].sort();
  }, [productRows]);

  const toggleSort = (field) => {
    setSortConfig(prev => prev.field === field
      ? { field, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
      : { field, dir: 'asc' });
    setPage(0);
  };

  const clearAll = () => {
    setSearch(''); setCategoryFilter('all');
    setSubcategoryFilter('all'); setActiveFilter('all'); setPage(0);
  };

  // Multi-select (by product row key)
  const pageKeys = pageRows.map(r => r.key);
  const allPageSelected = pageKeys.length > 0 && pageKeys.every(k => selected.includes(k));
  const toggleRow = (key) =>
    setSelected(p => p.includes(key) ? p.filter(x => x !== key) : [...p, key]);
  const togglePage = () =>
    setSelected(p => allPageSelected ? p.filter(k => !pageKeys.includes(k)) : [...new Set([...p, ...pageKeys])]);

  const handleBulkDelete = async () => {
    setDeleting(true);
    const rowsByKey = Object.fromEntries(productRows.map(r => [r.key, r]));
    let okBoms = 0, failBoms = 0;
    for (const key of selected) {
      const row = rowsByKey[key];
      if (!row) continue;
      for (const bomId of row.bomIds) {
        try {
          const [comps, ops] = await Promise.all([
            base44.entities.BomComponent.filter({ bom_id: bomId }),
            base44.entities.BomOperation.filter({ bom_id: bomId }),
          ]);
          for (const c of comps) await base44.entities.BomComponent.delete(c.id);
          for (const o of ops) await base44.entities.BomOperation.delete(o.id);
          await base44.entities.Bom.delete(bomId);
          okBoms++;
        } catch { failBoms++; }
      }
    }
    setDeleting(false);
    setConfirmDelete(false);
    setSelected([]);
    queryClient.invalidateQueries({ queryKey: ['recipes-boms'] });
    if (failBoms) toast.error(`Deleted ${okBoms} BOM layer(s); ${failBoms} could not be deleted (still referenced, e.g. by a cooking run).`);
    else toast.success(`Deleted ${okBoms} BOM layer(s).`);
  };

  const SortHeader = ({ field, children, align = 'left' }) => (
    <th
      className={`px-4 py-3 text-xs font-semibold text-muted-foreground uppercase cursor-pointer select-none hover:text-foreground ${align === 'center' ? 'text-center' : 'text-left'}`}
      onClick={() => toggleSort(field)}
    >
      <span className={`inline-flex items-center gap-1 ${align === 'center' ? 'justify-center' : ''}`}>
        {children}
        {sortConfig.field === field
          ? (sortConfig.dir === 'asc' ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />)
          : <ChevronsUpDown className="w-3 h-3 opacity-30" />}
      </span>
    </th>
  );

  const colSpan = canEdit ? 9 : 8;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Bill of Materials</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {filtered.length} of {productRows.length} product outputs — open one to manage its full Prep → Cook → Portion process
          </p>
        </div>
        {canEdit && (
          <Button className="gap-2" onClick={() => setShowCreate(true)}>
            <Plus className="w-4 h-4" /> Create BOM
          </Button>
        )}
      </div>

      {/* Search + filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search by SKU or name..."
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(0); }}
            className="pl-9"
          />
        </div>
        <Select value={categoryFilter} onValueChange={v => { setCategoryFilter(v); setPage(0); }}>
          <SelectTrigger className="w-44"><SelectValue placeholder="Category" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Categories</SelectItem>
            {categoryOptions.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={subcategoryFilter} onValueChange={v => { setSubcategoryFilter(v); setPage(0); }}>
          <SelectTrigger className="w-44"><SelectValue placeholder="Subcategory" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Subcategories</SelectItem>
            {subcategoryOptions.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={activeFilter} onValueChange={v => { setActiveFilter(v); setPage(0); }}>
          <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="inactive">Inactive</SelectItem>
          </SelectContent>
        </Select>
        {(search || categoryFilter !== 'all' || subcategoryFilter !== 'all' || activeFilter !== 'all') && (
          <Button variant="ghost" size="sm" onClick={clearAll} className="gap-1">
            <X className="w-3.5 h-3.5" /> Clear
          </Button>
        )}
      </div>

      {/* Bulk action bar */}
      {canEdit && selected.length > 0 && (
        <div className="flex items-center justify-between bg-primary/5 border border-primary/20 rounded-lg px-4 py-2">
          <span className="text-sm font-medium">{selected.length} selected</span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setSelected([])}>Clear selection</Button>
            <Button variant="destructive" size="sm" className="gap-1.5" onClick={() => setConfirmDelete(true)}>
              <Trash2 className="w-3.5 h-3.5" /> Delete
            </Button>
          </div>
        </div>
      )}

      {/* Table */}
      {isLoading ? (
        <div className="text-center py-12 text-sm text-muted-foreground">Loading recipes...</div>
      ) : (
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="bg-muted/50 border-b border-border">
                {canEdit && (
                  <th className="px-3 py-3 w-10">
                    <input type="checkbox" className="rounded w-4 h-4" checked={allPageSelected} onChange={togglePage} />
                  </th>
                )}
                <SortHeader field="product_sku">Output SKU</SortHeader>
                <SortHeader field="product_name">Output Product</SortHeader>
                <SortHeader field="category">Category</SortHeader>
                <SortHeader field="subcategory">Subcategory</SortHeader>
                <th className="text-center px-4 py-3 text-xs font-semibold text-muted-foreground uppercase">Output</th>
                <SortHeader field="version" align="center">Version</SortHeader>
                <SortHeader field="is_active" align="center">Active</SortHeader>
                <SortHeader field="updated_date" align="center">Last Updated</SortHeader>
                <th className="w-10"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {pageRows.map(row => {
                const isSelected = selected.includes(row.key);
                const target = row.product_id
                  ? `/recipes/product/${row.product_id}`
                  : `/recipes/${row.bomIds[0]}`;
                return (
                  <tr
                    key={row.key}
                    className={`hover:bg-muted/30 transition-colors cursor-pointer ${isSelected ? 'bg-primary/5' : ''} ${!row.hasBom ? 'opacity-60' : ''}`}
                    onClick={() => navigate(target)}
                  >
                    {canEdit && (
                      <td className="px-3 py-2.5" onClick={e => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          className="rounded w-4 h-4"
                          checked={isSelected}
                          onChange={() => toggleRow(row.key)}
                        />
                      </td>
                    )}
                    <td className="px-4 py-2.5 text-sm font-mono font-medium">{row.product_sku || <span className="text-muted-foreground italic text-xs">no SKU</span>}</td>
                    <td className="px-4 py-2.5 text-sm">
                      <span>{row.product_name}</span>
                      {row.layer_count > 1 && (
                        <span className="ml-2 text-[10px] text-muted-foreground">({row.layer_count} layers)</span>
                      )}
                      {!row.hasBom && (
                        <span className="ml-2 text-[10px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded">No recipe</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-muted-foreground">{categoryOf(row) || '—'}</td>
                    <td className="px-4 py-2.5 text-xs text-muted-foreground">{row.subcategory || '—'}</td>
                    <td className="px-4 py-2.5 text-sm text-center tabular-nums">
                      {row.yield_qty != null ? `${row.yield_qty} ${row.yield_uom || ''}`.trim() : '—'}
                    </td>
                    <td className="px-4 py-2.5 text-sm text-center">{row.version != null ? `v${row.version}` : '—'}</td>
                    <td className="px-4 py-2.5 text-center">
                      <span className={`inline-block w-2 h-2 rounded-full ${row.hasBom && row.is_active ? 'bg-green-500' : 'bg-gray-300'}`} />
                    </td>
                    <td className="px-4 py-2.5 text-xs text-center text-muted-foreground tabular-nums">
                      {row.updated_date ? new Date(row.updated_date).toLocaleDateString() : '—'}
                    </td>
                    <td className="px-4 py-2.5">
                      <ChevronRight className="w-4 h-4 text-muted-foreground" />
                    </td>
                  </tr>
                );
              })}
              {pageRows.length === 0 && (
                <tr>
                  <td colSpan={colSpan} className="px-4 py-8 text-center text-sm text-muted-foreground">
                    {productRows.length === 0 ? 'No recipes imported yet. Go to Settings → Cin7 Import.' : 'No recipes match your filters.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>

          <TablePagination
            page={page}
            pageSize={pageSize}
            totalItems={filtered.length}
            onPageChange={setPage}
            onPageSizeChange={v => { setPageSize(v); setPage(0); }}
          />
        </div>
      )}

      {showCreate && (
        <CreateBomModal
          defaults={createDefaults}
          onCreated={() => {
            setShowCreate(false);
            setCreateDefaults(null);
            queryClient.invalidateQueries({ queryKey: ['recipes-boms'] });
          }}
          onCancel={() => { setShowCreate(false); setCreateDefaults(null); }}
        />
      )}

      {/* Bulk delete confirmation */}
      <AlertDialog open={confirmDelete} onOpenChange={open => !open && setConfirmDelete(false)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {selected.length} product output{selected.length !== 1 ? 's' : ''}?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently deletes every BOM layer (and its steps & ingredients) for the selected output{selected.length !== 1 ? 's' : ''}. BOMs still in use (e.g. referenced by a cooking run) will be skipped. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); handleBulkDelete(); }}
              disabled={deleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90 gap-1.5"
            >
              {deleting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
              {deleting ? 'Deleting…' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
