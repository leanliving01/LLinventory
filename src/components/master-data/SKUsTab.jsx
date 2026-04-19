import React, { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Input } from '@/components/ui/input';
import { Search } from 'lucide-react';
import { PACKAGE_TYPES, PACKAGE_LABELS, groupSkusByMeal } from '@/lib/mealGrouping';

export default function SKUsTab() {
  const [search, setSearch] = useState('');

  const { data: skus = [] } = useQuery({
    queryKey: ['skus'],
    queryFn: () => base44.entities.SKU.list('-sku_code', 200),
  });

  const { data: meals = [] } = useQuery({
    queryKey: ['meals'],
    queryFn: () => base44.entities.Meal.list('-created_date', 50),
  });

  const mealGroups = useMemo(() => {
    const groups = groupSkusByMeal(skus, meals);
    if (!search) return groups;
    return groups.filter(g => g.mealName.toLowerCase().includes(search.toLowerCase()));
  }, [skus, meals, search]);

  return (
    <div className="space-y-4">
      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input placeholder="Search meals..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
      </div>

      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr className="bg-muted/50 border-b border-border">
                <th className="text-left px-4 py-2 text-xs font-semibold text-muted-foreground uppercase min-w-[180px]">
                  Meal
                </th>
                {PACKAGE_TYPES.map(pt => (
                  <th key={pt} className="text-center px-2 py-2 text-xs font-semibold text-foreground uppercase border-l border-border">
                    {PACKAGE_LABELS[pt]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {mealGroups.length === 0 ? (
                <tr><td colSpan={1 + PACKAGE_TYPES.length} className="text-center py-8 text-sm text-muted-foreground">No SKUs found</td></tr>
              ) : mealGroups.map(row => (
                <tr key={row.mealName} className="hover:bg-muted/30 transition-colors">
                  <td className="px-4 py-2.5 text-sm font-medium">{row.mealName}</td>
                  {PACKAGE_TYPES.map(pt => {
                    const sku = row.skusByType[pt];
                    if (!sku) {
                      return <td key={pt} className="px-2 py-2.5 text-center text-muted-foreground text-[10px] border-l border-border">—</td>;
                    }
                    return (
                      <td key={pt} className="px-2 py-2.5 text-center border-l border-border">
                        <span className="text-xs font-mono text-muted-foreground">{sku.sku_code}</span>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="px-4 py-3 border-t border-border text-xs text-muted-foreground">
          Showing {mealGroups.length} meals with {skus.filter(s => s.is_active !== false).length} active SKUs
        </div>
      </div>
    </div>
  );
}