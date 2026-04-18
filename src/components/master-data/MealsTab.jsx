import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Badge } from '@/components/ui/badge';

export default function MealsTab() {
  const { data: meals = [], isLoading } = useQuery({
    queryKey: ['meals'],
    queryFn: () => base44.entities.Meal.list('-created_date', 50),
  });

  const goalMeals = meals.filter(m => m.family_type === 'goal_related');
  const lowCarbMeals = meals.filter(m => m.family_type === 'low_carb');

  return (
    <div className="space-y-6">
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="px-6 py-4 border-b border-border">
          <h3 className="text-sm font-semibold">Goal-Related Meals ({goalMeals.length})</h3>
        </div>
        <table className="w-full">
          <thead>
            <tr className="bg-muted/50 border-b border-border">
              <th className="text-left px-6 py-3 text-xs font-semibold text-muted-foreground uppercase">#</th>
              <th className="text-left px-6 py-3 text-xs font-semibold text-muted-foreground uppercase">Meal Name</th>
              <th className="text-left px-6 py-3 text-xs font-semibold text-muted-foreground uppercase">Type</th>
              <th className="text-left px-6 py-3 text-xs font-semibold text-muted-foreground uppercase">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {goalMeals.map((meal, i) => (
              <tr key={meal.id} className="hover:bg-muted/30 transition-colors">
                <td className="px-6 py-3 text-sm text-muted-foreground">{i + 1}</td>
                <td className="px-6 py-3 text-sm font-medium">{meal.meal_name}</td>
                <td className="px-6 py-3"><Badge variant="outline" className="text-[10px]">Goal Related</Badge></td>
                <td className="px-6 py-3">
                  <span className={`text-xs px-2 py-1 rounded-full ${meal.is_active ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>
                    {meal.is_active ? 'Active' : 'Inactive'}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="px-6 py-4 border-b border-border">
          <h3 className="text-sm font-semibold">Low Carb Meals ({lowCarbMeals.length})</h3>
        </div>
        <table className="w-full">
          <thead>
            <tr className="bg-muted/50 border-b border-border">
              <th className="text-left px-6 py-3 text-xs font-semibold text-muted-foreground uppercase">#</th>
              <th className="text-left px-6 py-3 text-xs font-semibold text-muted-foreground uppercase">Meal Name</th>
              <th className="text-left px-6 py-3 text-xs font-semibold text-muted-foreground uppercase">Type</th>
              <th className="text-left px-6 py-3 text-xs font-semibold text-muted-foreground uppercase">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {lowCarbMeals.map((meal, i) => (
              <tr key={meal.id} className="hover:bg-muted/30 transition-colors">
                <td className="px-6 py-3 text-sm text-muted-foreground">{i + 1}</td>
                <td className="px-6 py-3 text-sm font-medium">{meal.meal_name}</td>
                <td className="px-6 py-3"><Badge variant="outline" className="text-[10px]">Low Carb</Badge></td>
                <td className="px-6 py-3">
                  <span className={`text-xs px-2 py-1 rounded-full ${meal.is_active ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>
                    {meal.is_active ? 'Active' : 'Inactive'}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}