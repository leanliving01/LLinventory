import React, { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Search, Package, ChevronRight, AlertTriangle } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

const TYPE_LABELS = { goal_based: 'Goal-Based', low_carb: 'Low Carb', byo: 'BYO', bundle: 'Bundle' };
const TYPE_COLORS = { goal_based: 'bg-green-100 text-green-700', low_carb: 'bg-orange-100 text-orange-700', byo: 'bg-blue-100 text-blue-700', bundle: 'bg-purple-100 text-purple-700' };

export default function PackBomManager() {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');

  const { data: packBoms = [], isLoading } = useQuery({
    queryKey: ['pack-boms'],
    queryFn: () => base44.entities.PackBom.list('package_sku', 200),
  });

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

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Pack Compositions</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Manage which meals go into each package. Toggle meals on/off and adjust quantities for substitutions.
        </p>
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
                <tr><td colSpan={7} className="px-4 py-12 text-center text-sm text-muted-foreground">No pack BOMs match your filter.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function parseOverrides(str) {
  if (!str) return {};
  try { return JSON.parse(str); } catch { return {}; }
}