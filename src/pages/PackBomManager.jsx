import React, { useState, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Search, Package, ChevronRight, AlertTriangle, Plus, X, Loader2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';

const TYPE_LABELS = { goal_based: 'Goal-Based', low_carb: 'Low Carb', byo: 'BYO', bundle: 'Bundle' };
const TYPE_COLORS = {
  goal_based: 'bg-green-100 text-green-700',
  low_carb: 'bg-orange-100 text-orange-700',
  byo: 'bg-blue-100 text-blue-700',
  bundle: 'bg-purple-100 text-purple-700',
};

const BLANK = { packageSku: '', packageType: 'bundle', portionWeightG: '', multiplier: '1', selectedSkus: [] };

function parseOverrides(str) {
  if (!str) return {};
  try { return JSON.parse(str); } catch { return {}; }
}

export default function PackBomManager() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState(BLANK);
  const [creating, setCreating] = useState(false);
  const [mealSearch, setMealSearch] = useState('');

  const { data: packBoms = [], isLoading } = useQuery({
    queryKey: ['pack-boms'],
    queryFn: () => base44.entities.PackBom.list('package_sku', 200),
  });

  const { data: finishedMeals = [], isLoading: loadingMeals } = useQuery({
    queryKey: ['finished-meals-for-packbom'],
    queryFn: async () => {
      const products = await base44.entities.Product.filter({ type: 'finished_meal' }, 'name', 500);
      return products.filter(p => p.sku);
    },
    enabled: showCreate,
  });

  const filteredMeals = useMemo(() => {
    if (!mealSearch) return finishedMeals;
    const q = mealSearch.toLowerCase();
    return finishedMeals.filter(p => p.name?.toLowerCase().includes(q) || p.sku?.toLowerCase().includes(q));
  }, [finishedMeals, mealSearch]);

  const filtered = useMemo(() => {
    return packBoms.filter(pb => {
      if (!pb.active) return false;
      if (typeFilter !== 'all' && pb.package_type !== typeFilter) return false;
      if (search) {
        const q = search.toLowerCase();
        return pb.package_sku.toLowerCase().includes(q);
      }
      return true;
    });
  }, [packBoms, search, typeFilter]);

  const typeCounts = useMemo(() => {
    const c = {};
    packBoms.filter(pb => pb.active).forEach(pb => { c[pb.package_type] = (c[pb.package_type] || 0) + 1; });
    return c;
  }, [packBoms]);

  const toggleSku = (sku) => {
    setForm(f => ({
      ...f,
      selectedSkus: f.selectedSkus.includes(sku)
        ? f.selectedSkus.filter(s => s !== sku)
        : [...f.selectedSkus, sku],
    }));
  };

  const handleCreate = async () => {
    if (!form.packageSku.trim()) { toast.error('Package SKU is required'); return; }
    if (!form.packageType) { toast.error('Package type is required'); return; }
    if (form.selectedSkus.length === 0) { toast.error('Select at least one meal'); return; }
    setCreating(true);
    try {
      const newPack = await base44.entities.PackBom.create({
        package_sku: form.packageSku.trim().toUpperCase(),
        package_type: form.packageType,
        ...(form.portionWeightG ? { portion_weight_g: Number(form.portionWeightG) } : {}),
        multiplier: Number(form.multiplier) || 1,
        component_skus: form.selectedSkus,
        disabled_skus: [],
        sku_overrides: '{}',
        active: true,
      });
      queryClient.invalidateQueries({ queryKey: ['pack-boms'] });
      toast.success('Pack composition created — set per-meal quantities in the editor');
      setShowCreate(false);
      setForm(BLANK);
      setMealSearch('');
      navigate(`/purchasing/pack-bom/${newPack.id}`);
    } catch (err) {
      toast.error('Create failed: ' + (err.message || 'Unknown error'));
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold">Pack Compositions</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Manage which meals go into each package. Toggle meals on/off and adjust quantities for substitutions.
          </p>
        </div>
        <Button className="gap-2" onClick={() => setShowCreate(true)}>
          <Plus className="w-4 h-4" /> New Pack
        </Button>
      </div>

      {/* Type chips */}
      <div className="flex flex-wrap gap-2">
        {['goal_based', 'low_carb', 'byo', 'bundle'].map(t => (
          <button key={t} onClick={() => setTypeFilter(typeFilter === t ? 'all' : t)}
            className={`text-xs px-3 py-1.5 rounded-full font-medium transition-all ${
              typeFilter === t ? TYPE_COLORS[t] + ' ring-2 ring-primary/30' : TYPE_COLORS[t] + ' opacity-60 hover:opacity-100'
            }`}>
            {TYPE_LABELS[t]} ({typeCounts[t] || 0})
          </button>
        ))}
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input placeholder="Search by package SKU..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
      </div>

      {isLoading ? (
        <div className="text-center py-12 text-sm text-muted-foreground">Loading...</div>
      ) : (
        <div className="bg-card border rounded-xl overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="bg-muted/50 border-b border-border">
                <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase">Package SKU</th>
                <th className="text-center px-4 py-3 text-xs font-semibold text-muted-foreground uppercase">Type</th>
                <th className="text-center px-4 py-3 text-xs font-semibold text-muted-foreground uppercase">Portion</th>
                <th className="text-center px-4 py-3 text-xs font-semibold text-muted-foreground uppercase">Meals</th>
                <th className="text-center px-4 py-3 text-xs font-semibold text-muted-foreground uppercase">Default ×</th>
                <th className="text-center px-4 py-3 text-xs font-semibold text-muted-foreground uppercase">Status</th>
                <th className="w-10" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filtered.map(pb => {
                const disabledCount = (pb.disabled_skus || []).length;
                const overrides = parseOverrides(pb.sku_overrides);
                const hasOverrides = Object.keys(overrides).length > 0;
                const activeSkus = (pb.component_skus || []).filter(s => !(pb.disabled_skus || []).includes(s));
                const totalMeals = activeSkus.reduce((sum, sku) => sum + (overrides[sku] || pb.multiplier), 0);

                return (
                  <tr key={pb.id} className="hover:bg-muted/30 transition-colors cursor-pointer"
                    onClick={() => navigate(`/purchasing/pack-bom/${pb.id}`)}>
                    <td className="px-4 py-2.5 text-sm font-mono font-medium">{pb.package_sku}</td>
                    <td className="px-4 py-2.5 text-center">
                      <Badge className={`text-[10px] ${TYPE_COLORS[pb.package_type]}`}>{TYPE_LABELS[pb.package_type]}</Badge>
                    </td>
                    <td className="px-4 py-2.5 text-sm text-center tabular-nums">{pb.portion_weight_g}g</td>
                    <td className="px-4 py-2.5 text-sm text-center tabular-nums">{totalMeals}</td>
                    <td className="px-4 py-2.5 text-sm text-center tabular-nums">×{pb.multiplier}</td>
                    <td className="px-4 py-2.5 text-center">
                      {disabledCount > 0 || hasOverrides ? (
                        <Badge className="text-[10px] bg-amber-100 text-amber-700 gap-1">
                          <AlertTriangle className="w-3 h-3" />
                          {disabledCount} off{hasOverrides ? ' · Modified' : ''}
                        </Badge>
                      ) : (
                        <Badge className="text-[10px] bg-green-100 text-green-700">Standard</Badge>
                      )}
                    </td>
                    <td className="px-4 py-2.5"><ChevronRight className="w-4 h-4 text-muted-foreground" /></td>
                  </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr><td colSpan={7} className="px-4 py-12 text-center text-sm text-muted-foreground">No pack compositions yet. Click "New Pack" to create one.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Create Pack dialog */}
      {showCreate && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-card rounded-2xl border border-border w-full max-w-lg shadow-2xl flex flex-col max-h-[90vh]">
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-border shrink-0">
              <h2 className="text-lg font-bold">New Pack Composition</h2>
              <Button variant="ghost" size="icon" onClick={() => { setShowCreate(false); setForm(BLANK); setMealSearch(''); }}>
                <X className="w-5 h-5" />
              </Button>
            </div>

            {/* Body */}
            <div className="p-6 space-y-5 overflow-y-auto flex-1">
              {/* Package SKU */}
              <div>
                <label className="text-xs font-semibold text-muted-foreground block mb-1.5">Package SKU</label>
                <Input
                  placeholder="e.g. WWR15"
                  value={form.packageSku}
                  onChange={e => setForm(f => ({ ...f, packageSku: e.target.value }))}
                  className="font-mono"
                />
                <p className="text-[10px] text-muted-foreground mt-1">Must match the SKU on the package product in the catalog.</p>
              </div>

              {/* Type + Portion weight row */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold text-muted-foreground block mb-1.5">Pack Type</label>
                  <Select value={form.packageType} onValueChange={v => setForm(f => ({ ...f, packageType: v }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {Object.entries(TYPE_LABELS).map(([k, v]) => (
                        <SelectItem key={k} value={k}>{v}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="text-xs font-semibold text-muted-foreground block mb-1.5">Portion Weight (g)</label>
                  <Input
                    type="number"
                    placeholder="e.g. 350"
                    value={form.portionWeightG}
                    onChange={e => setForm(f => ({ ...f, portionWeightG: e.target.value }))}
                  />
                </div>
              </div>

              {/* Default multiplier */}
              <div>
                <label className="text-xs font-semibold text-muted-foreground block mb-1.5">Default quantity per meal (×)</label>
                <Input
                  type="number"
                  min="1"
                  placeholder="1"
                  value={form.multiplier}
                  onChange={e => setForm(f => ({ ...f, multiplier: e.target.value }))}
                  className="w-28"
                />
                <p className="text-[10px] text-muted-foreground mt-1">
                  Set to the most common quantity. You can override individual meals in the next step.
                  <br />For WWR15 use <strong>2</strong> (most meals ×2), for WWR30 use <strong>4</strong>, for WWR60 use <strong>8</strong>.
                </p>
              </div>

              {/* Meal selection */}
              <div>
                <label className="text-xs font-semibold text-muted-foreground block mb-1.5">
                  Component Meals
                  {form.selectedSkus.length > 0 && (
                    <span className="ml-2 text-primary">{form.selectedSkus.length} selected</span>
                  )}
                </label>
                <div className="relative mb-2">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                  <Input
                    placeholder="Filter meals..."
                    value={mealSearch}
                    onChange={e => setMealSearch(e.target.value)}
                    className="pl-8 h-8 text-sm"
                  />
                </div>
                {loadingMeals ? (
                  <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
                    <Loader2 className="w-4 h-4 animate-spin" /> Loading meals...
                  </div>
                ) : finishedMeals.length === 0 ? (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 dark:bg-amber-900/20 p-4 text-sm text-amber-800 dark:text-amber-300">
                    No finished meals with SKUs found. Assign SKUs to your soup/meal products in the catalog first, then come back here.
                  </div>
                ) : (
                  <div className="border border-border rounded-lg divide-y divide-border max-h-52 overflow-y-auto">
                    {filteredMeals.map(p => {
                      const checked = form.selectedSkus.includes(p.sku);
                      return (
                        <label key={p.id} className={`flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-muted/30 transition-colors ${checked ? 'bg-primary/5' : ''}`}>
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleSku(p.sku)}
                            className="accent-primary w-4 h-4 shrink-0"
                          />
                          <span className="font-mono text-xs text-muted-foreground w-16 shrink-0">{p.sku}</span>
                          <span className="text-sm">{p.name}</span>
                        </label>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            {/* Footer */}
            <div className="px-6 py-4 border-t border-border flex justify-end gap-2 shrink-0">
              <Button variant="outline" onClick={() => { setShowCreate(false); setForm(BLANK); setMealSearch(''); }}>
                Cancel
              </Button>
              <Button onClick={handleCreate} disabled={creating} className="gap-2">
                {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Package className="w-4 h-4" />}
                Create & Edit Quantities
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
