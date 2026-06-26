import React, { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Plus, X, Loader2, Check } from 'lucide-react';
import { toast } from 'sonner';

/**
 * Purchase UOM picker — a single CLEAN NAME for how a product is bought
 * (Case, Bag, Pocket, Tub, kg…). Adding a new one asks ONLY for a name; the
 * value stored is that name. No code, no category for the user to get wrong.
 *
 * Lists every unit of measure (packaging units first, then measurement units so
 * loose "per kg" items can still pick kg/L/each).
 */
const CAT_ORDER = { pack: 0, count: 1, weight: 2, volume: 3, other: 4, length: 5 };

export default function PurchaseUnitSelect({ value, onValueChange, placeholder = 'Select purchase unit' }) {
  const queryClient = useQueryClient();
  const [showAdd, setShowAdd] = useState(false);
  const [newName, setNewName] = useState('');
  const [saving, setSaving] = useState(false);

  const { data: uoms = [] } = useQuery({
    queryKey: ['uom-list'],
    queryFn: () => base44.entities.UnitOfMeasure.list('name', 300),
  });

  const handleAdd = async () => {
    const name = newName.trim();
    if (!name) return;
    setSaving(true);
    try {
      // Reuse an existing unit if the name already exists (case-insensitive),
      // otherwise create it as a packaging unit (code = name).
      const existing = uoms.find(u => (u.code || '').toLowerCase() === name.toLowerCase()
        || (u.name || '').toLowerCase() === name.toLowerCase());
      const code = existing?.code || name;
      if (!existing) {
        await base44.entities.UnitOfMeasure.create({ code: name, name, category: 'pack', is_default: false });
        queryClient.invalidateQueries({ queryKey: ['uom-list'] });
      }
      onValueChange(code);
      setShowAdd(false);
      setNewName('');
    } catch (err) {
      toast.error('Save failed: ' + (err.message || 'Unknown error'));
    } finally {
      setSaving(false);
    }
  };

  // Sort packaging units first, then by name.
  const sorted = [...uoms].sort((a, b) =>
    (CAT_ORDER[a.category] ?? 9) - (CAT_ORDER[b.category] ?? 9) || (a.name || '').localeCompare(b.name || ''));

  // Always render the current value even if it isn't an exact known code — so the
  // field shows what's stored instead of going blank (e.g. a legacy "p/kg" or a
  // casing difference like "box" vs "Box").
  const exact = !value || sorted.some(u => u.code === value);
  const options = exact ? sorted : [{ code: value, name: value }, ...sorted];

  if (showAdd) {
    return (
      <div className="border border-primary/30 rounded-lg p-3 space-y-2 bg-primary/5">
        <div className="flex items-center justify-between">
          <p className="text-xs font-semibold text-primary">Add purchase unit</p>
          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setShowAdd(false)}>
            <X className="w-3.5 h-3.5" />
          </Button>
        </div>
        <p className="text-[11px] text-muted-foreground -mt-1">
          Just a name for how you buy it — e.g. <strong>Case</strong>, <strong>Bag</strong>, <strong>Pocket</strong>, <strong>Tub</strong>.
        </p>
        <div className="flex items-end gap-2">
          <div className="flex-1">
            <Input
              placeholder="e.g. Case"
              value={newName}
              onChange={e => setNewName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleAdd(); }}
              autoFocus
            />
          </div>
          <Button size="sm" className="h-9 gap-1" onClick={handleAdd} disabled={saving || !newName.trim()}>
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
          {options.map(u => (
            <SelectItem key={u.code} value={u.code}>{u.name || u.code}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button type="button" variant="outline" size="icon" className="h-9 w-9 shrink-0"
        onClick={() => setShowAdd(true)} title="Add purchase unit">
        <Plus className="w-4 h-4" />
      </Button>
    </div>
  );
}
