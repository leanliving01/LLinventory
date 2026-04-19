import React, { useState, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Search, Pencil } from 'lucide-react';
import { cn } from '@/lib/utils';
import { GOAL_PACKAGE_TYPES, LOW_CARB_PACKAGE_TYPES, PACKAGE_LABELS, PACKAGE_COLORS, groupSkusByMeal } from '@/lib/mealGrouping';
import EditMealNameDialog from './EditMealNameDialog';

export default function SKUsTab() {
  const [search, setSearch] = useState('');
  const [editingMeal, setEditingMeal] = useState(null);
  const queryClient = useQueryClient();

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

  const goalMeals = mealGroups.filter(m => m.familyType === 'goal_related');
  const lowCarbMeals = mealGroups.filter(m => m.familyType === 'low_carb');

  const handleSaved = () => {
    queryClient.invalidateQueries({ queryKey: ['skus'] });
    queryClient.invalidateQueries({ queryKey: ['meals'] });
  };

  return (
    <div className="space-y-4">
      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input placeholder="Search meals..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
      </div>

      <SKUTable title="Goal-Related Meals" items={goalMeals} packageTypes={GOAL_PACKAGE_TYPES} onEdit={setEditingMeal} />
      <SKUTable title="Low Carb Meals" items={lowCarbMeals} packageTypes={LOW_CARB_PACKAGE_TYPES} onEdit={setEditingMeal} />

      <div className="text-xs text-muted-foreground px-1">
        Showing {mealGroups.length} meals with {skus.filter(s => s.is_active !== false).length} active SKUs
      </div>

      {editingMeal && (
        <EditMealNameDialog
          open={!!editingMeal}
          onClose={() => setEditingMeal(null)}
          mealGroup={editingMeal}
          onSaved={handleSaved}
        />
      )}
    </div>
  );
}

function SKUTable({ title, items, packageTypes, onEdit }) {
  if (items.length === 0) return null;

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      <div className="px-6 py-3 border-b border-border bg-muted/30">
        <h3 className="text-sm font-bold uppercase tracking-wide">{title}</h3>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b border-border">
              <th className="text-left px-4 py-2 text-xs font-semibold text-muted-foreground uppercase min-w-[180px]">
                Meal
              </th>
              {packageTypes.map(pt => {
                const colors = PACKAGE_COLORS[pt];
                return (
                  <th key={pt} className={cn("text-center px-2 py-2 text-xs font-bold uppercase border-l border-border", colors.bg, colors.text)}>
                    {PACKAGE_LABELS[pt]}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {items.map(row => (
              <tr key={row.mealName} className="hover:bg-muted/30 transition-colors group">
                <td className="px-4 py-2.5 text-sm font-medium">
                  <div className="flex items-center gap-2">
                    <span className="flex-1">{row.mealName}</span>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                      onClick={() => onEdit(row)}
                    >
                      <Pencil className="w-3 h-3" />
                    </Button>
                  </div>
                </td>
                {packageTypes.map(pt => {
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
    </div>
  );
}