import React, { useState, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Search, X, ChevronRight, Plus, ChevronDown, FolderOpen } from 'lucide-react';
import RecipeDetailDrawer from '@/components/recipes/RecipeDetailDrawer';
import CreateBomModal from '@/components/recipes/CreateBomModal';
import { getSubcategories } from '@/lib/bomSubcategories';

const LAYER_LABELS = { cook: 'Cook', portion: 'Portion', pack: 'Pack', prep: 'Prep' };
const LAYER_COLORS = {
  cook: 'bg-orange-100 text-orange-700',
  portion: 'bg-green-100 text-green-700',
  pack: 'bg-blue-100 text-blue-700',
  prep: 'bg-purple-100 text-purple-700',
};

export default function Recipes() {
  const queryClient = useQueryClient();
  const [selectedBom, setSelectedBom] = useState(null);
  const [page, setPage] = useState(0);
  const [showCreate, setShowCreate] = useState(false);
  const [createDefaults, setCreateDefaults] = useState(null);
  const [subcategoryFilter, setSubcategoryFilter] = useState('all');
  const PAGE_SIZE = 15;

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
      if (subcategoryFilter !== 'all' && (b.subcategory || 'Uncategorised') !== subcategoryFilter) return false;
      if (search) {
        const s = search.toLowerCase();
        return (b.product_sku || '').toLowerCase().includes(s) ||
               (b.product_name || '').toLowerCase().includes(s);
      }
      return true;
    });
  }, [boms, search, layerFilter, subcategoryFilter]);

  // Available subcategories for the selected layer filter
  const activeSubcategories = useMemo(() => {
    if (layerFilter === 'all') return [];
    const defined = getSubcategories(layerFilter);
    // Count BOMs per subcategory within this layer
    const layerBoms = boms.filter(b => b.bom_type === layerFilter);
    const counts = {};
    layerBoms.forEach(b => {
      const sub = b.subcategory || 'Uncategorised';
      counts[sub] = (counts[sub] || 0) + 1;
    });
    // Include defined subcategories + any existing ones not in the list
    const allSubs = [...defined];
    Object.keys(counts).forEach(s => {
      if (!allSubs.includes(s)) allSubs.push(s);
    });
    return allSubs.map(s => ({ label: s, count: counts[s] || 0 }));
  }, [boms, layerFilter]);

  const pageBoms = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);

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
        <Button className="gap-2" onClick={() => setShowCreate(true)}>
          <Plus className="w-4 h-4" /> Create BOM
        </Button>
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
        {(search || layerFilter !== 'all' || subcategoryFilter !== 'all') && (
          <Button variant="ghost" size="sm" onClick={() => { setSearch(''); setLayerFilter('all'); setSubcategoryFilter('all'); setPage(0); }} className="gap-1">
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
                  onClick={() => setSelectedBom(b)}
                >
                  <td className="px-4 py-2.5 text-sm font-mono font-medium">{b.product_sku}</td>
                  <td className="px-4 py-2.5 text-sm">{b.product_name}</td>
                  <td className="px-4 py-2.5 text-center">
                    <Badge className={`text-[10px] ${LAYER_COLORS[b.bom_type]}`}>
                      {LAYER_LABELS[b.bom_type]}
                    </Badge>
                  </td>
                  <td className="px-4 py-2.5 text-xs text-muted-foreground">{b.subcategory || '—'}</td>
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

          {totalPages > 1 && (
            <div className="flex items-center justify-between px-4 py-3 border-t border-border bg-muted/30">
              <span className="text-xs text-muted-foreground">
                Showing {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, filtered.length)} of {filtered.length}
              </span>
              <div className="flex gap-1">
                <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage(p => p - 1)}>Prev</Button>
                <Button variant="outline" size="sm" disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)}>Next</Button>
              </div>
            </div>
          )}
        </div>
      )}

      {selectedBom && (
        <RecipeDetailDrawer
          bom={selectedBom}
          onClose={() => setSelectedBom(null)}
          onUpdated={() => queryClient.invalidateQueries({ queryKey: ['recipes-boms'] })}
        />
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