import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { X } from 'lucide-react';
import { toast } from 'sonner';
import { PACKAGE_TYPES, PACKAGE_LABELS } from '@/lib/mealGrouping';

export default function CreateCustomSKU({ onClose }) {
  const queryClient = useQueryClient();
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    sku_code: '',
    meal_name: '',
    package_type: '',
    portion_size_grams: '',
    display_name: '',
  });

  const handleSave = async () => {
    if (!form.sku_code || !form.meal_name || !form.package_type) {
      toast.error('Please fill in SKU code, meal name, and package type');
      return;
    }

    setSaving(true);

    // Check if meal exists, create if not
    const meals = await base44.entities.Meal.filter({ meal_name: form.meal_name });
    let mealId;
    if (meals.length > 0) {
      mealId = meals[0].id;
    } else {
      const familyType = form.package_type === 'LOW_CARB' ? 'low_carb' : 'goal_related';
      const newMeal = await base44.entities.Meal.create({
        meal_name: form.meal_name,
        family_type: familyType,
        is_active: true,
      });
      mealId = newMeal.id;
      queryClient.invalidateQueries({ queryKey: ['meals'] });
    }

    await base44.entities.SKU.create({
      sku_code: form.sku_code,
      meal_id: mealId,
      meal_name: form.meal_name,
      package_type: form.package_type,
      portion_size_grams: form.portion_size_grams ? Number(form.portion_size_grams) : undefined,
      display_name: form.display_name || `${form.meal_name} (${PACKAGE_LABELS[form.package_type]})`,
      is_active: true,
    });

    queryClient.invalidateQueries({ queryKey: ['skus'] });
    toast.success(`Created custom SKU: ${form.sku_code}`);
    setSaving(false);
    onClose();
  };

  return (
    <div className="bg-card border border-border rounded-xl p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-bold">Create Custom SKU</h3>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose}>
          <X className="w-4 h-4" />
        </Button>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <Input
          placeholder="SKU Code *"
          value={form.sku_code}
          onChange={e => setForm(prev => ({ ...prev, sku_code: e.target.value }))}
        />
        <Input
          placeholder="Meal Name *"
          value={form.meal_name}
          onChange={e => setForm(prev => ({ ...prev, meal_name: e.target.value }))}
        />
        <Select value={form.package_type} onValueChange={v => setForm(prev => ({ ...prev, package_type: v }))}>
          <SelectTrigger>
            <SelectValue placeholder="Package Type *" />
          </SelectTrigger>
          <SelectContent>
            {PACKAGE_TYPES.map(pt => (
              <SelectItem key={pt} value={pt}>{PACKAGE_LABELS[pt]}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input
          type="number"
          placeholder="Portion Size (g)"
          value={form.portion_size_grams}
          onChange={e => setForm(prev => ({ ...prev, portion_size_grams: e.target.value }))}
        />
        <Input
          placeholder="Display Name (auto-generated if blank)"
          value={form.display_name}
          onChange={e => setForm(prev => ({ ...prev, display_name: e.target.value }))}
          className="md:col-span-2"
        />
      </div>
      <div className="flex justify-end mt-4">
        <Button onClick={handleSave} disabled={saving} size="sm">
          {saving ? 'Creating...' : 'Create SKU'}
        </Button>
      </div>
    </div>
  );
}