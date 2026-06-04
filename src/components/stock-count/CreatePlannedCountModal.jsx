import React, { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { X, Loader2, ClipboardCheck } from 'lucide-react';
import { toast } from 'sonner';
import { createPlannedCount } from '@/lib/stockCount';

const SCOPES = [
  { key: 'location', label: 'By Location', hint: 'One location, all categories' },
  { key: 'location_category', label: 'Location + Category', hint: 'One category in one location' },
  { key: 'category', label: 'By Category', hint: 'One category across every location' },
];

export default function CreatePlannedCountModal({ onCreated, onCancel }) {
  const [scope, setScope] = useState('location');
  const [locationId, setLocationId] = useState('');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [itemGroup, setItemGroup] = useState('all');
  const [assignedTo, setAssignedTo] = useState('none');
  const [saving, setSaving] = useState(false);

  const needsLocation = scope !== 'category';
  const needsCategory = scope !== 'location';

  const { data: locations = [] } = useQuery({
    queryKey: ['locations-stock-bearing'],
    queryFn: () => base44.entities.Location.filter({ is_stock_bearing: true }, 'name', 200),
  });

  const { data: products = [] } = useQuery({
    queryKey: ['products-active-categories'],
    queryFn: () => base44.entities.Product.filter({ status: 'active' }, 'name', 5000),
  });

  const { data: team = [] } = useQuery({
    queryKey: ['team-members-active'],
    queryFn: () => base44.entities.TeamMember.filter({ is_active: true }, 'name', 200),
  });

  const itemGroups = useMemo(() => {
    const set = new Set();
    products.forEach(p => { if (p.category) set.add(p.category); });
    return Array.from(set).sort();
  }, [products]);

  const handleCreate = async () => {
    const location = locations.find(l => l.id === locationId);
    if (needsLocation && !location) { toast.error('Select a location'); return; }
    if (needsCategory && (!itemGroup || itemGroup === 'all')) { toast.error('Select a category'); return; }
    if (!date) { toast.error('Select a count date'); return; }
    setSaving(true);
    try {
      const member = team.find(t => t.id === assignedTo);
      const header = await createPlannedCount({
        location: needsLocation ? location : null,
        date,
        itemGroup: needsCategory ? itemGroup : 'all',
        assignedTo: assignedTo === 'none' ? null : assignedTo,
        assignedToName: member?.name || null,
      });
      toast.success(`Planned count ${header.reference} created`);
      onCreated(header);
    } catch (err) {
      toast.error('Failed to create count: ' + (err.message || 'Unknown error'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-[60] flex items-center justify-center p-4">
      <div className="bg-card rounded-2xl border border-border w-full max-w-md shadow-xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <h3 className="text-lg font-bold flex items-center gap-2">
            <ClipboardCheck className="w-5 h-5 text-primary" /> New Planned Count
          </h3>
          <Button variant="ghost" size="icon" onClick={onCancel}><X className="w-5 h-5" /></Button>
        </div>

        <div className="px-6 py-4 space-y-4">
          {/* Count scope */}
          <div className="space-y-1.5">
            <Label className="text-xs">Count Scope</Label>
            <div className="grid grid-cols-3 gap-2">
              {SCOPES.map(s => (
                <button
                  key={s.key}
                  type="button"
                  onClick={() => setScope(s.key)}
                  className={`text-left rounded-lg border px-2.5 py-2 transition-colors ${
                    scope === s.key ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted'
                  }`}
                >
                  <p className="text-xs font-semibold">{s.label}</p>
                  <p className="text-[10px] text-muted-foreground leading-tight mt-0.5">{s.hint}</p>
                </button>
              ))}
            </div>
          </div>

          {needsLocation && (
            <div className="space-y-1">
              <Label className="text-xs">Stock Location *</Label>
              <Select value={locationId} onValueChange={setLocationId}>
                <SelectTrigger><SelectValue placeholder="Select location..." /></SelectTrigger>
                <SelectContent className="z-[70]">
                  {locations.map(l => <SelectItem key={l.id} value={l.id}>{l.name} ({l.code})</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Count Date *</Label>
              <Input type="date" value={date} onChange={e => setDate(e.target.value)} />
            </div>
            {needsCategory && (
              <div className="space-y-1">
                <Label className="text-xs">Category *</Label>
                <Select value={itemGroup === 'all' ? '' : itemGroup} onValueChange={setItemGroup}>
                  <SelectTrigger><SelectValue placeholder="Select category..." /></SelectTrigger>
                  <SelectContent className="z-[70]">
                    {itemGroups.map(g => <SelectItem key={g} value={g}>{g}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>

          <div className="space-y-1">
            <Label className="text-xs">Assign To (optional)</Label>
            <Select value={assignedTo} onValueChange={setAssignedTo}>
              <SelectTrigger><SelectValue placeholder="Unassigned" /></SelectTrigger>
              <SelectContent className="z-[70]">
                <SelectItem value="none">Unassigned</SelectItem>
                {team.map(t => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <p className="text-[11px] text-muted-foreground">
            {scope === 'category'
              ? 'A count line is created for the chosen category in every location it has stock. The floor counts each location; nothing posts until you review and post.'
              : 'A count line is created for every matching product with stock at the location. The floor counts the quantities; nothing posts until you review and post.'}
          </p>
        </div>

        <div className="px-6 py-4 border-t border-border flex gap-3">
          <Button variant="outline" className="flex-1" onClick={onCancel}>Cancel</Button>
          <Button className="flex-1 gap-2" onClick={handleCreate} disabled={saving || !locationId}>
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <ClipboardCheck className="w-4 h-4" />}
            {saving ? 'Creating...' : 'Create Count'}
          </Button>
        </div>
      </div>
    </div>
  );
}
