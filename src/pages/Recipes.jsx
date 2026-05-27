import React, { useState, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Search, X, ChevronRight, Plus, ChevronDown, FolderOpen } from 'lucide-react';
import CreateBomModal from '@/components/recipes/CreateBomModal';
import TablePagination from '@/components/shared/TablePagination';
import { getSubcategories, parseSubcategories } from '@/lib/bomSubcategories';
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
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(15);
  const [showCreate, setShowCreate] = useState(false);
  const [createDefaults, setCreateDefaults] = useState(null);
  const [subcategoryFilter, setSubcategoryFilter] = useState('all');
  const [activeFilter, setActiveFilter] = useState('all');

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
      // Clean URL
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, []);

  const { data: boms = [], isLoading } = useQuery({
    queryKey: ['recipes-boms'],
    queryFn: () => base44.entities.Bom.list('-created_date', 500),
  });

  const filtered = useMemo(() => {
    return boms.filter(b => {
      if (layerFilter !== 'all' && b.bom_type !== layerFilter) return false;
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
  }, [boms, search, layerFilter, subcategoryFilter, activeFilter]);

  // Available subcategories for the selected layer filter
  const activeSubcategories = useMemo(() => {
    if (layerFilter === 'all') return [];
    const defined = getSubcategories(layerFilter);
    // Count BOMs per subcategory within this layer
    const layerBoms = boms.filter(b => b.bom_type === layerFilter);
    const counts = {};
    layerBoms.forEach(b => {
      const subs = parseSubcategories(b.subcategory);
      if (subs.length === 0) {
        counts['Uncategorised'] = (counts['Uncategorised'] || 0) + 1;
      } else {
        subs.forEach(sub => { counts[sub] = (counts[sub] || 0) + 1; });
      }
    });
    // Include defined subcategories + any existing ones not in the list
    const allSubs = [...defined];
    Object.keys(counts).forEach(s => {
      if (!allSubs.includes(s)) allSubs.push(s);
    });
    return allSubs.map(s => ({ label: s, count: counts[s] || 0 }));
  }, [boms, layerFilter]);

  const pageBoms = filtered.slice(page * pageSize, (page + 1) * pageSize);

  const layerCounts = useMemo(() => {
    const counts = {};
    boms.forEach(b => { counts[b.bom_type] = (counts[b.bom_type] || 0) + 1; });
    return counts;
  }, [boms]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Bill of Materials</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {filtered.length} of {boms.length} BOMs — 4-layer model: Prep → Cook → Portion → Pack
          </p>
        </div>
        {perms.recipes_edit && (
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
            onClick={() => { setLayerFilter(layerFilter === layer ? 'all' : layer); setSubcategoryFilter('all'); setPage(0); }}
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

      {/* Subcategory chips — shown when a layer is selected */}
      {layerFilter !== 'all' && activeSubcategories.length > 0 && (
        <div className="flex flex-wrap gap-2 items-center">
          <FolderOpen className="w-4 h-4 text-muted-foreground" />
          <button
            onClick={() => { setSubcategoryFilter('all'); setPage(0); }}
            className={`text-xs px-3 py-1.5 rounded-full font-medium transition-all ${
              subcategoryFilter === 'all'
                ? 'bg-foreground text-background'
                : 'bg-muted text-muted-foreground hover:bg-muted/80'
            }`}
          >
            All
          </button>
          {activeSubcategories.map(sub => (
            <button
              key={sub.label}
              onClick={() => { setSubcategoryFilter(subcategoryFilter === sub.label ? 'all' : sub.label); setPage(0); }}
              className={`text-xs px-3 py-1.5 rounded-full font-medium transition-all ${
                subcategoryFilter === sub.label
                  ? 'bg-foreground text-background'
                  : 'bg-muted text-muted-foreground hover:bg-muted/80'
              }`}
            >
              {sub.label} ({sub.count})
            </button>
          ))}
        </div>
      )}

      {/* Search */}
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
        <Select value={activeFilter} onValueChange={v => { setActiveFilter(v); setPage(0); }}>
          <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="inactive">Inactive</SelectItem>
          </SelectContent>
        </Select>
        {(search || layerFilter !== 'all' || subcategoryFilter !== 'all' || activeFilter !== 'all') && (
          <Button variant="ghost" size="sm" onClick={() => { setSearch(''); setLayerFilter('all'); setSubcategoryFilter('all'); setActiveFilter('all'); setPage(0); }} className="gap-1">
            <X className="w-3.5 h-3.5" /> Clear
          </Button>
        )}
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="text-center py-12 text-sm text-muted-foreground">Loading recipes...</div>
      ) : (
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="bg-muted/50 border-b border-border">
                <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase">Output SKU</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase">Output Product</th>
                <th className="text-center px-4 py-3 text-xs font-semibold text-muted-foreground uppercase">Layer</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase">Subcategory</th>
                <th className="text-center px-4 py-3 text-xs font-semibold text-muted-foreground uppercase">Yield</th>
                <th className="text-center px-4 py-3 text-xs font-semibold text-muted-foreground uppercase">Version</th>
                <th className="text-center px-4 py-3 text-xs font-semibold text-muted-foreground uppercase">Active</th>
                <th className="w-10"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {pageBoms.map(b => (
                <tr
                  key={b.id}
                  className="hover:bg-muted/30 transition-colors cursor-pointer"
                  onClick={() => navigate(`/recipes/${b.id}`)}
                >
                  <td className="px-4 py-2.5 text-sm font-mono font-medium">{b.product_sku}</td>
                  <td className="px-4 py-2.5 text-sm">{b.product_name}</td>
                  <td className="px-4 py-2.5 text-center">
                    <Badge className={`text-[10px] ${LAYER_COLORS[b.bom_type]}`}>
                      {LAYER_LABELS[b.bom_type]}
                    </Badge>
                  </td>
                  <td className="px-4 py-2.5 text-xs text-muted-foreground">
                    {parseSubcategories(b.subcategory).join(', ') || '—'}
                  </td>
                  <td className="px-4 py-2.5 text-sm text-center tabular-nums">
                    {b.yield_qty} {b.yield_uom}
                  </td>
                  <td className="px-4 py-2.5 text-sm text-center">v{b.version || 1}</td>
                  <td className="px-4 py-2.5 text-center">
                    <span className={`inline-block w-2 h-2 rounded-full ${b.is_active ? 'bg-green-500' : 'bg-gray-300'}`} />
                  </td>
                  <td className="px-4 py-2.5">
                    <ChevronRight className="w-4 h-4 text-muted-foreground" />
                  </td>
                </tr>
              ))}
              {pageBoms.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-sm text-muted-foreground">
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
    </div>
  );
}