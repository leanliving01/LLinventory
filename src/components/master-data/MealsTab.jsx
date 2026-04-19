import React from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { cn } from '@/lib/utils';
import { Switch } from '@/components/ui/switch';
import { toast } from 'sonner';
import { GOAL_PACKAGE_TYPES, LOW_CARB_PACKAGE_TYPES, PACKAGE_LABELS, PACKAGE_COLORS, groupSkusByMeal } from '@/lib/mealGrouping';

export default function MealsTab() {
  const queryClient = useQueryClient();

  const { data: meals = [] } = useQuery({
    queryKey: ['meals'],
    queryFn: () => base44.entities.Meal.list('-created_date', 50),
  });

  const { data: skus = [] } = useQuery({
    queryKey: ['skus'],
    queryFn: () => base44.entities.SKU.list('-sku_code', 200),
  });

  const mealGroups = groupSkusByMeal(skus, meals);
  const goalMeals = mealGroups.filter(m => m.familyType === 'goal_related');
  const lowCarbMeals = mealGroups.filter(m => m.familyType === 'low_carb');

  const handleToggleMeal = async (mealId, currentActive) => {
    const newActive = !currentActive;
    await base44.entities.Meal.update(mealId, { is_active: newActive });
    queryClient.invalidateQueries({ queryKey: ['meals'] });
    toast.success(`Meal ${newActive ? 'activated' : 'deactivated'}`);
  };

  return (
    <div className="space-y-6">
      <MealTable title="Goal-Related Meals" items={goalMeals} packageTypes={GOAL_PACKAGE_TYPES} meals={meals} onToggle={handleToggleMeal} />
      <MealTable title="Low Carb Meals" items={lowCarbMeals} packageTypes={LOW_CARB_PACKAGE_TYPES} meals={meals} onToggle={handleToggleMeal} />
    </div>
  );
}

function MealTable({ title, items, packageTypes, meals, onToggle }) {
  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      <div className="px-6 py-3 border-b border-border bg-muted/30">
        <h3 className="text-sm font-bold uppercase tracking-wide">{title} ({items.length})</h3>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b border-border">
              <th rowSpan={2} className="text-left px-4 py-2 text-xs font-semibold text-muted-foreground uppercase min-w-[180px]">
                Meal Name
              </th>
              <th rowSpan={2} className="text-center px-3 py-2 text-xs font-semibold text-muted-foreground uppercase w-20">
                Active
              </th>
              {packageTypes.map(pt => {
                const colors = PACKAGE_COLORS[pt];
                return (
                  <th key={pt} colSpan={2} className={cn("text-center px-1 py-2 text-xs font-bold uppercase border-l border-border", colors.bg, colors.text)}>
                    {PACKAGE_LABELS[pt]}
                  </th>
                );
              })}
            </tr>
            <tr className="bg-muted/30 border-b border-border">
              {packageTypes.map(pt => (
                <React.Fragment key={pt}>
                  <th className="text-center px-1 py-1.5 text-[10px] text-muted-foreground border-l border-border">Portion</th>
                  <th className="text-center px-1 py-1.5 text-[10px] text-muted-foreground">Status</th>
                </React.Fragment>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {items.length === 0 ? (
              <tr><td colSpan={2 + packageTypes.length * 2} className="text-center py-8 text-sm text-muted-foreground">No meals found</td></tr>
            ) : items.map(row => {
              const meal = meals.find(m => m.id === row.mealId);
              const isActive = meal ? meal.is_active !== false : true;
              return (
                <tr key={row.mealName} className={cn("hover:bg-muted/30 transition-colors", !isActive && "opacity-50")}>
                  <td className="px-4 py-2.5 text-sm font-medium">{row.mealName}</td>
                  <td className="px-3 py-2.5 text-center">
                    <Switch
                      checked={isActive}
                      onCheckedChange={() => onToggle(meal?.id || row.mealId, isActive)}
                      className="mx-auto"
                    />
                  </td>
                  {packageTypes.map(pt => {
                    const sku = row.skusByType[pt];
                    if (!sku) {
                      return <td key={pt} colSpan={2} className="px-1 py-2.5 text-center text-muted-foreground text-[10px] border-l border-border">—</td>;
                    }
                    return (
                      <React.Fragment key={pt}>
                        <td className="px-1 py-2.5 text-center border-l border-border">
                          <span className="text-xs tabular-nums">{sku.portion_size_grams ? `${sku.portion_size_grams}g` : '—'}</span>
                        </td>
                        <td className="px-1 py-2.5 text-center">
                          <span className={cn(
                            "text-[10px] px-1.5 py-0.5 rounded-full",
                            sku.is_active !== false ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'
                          )}>
                            {sku.is_active !== false ? 'Active' : 'Inactive'}
                          </span>
                        </td>
                      </React.Fragment>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}