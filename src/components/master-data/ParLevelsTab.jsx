import React, { useState, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Search, Save } from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import { GOAL_PACKAGE_TYPES, LOW_CARB_PACKAGE_TYPES, PACKAGE_LABELS, PACKAGE_COLORS, groupSkusByMeal } from '@/lib/mealGrouping';

export default function ParLevelsTab() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [edits, setEdits] = useState({});
  const [saving, setSaving] = useState(false);

  const { data: skus = [] } = useQuery({
    queryKey: ['skus'],
    queryFn: () => base44.entities.SKU.list('-sku_code', 200),
  });

  const { data: meals = [] } = useQuery({
    queryKey: ['meals'],
    queryFn: () => base44.entities.Meal.list('-created_date', 50),
  });

  const { data: parLevels = [] } = useQuery({
    queryKey: ['parLevels'],
    queryFn: () => base44.entities.ParLevel.list('-created_date', 200),
  });

  const parBySkuId = useMemo(() => {
    const map = {};
    parLevels.forEach(p => { map[p.sku_id] = p; });
    return map;
  }, [parLevels]);

  const mealGroups = useMemo(() => {
    const groups = groupSkusByMeal(skus, meals);
    if (!search) return groups;
    return groups.filter(g => g.mealName.toLowerCase().includes(search.toLowerCase()));
  }, [skus, meals, search]);

  const goalMeals = mealGroups.filter(m => m.familyType === 'goal_related');
  const lowCarbMeals = mealGroups.filter(m => m.familyType === 'low_carb');

  const handleSave = async () => {
    const entries = Object.entries(edits).filter(([_, v]) => v !== '' && v !== undefined);
    if (entries.length === 0) return;

    setSaving(true);
    const today = format(new Date(), 'yyyy-MM-dd');

    for (const [skuId, value] of entries) {
      const existing = parBySkuId[skuId];
      const sku = skus.find(s => s.id === skuId);
      if (existing) {
        await base44.entities.ParLevel.update(existing.id, { par_level: Number(value) });
      } else {
        await base44.entities.ParLevel.create({
          sku_id: skuId,
          sku_display_name: sku?.display_name || '',
          package_type: sku?.package_type || '',
          par_level: Number(value),
          effective_from: today,
        });
      }
    }

    queryClient.invalidateQueries({ queryKey: ['parLevels'] });
    setEdits({});
    toast.success(`Updated par levels for ${entries.length} SKUs`);
    setSaving(false);
  };

  const editCount = Object.values(edits).filter(v => v !== '' && v !== undefined).length;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input placeholder="Search meals..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
        </div>
        <Button onClick={handleSave} disabled={saving || editCount === 0} size="sm" className="gap-2">
          <Save className="w-3.5 h-3.5" />
          Save ({editCount})
        </Button>
      </div>

      <ParTable title="Goal-Related Meals" items={goalMeals} packageTypes={GOAL_PACKAGE_TYPES} parBySkuId={parBySkuId} edits={edits} setEdits={setEdits} />
      <ParTable title="Low Carb Meals" items={lowCarbMeals} packageTypes={LOW_CARB_PACKAGE_TYPES} parBySkuId={parBySkuId} edits={edits} setEdits={setEdits} />
    </div>
  );
}

function ParTable({ title, items, packageTypes, parBySkuId, edits, setEdits }) {
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
                  <th key={pt} className={cn("text-center px-2 py-2 text-xs font-bold uppercase border-l border-border min-w-[100px]", colors.bg, colors.text)}>
                    {PACKAGE_LABELS[pt]}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {items.map(row => (
              <tr key={row.mealName} className="hover:bg-muted/30 transition-colors">
                <td className="px-4 py-2.5 text-sm font-medium">{row.mealName}</td>
                {packageTypes.map(pt => {
                  const sku = row.skusByType[pt];
                  if (!sku) {
                    return <td key={pt} className="px-2 py-2.5 text-center text-muted-foreground text-[10px] border-l border-border">—</td>;
                  }
                  const par = parBySkuId[sku.id];
                  return (
                    <td key={pt} className="px-2 py-2.5 border-l border-border">
                      <div className="flex flex-col items-center gap-1">
                        <span className="text-[10px] text-muted-foreground tabular-nums">
                          {par ? `Current: ${par.par_level}` : 'Not set'}
                        </span>
                        <Input
                          type="number"
                          min="0"
                          placeholder={par ? String(par.par_level) : 'Set...'}
                          value={edits[sku.id] ?? ''}
                          onChange={e => setEdits(prev => ({ ...prev, [sku.id]: e.target.value }))}
                          className="w-16 text-center h-6 text-[11px] px-1"
                        />
                      </div>
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