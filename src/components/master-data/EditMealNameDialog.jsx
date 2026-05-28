import React, { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2 } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { toast } from 'sonner';

export default function EditMealNameDialog({ open, onClose, mealGroup, onSaved }) {
  const [newName, setNewName] = useState(mealGroup?.mealName || '');
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    const trimmed = newName.trim();
    if (!trimmed || trimmed === mealGroup.mealName) {
      onClose();
      return;
    }

    setSaving(true);

    try {
      // 1. Update the Meal entity name
      if (mealGroup.mealId) {
        await base44.entities.Meal.update(mealGroup.mealId, { meal_name: trimmed });
      }

      // 2. Update all SKUs for this meal
      const allSkus = Object.values(mealGroup.skusByType);
      for (const sku of allSkus) {
        const displayName = `${trimmed} (${sku.package_type === 'LOW_CARB' ? 'LC' : sku.package_type} ${sku.portion_size_grams}g)`;
        await base44.entities.SKU.update(sku.id, {
          meal_name: trimmed,
          display_name: displayName,
        });
      }

      toast.success(`Updated "${mealGroup.mealName}" → "${trimmed}" across ${allSkus.length} SKUs`);
    } catch (err) {
      toast.error('Save failed: ' + (err.message || 'Unknown error'));
    } finally {
      setSaving(false);
    }

    onSaved();
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Edit Meal Name</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div>
            <Label className="text-xs text-muted-foreground">Current name</Label>
            <p className="text-sm font-medium">{mealGroup?.mealName}</p>
          </div>
          <div>
            <Label htmlFor="newName">New name</Label>
            <Input
              id="newName"
              value={newName}
              onChange={e => setNewName(e.target.value)}
              placeholder="Enter new meal name..."
              className="mt-1"
            />
          </div>
          <p className="text-xs text-muted-foreground">
            This will update the meal and all {Object.keys(mealGroup?.skusByType || {}).length} SKU variants.
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving || !newName.trim()}>
            {saving && <Loader2 className="w-4 h-4 animate-spin mr-1" />}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}