import React, { useState, useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { X, Save, Loader2, Search, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import MaterialLineEditor from './MaterialLineEditor';

/** Parse the materials JSON string from a rule, with legacy fallback */
function parseMaterials(rule) {
  if (!rule) return [emptyMaterial()];
  // New format: JSON array in `materials` field
  if (rule.materials) {
    try {
      const parsed = JSON.parse(rule.materials);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    } catch { /* fall through */ }
  }
  // Legacy: single material fields
  if (rule.material_product_id) {
    return [{
      product_id: rule.material_product_id,
      sku: rule.material_sku || '',
      name: rule.material_name || '',
      deduction_mode: rule.deduction_mode || 'fixed_per_order',
      qty_per_deduction: rule.qty_per_deduction ?? 1,
      per_x_items: rule.per_x_items ?? 30,
    }];
  }
  return [emptyMaterial()];
}

function emptyMaterial() {
  return { product_id: '', sku: '', name: '', deduction_mode: 'fixed_per_order', qty_per_deduction: 1, per_x_items: 30 };
}

export default function PackingRuleForm({ rule, products, onClose, defaultTrigger }) {
  const queryClient = useQueryClient();
  const isEditing = !!rule;

  const [name, setName] = useState(rule?.name || '');
  const [trigger, setTrigger] = useState(rule?.trigger || defaultTrigger || 'has_meals');
  const [materials, setMaterials] = useState(() => parseMaterials(rule));
  const [notes, setNotes] = useState(rule?.notes || '');
  const [saving, setSaving] = useState(false);

  const updateMaterial = (index, updates) => {
    setMaterials(prev => prev.map((m, i) => i === index ? { ...m, ...updates } : m));
  };

  const removeMaterial = (index) => {
    setMaterials(prev => prev.filter((_, i) => i !== index));
  };

  const addMaterial = () => {
    setMaterials(prev => [...prev, emptyMaterial()]);
  };

  const handleSave = async () => {
    if (!name.trim()) { toast.error('Name is required'); return; }
    const validMaterials = materials.filter(m => m.product_id);
    if (validMaterials.length === 0) { toast.error('Add at least one packaging material'); return; }
    const badQty = validMaterials.find(m => (m.qty_per_deduction || 0) <= 0);
    if (badQty) { toast.error(`Qty must be > 0 for ${badQty.name || 'a material'}`); return; }

    setSaving(true);

    // Also keep legacy fields pointing to the first material for backward compat
    const first = validMaterials[0];
    const data = {
      name: name.trim(),
      trigger,
      materials: JSON.stringify(validMaterials),
      // Legacy fields (first material)
      material_product_id: first.product_id,
      material_sku: first.sku,
      material_name: first.name,
      deduction_mode: first.deduction_mode,
      qty_per_deduction: Number(first.qty_per_deduction),
      per_x_items: first.deduction_mode === 'per_x_items' ? Number(first.per_x_items) : 1,
      notes: notes.trim() || undefined,
      is_active: rule?.is_active ?? true,
    };

    if (isEditing) {
      await base44.entities.PackingMaterialRule.update(rule.id, data);
      toast.success(`Updated "${name}"`);
    } else {
      await base44.entities.PackingMaterialRule.create(data);
      toast.success(`Created "${name}"`);
    }

    queryClient.invalidateQueries({ queryKey: ['packing-material-rules'] });
    setSaving(false);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-start justify-center pt-12 px-4">
      <div className="bg-card border border-border rounded-xl shadow-xl w-full max-w-lg max-h-[85vh] overflow-y-auto">
        {/* Header */}
        <div className="px-6 py-4 border-b border-border flex items-center justify-between sticky top-0 bg-card z-10">
          <h3 className="text-sm font-semibold">{isEditing ? 'Edit Rule' : 'New Packing Material Rule'}</h3>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-muted">
            <X className="w-4 h-4" strokeWidth={1.5} />
          </button>
        </div>

        <div className="p-6 space-y-5">
          {/* Name */}
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold">Rule Name</Label>
            <Input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Meal Order Packing, Supplement Packing" />
          </div>

          {/* Trigger */}
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold">When does this fire?</Label>
            <Select value={trigger} onValueChange={setTrigger}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="has_supplements">Order has supplements</SelectItem>
                <SelectItem value="has_meals">Order has meals</SelectItem>
                <SelectItem value="always">Every order</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Materials list */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label className="text-xs font-semibold">Materials to Deduct</Label>
              <Button variant="outline" size="sm" className="gap-1.5 h-7 text-xs" onClick={addMaterial}>
                <Plus className="w-3 h-3" strokeWidth={1.5} />
                Add Material
              </Button>
            </div>

            <div className="space-y-3">
              {materials.map((mat, idx) => (
                <MaterialLineEditor
                  key={idx}
                  material={mat}
                  index={idx}
                  products={products}
                  trigger={trigger}
                  canRemove={materials.length > 1}
                  onChange={(updates) => updateMaterial(idx, updates)}
                  onRemove={() => removeMaterial(idx)}
                />
              ))}
            </div>
          </div>

          {/* Notes */}
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold">Notes (optional)</Label>
            <Input value={notes} onChange={e => setNotes(e.target.value)} placeholder="Internal notes..." />
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-border flex justify-end gap-3 sticky bottom-0 bg-card">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving} className="gap-1.5">
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" strokeWidth={1.5} />}
            {isEditing ? 'Update' : 'Create Rule'}
          </Button>
        </div>
      </div>
    </div>
  );
}