import React, { useState, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
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

const LAYER_LABELS = { cook: 'Cook', portion: 'Portion', pack: 'Pack', prep: 'Prep' };
const LAYER_COLORS = {
  cook: 'bg-orange-100 text-orange-700',
  portion: 'bg-green-100 text-green-700',
  pack: 'bg-blue-100 text-blue-700',
  prep: 'bg-purple-100 text-purple-700',
};

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

  // Support URL params: ?search=X&layer=cook or ?create=cook&productId=ID
  const urlParams = new URLSearchParams(window.location.search);
  const [search, setSearch] = useState(urlParams.get('search') || '');
  const [layerFilter, setLayerFilter] = useState(urlParams.get('layer') || 'all');

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

  // Products + categories — to derive each BOM's product category.
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

  // Category of a BOM = its product's category (by id, else legacy text).
  const categoryOf = (b) => {
    const p = productById[b.product_id];
    if (!p) return '';
    return catNameById[p.category_id] || p.category || '';
  };
  const subcategoryOf = (b) => parseSubcategories(b.subcategory).join(', ');

  const filtered = useMemo(() => {
    return boms.filter(b => {
      if (layerFilter !== 'all' && b.bom_type !== layerFilter) return false;
      if (categoryFilter !== 'all' && (categoryOf(b) || 'Uncategorised') !== categoryFilter) return false;
      if (subcategoryFilter !== 'all') {
        const subs = parseSubcategories(b.subcategory);
        const effectiveSubs = subs.length > 0 ? subs : ['Uncategorised'];
        if (!effectiveSubs.includes(subcategoryFilter)) return false;
      }
      if (activeFilter !== 'all') {
        const isActive = b.is_active !== false;
        if (activeFilter === 'active' && !isActive) return false;
        if (activeFilter === 'inactive' && isActive) return false;
      }
      if (search) {
        const s = search.toLowerCase();
        return (b.product_sku || '').toLowerCase().includes(s) ||
               (b.product_name || '').toLowerCase().includes(s);
      }
      return true;
    });
  }, [boms, search, layerFilter, categoryFilter, subcategoryFilter, activeFilter, productById, catNameById]);

  // Sort the filtered rows. Category sorts by category, then subcategory.
  const sorted = useMemo(() => {
    if (!sortConfig.field) return filtered;
    const dir = sortConfig.dir === 'asc' ? 1 : -1;
    const val = (b) => {
      switch (sortConfig.field) {
        case 'category': return categoryOf(b) || '';
        case 'subcategory': return subcategoryOf(b) || '';
        case 'product_sku': return b.product_sku || '';
        case 'product_name': return b.product_name || '';
        case 'bom_type': return b.bom_type || '';
        case 'version': return Number(b.version || 0);
        case 'is_active': return b.is_active !== false ? 1 : 0;
        default: return '';
      }
    };
    return [...filtered].sort((a, b) => {
      const av = val(a), bv = val(b);
      let cmp = typeof av === 'number' ? av - bv : String(av).localeCompare(String(bv));
      if (cmp === 0 && sortConfig.field === 'category') {
        cmp = subcategoryOf(a).localeCompare(subcategoryOf(b));
      }
      return cmp * dir;
    });
  }, [filtered, sortConfig, productById, catNameById]);

  const pageBoms = sorted.slice(page * pageSize, (page + 1) * pageSize);

  const layerCounts = useMemo(() => {
    const counts = {};
    boms.forEach(b => { counts[b.bom_type] = (counts[b.bom_type] || 0) + 1; });
    return counts;
  }, [boms]);

  // Distinct category / subcategory options (scoped to the current layer for relevance).
  const categoryOptions = useMemo(() => {
    const base = layerFilter === 'all' ? boms : boms.filter(b => b.bom_type === layerFilter);
    const set = new Set();
    base.forEach(b => set.add(categoryOf(b) || 'Uncategorised'));
    return [...set].sort();
  }, [boms, layerFilter, productById, catNameById]);

  const subcategoryOptions = useMemo(() => {
    const base = layerFilter === 'all' ? boms : boms.filter(b => b.bom_type === layerFilter);
    const set = new Set();
    base.forEach(b => {
      const subs = parseSubcategories(b.subcategory);
      if (subs.length === 0) set.add('Uncategorised');
      else subs.forEach(s => set.add(s));
    });
    return [...set].sort();
  }, [boms, layerFilter]);

  const toggleSort = (field) => {
    setSortConfig(prev => prev.field === field
      ? { field, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
      : { field, dir: 'asc' });
    setPage(0);
  };

  const clearAll = () => {
    setSearch(''); setLayerFilter('all'); setCategoryFilter('all');
    setSubcategoryFilter('all'); setActiveFilter('all'); setPage(0);
  };

  // Multi-select
  const pageIds = pageBoms.map(b => b.id);
  const allPageSelected = pageIds.length > 0 && pageIds.every(id => selected.includes(id));
  const toggleRow = (id) =>
    setSelected(p => p.includes(id) ? p.filter(x => x !== id) : [...p, id]);
  const togglePage = () =>
    setSelected(p => allPageSelected ? p.filter(id => !pageIds.includes(id)) : [...new Set([...p, ...pageIds])]);

  const handleBulkDelete = async () => {
    setDeleting(true);
    let ok = 0, fail = 0;
    for (const id of selected) {
      try { await base44.entities.Bom.delete(id); ok++; }
      catch { fail++; }
    }
    setDeleting(false);
    setConfirmDelete(false);
    setSelected([]);
    queryClient.invalidateQueries({ queryKey: ['recipes-boms'] });
    if (fail) toast.error(`Deleted ${ok}; ${fail} could not be deleted (still referenced, e.g. by a cooking run).`);
    else toast.success(`Deleted ${ok} BOM${ok !== 1 ? 's' : ''}.`);
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

  const colSpan = canEdit ? 10 : 9;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Bill of Materials</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {filtered.length} of {boms.length} BOMs — 4-layer model: Prep → Cook → Portion → Pack
          </p>
        </div>
        {canEdit && (
          <Button className="gap-2" onClick={() => setShowCreate(true)}>
            <Plus className="w-4 h-4" /> Create BOM
          </Button>
        )}
      </div>

      {/* Layer chips */}
      <div className="flex flex-wrap gap-2">
        {['prep', 'cook', 'portion', 'pack'].map(layer => (
          <button
            key={layer}
            onClick={() => { setLayerFilter(layerFilter === layer ? 'all' : layer); setCategoryFilter('all'); setSubcategoryFilter('all'); setPage(0); }}
            className={`text-xs px-3 py-1.5 rounded-full font-medium transition-all ${
              layerFilter === layer
                ? LAYER_COLORS[layer] + ' ring-2 ring-primary/30'
                : LAYER_COLORS[layer] + ' opacity-70 hover:opacity-100'
            }`}
          >
            {LAYER_LABELS[layer]} ({layerCounts[layer] || 0})
          </button>
        ))}
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
        {(search || layerFilter !== 'all' || categoryFilter !== 'all' || subcategoryFilter !== 'all' || activeFilter !== 'all') && (
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
                <SortHeader field="bom_type" align="center">Layer</SortHeader>
                <SortHeader field="subcategory">Subcategory</SortHeader>
                <th className="text-center px-4 py-3 text-xs font-semibold text-muted-foreground uppercase">Yield</th>
                <SortHeader field="version" align="center">Version</SortHeader>
                <SortHeader field="is_active" align="center">Active</SortHeader>
                <th className="w-10"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {pageBoms.map(b => {
                const isSelected = selected.includes(b.id);
                return (
                  <tr
                    key={b.id}
                    className={`hover:bg-muted/30 transition-colors cursor-pointer ${isSelected ? 'bg-primary/5' : ''}`}
                    onClick={() => navigate(`/recipes/${b.id}`)}
                  >
                    {canEdit && (
                      <td className="px-3 py-2.5" onClick={e => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          className="rounded w-4 h-4"
                          checked={isSelected}
                          onChange={() => toggleRow(b.id)}
                        />
                      </td>
                    )}
                    <td className="px-4 py-2.5 text-sm font-mono font-medium">{b.product_sku}</td>
                    <td className="px-4 py-2.5 text-sm">{b.product_name}</td>
                    <td className="px-4 py-2.5 text-xs text-muted-foreground">{categoryOf(b) || '—'}</td>
                    <td className="px-4 py-2.5 text-center">
                      <Badge className={`text-[10px] ${LAYER_COLORS[b.bom_type]}`}>
                        {LAYER_LABELS[b.bom_type]}
                      </Badge>
                    </td>
                    <td className="px-4 py-2.5 text-xs text-muted-foreground">
                      {subcategoryOf(b) || '—'}
                    </td>
                    <td className="px-4 py-2.5 text-sm text-center tabular-nums">
                      {b.yield_qty} {b.yield_uom}
                    </td>
                    <td className="px-4 py-2.5 text-sm text-center">v{b.version || 1}</td>
                    <td className="px-4 py-2.5 text-center">
                      <span className={`inline-block w-2 h-2 rounded-full ${b.is_active !== false ? 'bg-green-500' : 'bg-gray-300'}`} />
                    </td>
                    <td className="px-4 py-2.5">
                      <ChevronRight className="w-4 h-4 text-muted-foreground" />
                    </td>
                  </tr>
                );
              })}
              {pageBoms.length === 0 && (
                <tr>
                  <td colSpan={colSpan} className="px-4 py-8 text-center text-sm text-muted-foreground">
                    {boms.length === 0 ? 'No recipes imported yet. Go to Settings → Cin7 Import.' : 'No recipes match your filters.'}
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
            <AlertDialogTitle>Delete {selected.length} BOM{selected.length !== 1 ? 's' : ''}?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently deletes the selected BOM{selected.length !== 1 ? 's' : ''} and their components. BOMs still in use (e.g. referenced by a cooking run) will be skipped. This cannot be undone.
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
