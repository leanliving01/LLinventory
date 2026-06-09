import React, { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Plus, X, Loader2, Check } from 'lucide-react';
import { toast } from 'sonner';

/**
 * Reusable UoM selector that loads from the UnitOfMeasure entity.
 * Includes an inline "+" to add a new unit without leaving the page.
 */
export default function UomSelect({ value, onValueChange, placeholder = 'Select' }) {
  const queryClient = useQueryClient();
  const [showAdd, setShowAdd] = useState(false);
  const [newCode, setNewCode] = useState('');
  const [newName, setNewName] = useState('');
  const [newCategory, setNewCategory] = useState('other');
  const [saving, setSaving] = useState(false);

  const { data: uoms = [] } = useQuery({
    queryKey: ['uom-list'],
    queryFn: () => base44.entities.UnitOfMeasure.list('code', 200),
  });

  const handleAdd = async () => {
    if (!newCode.trim()) return;
    setSaving(true);

    try {
      await base44.entities.UnitOfMeasure.create({
        code: newCode.trim(),
        name: newName.trim() || newCode.trim(),
        category: newCategory,
        is_default: false,
      });
      queryClient.invalidateQueries({ queryKey: ['uom-list'] });
      onValueChange(newCode.trim());
      setShowAdd(false);
      setNewCode('');
      setNewName('');
    } catch (err) {
      toast.error('Save failed: ' + (err.message || 'Unknown error'));
    } finally {
      setSaving(false);
    }
  };

  const uomCodes = uoms.map(u => u.code);

  // Group by category for display
  const grouped = {};
  uoms.forEach(u => {
    if (!grouped[u.category]) grouped[u.category] = [];
    grouped[u.category].push(u);
  });

  const categoryLabels = {
    weight: 'Weight',
    volume: 'Volume',
    length: 'Length',
    count: 'Count',
    other: 'Other',
  };

  if (showAdd) {
    return (
      <div className="border border-primary/30 rounded-lg p-3 space-y-2 bg-primary/5">
        <div className="flex items-center justify-between">
          <p className="text-xs font-semibold text-primary">Add Unit of Measure</p>
          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setShowAdd(false)}>
            <X className="w-3.5 h-3.5" />
          </Button>
        </div>
        <div className="flex gap-2">
          <Input
            placeholder="Code (e.g. m)"
            value={newCode}
            onChange={e => setNewCode(e.target.value)}
            className="w-20 text-sm"
            autoFocus
          />
          <Input
            placeholder="Name (e.g. Metres)"
            value={newName}
            onChange={e => setNewName(e.target.value)}
            className="flex-1 text-sm"
          />
        </div>
        <div className="flex items-center gap-2">
          <Select value={newCategory} onValueChange={setNewCategory}>
            <SelectTrigger className="h-8 text-xs w-28">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(categoryLabels).map(([k, v]) => (
                <SelectItem key={k} value={k}>{v}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button size="sm" className="h-8 gap-1" onClick={handleAdd} disabled={saving || !newCode.trim()}>
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
            Add
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex gap-1.5 items-center">
      <Select value={value || ''} onValueChange={onValueChange}>
        <SelectTrigger className="flex-1">
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          {Object.entries(grouped).map(([cat, items]) => (
            <React.Fragment key={cat}>
              <div className="px-2 py-1 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                {categoryLabels[cat] || cat}
              </div>
              {items.map(u => (
                <SelectItem key={u.code} value={u.code}>
                  {u.code} — {u.name}
                </SelectItem>
              ))}
            </React.Fragment>
          ))}
        </SelectContent>
      </Select>
      <Button
        type="button"
        variant="outline"
        size="icon"
        className="h-9 w-9 shrink-0"
        onClick={() => setShowAdd(true)}
        title="Add new unit"
      >
        <Plus className="w-4 h-4" />
      </Button>
    </div>
  );
}