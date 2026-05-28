import React, { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { X } from 'lucide-react';
import { toast } from 'sonner';

const FAMILIES = [
  { value: 'MWL', label: "Men's Weight Loss" },
  { value: 'MLM', label: "Men's Lean Muscle" },
  { value: 'WWL', label: "Women's Weight Loss" },
  { value: 'WLM', label: "Women's Lean Muscle" },
  { value: 'LOW_CARB', label: 'Low Carb' },
  { value: 'BYO', label: 'Build Your Own' },
];

export default function AddPackageForm({ onClose }) {
  const queryClient = useQueryClient();
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    name: '',
    package_family: '',
    pack_size: '',
    shopify_product_id: '',
  });

  const handleSave = async () => {
    if (!form.name || !form.package_family || !form.pack_size) {
      toast.error('Please fill in name, family, and pack size');
      return;
    }
    setSaving(true);

    try {
      await base44.entities.PackageProduct.create({
        ...form,
        pack_size: Number(form.pack_size),
        is_active: true,
      });
      queryClient.invalidateQueries({ queryKey: ['packageProducts'] });
      toast.success(`Created package: ${form.name}`);
    } catch (err) {
      toast.error('Save failed: ' + (err.message || 'Unknown error'));
    } finally {
      setSaving(false);
    }

    onClose();
  };

  return (
    <div className="bg-card border border-border rounded-xl p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-bold">Add New Package</h3>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose}>
          <X className="w-4 h-4" />
        </Button>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <Input
          placeholder="Package name *"
          value={form.name}
          onChange={e => setForm(prev => ({ ...prev, name: e.target.value }))}
        />
        <Select value={form.package_family} onValueChange={v => setForm(prev => ({ ...prev, package_family: v }))}>
          <SelectTrigger>
            <SelectValue placeholder="Family *" />
          </SelectTrigger>
          <SelectContent>
            {FAMILIES.map(f => (
              <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input
          type="number"
          placeholder="Pack size (meals) *"
          value={form.pack_size}
          onChange={e => setForm(prev => ({ ...prev, pack_size: e.target.value }))}
        />
        <Input
          placeholder="Shopify Product ID (optional)"
          value={form.shopify_product_id}
          onChange={e => setForm(prev => ({ ...prev, shopify_product_id: e.target.value }))}
        />
      </div>
      <div className="flex justify-end mt-4">
        <Button onClick={handleSave} disabled={saving} size="sm">
          {saving ? 'Creating...' : 'Create Package'}
        </Button>
      </div>
    </div>
  );
}