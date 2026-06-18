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
import WarehouseZoneSelect from '@/components/shared/WarehouseZoneSelect';
import { resolveLocation, getCountScopeIds } from '@/lib/locationHierarchy';
import { CATEGORY_ORDER, CATEGORY_LABELS, SUBCATEGORIES_BY_CATEGORY } from '@/lib/productClassification';

const SCOPES = [
  { key: 'location', label: 'By Location', hint: 'One location, all categories' },
  { key: 'location_category', label: 'Location + Category', hint: 'One category in one location' },
  { key: 'category', label: 'By Category', hint: 'One category across every location' },
];

// All product types that make sense to count (exclude service)
const COUNTABLE_TYPES = CATEGORY_ORDER.filter(c => c !== 'service');

export default function CreatePlannedCountModal({ onCreated, onCancel }) {
  const [scope, setScope] = useState('location');
  const [locationValue, setLocationValue] = useState(''); // stored location id: zone id or warehouse id
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [itemGroup, setItemGroup] = useState('');       // product type key, e.g. 'finished_meal'
  const [subItemGroup, setSubItemGroup] = useState(''); // optional subcategory
  const [assignedTo, setAssignedTo] = useState('none');
  const [saving, setSaving] = useState(false);

  const needsLocation = scope !== 'category';
  const needsCategory = scope !== 'location';

  const isFormValid =
    !!date &&
    (!needsLocation || !!locationValue) &&
    (!needsCategory || !!itemGroup);

  const { data: locations = [] } = useQuery({
    queryKey: ['locations-all'],
    queryFn: () => base44.entities.Location.list('name', 200),
  });

  const { data: team = [] } = useQuery({
    queryKey: ['team-members-active'],
    queryFn: () => base44.entities.TeamMember.filter({ is_active: true }, 'name', 200),
  });

  const subCategories = useMemo(() => {
    if (!itemGroup) return [];
    return SUBCATEGORIES_BY_CATEGORY[itemGroup] || [];
  }, [itemGroup]);

  const handleScopeChange = (newScope) => {
    setScope(newScope);
    if (newScope === 'category') setLocationValue('');
    if (newScope === 'location') { setItemGroup(''); setSubItemGroup(''); }
  };

  const handleItemGroupChange = (val) => {
    setItemGroup(val);
    setSubItemGroup('');
  };

  const handleCreate = async () => {
    const location = needsLocation ? locations.find(l => l.id === locationValue) : null;
    if (needsLocation && !location) { toast.error('Select a location'); return; }
    if (needsCategory && !itemGroup) { toast.error('Select a category'); return; }
    if (!date) { toast.error('Select a count date'); return; }

    setSaving(true);
    try {
      const member = team.find(t => t.id === assignedTo);

      // Expand warehouse → all its stock-bearing zone ids for SOH filtering.
      let locationScopeIds = null;
      if (needsLocation && location) {
        const { warehouseId, zoneId } = resolveLocation(locationValue, locations);
        locationScopeIds = getCountScopeIds(warehouseId || locationValue, zoneId || '', locations);
        // Fallback: if no scope ids resolved, use the location itself.
        if (!locationScopeIds || locationScopeIds.length === 0) {
          locationScopeIds = [location.id];
        }
      }

      const header = await createPlannedCount({
        location: needsLocation ? location : null,
        locationScopeIds,
        date,
        itemGroup: needsCategory ? itemGroup : 'all',
        subItemGroup: subItemGroup || null,
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
                  onClick={() => handleScopeChange(s.key)}
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

          {/* Location — warehouse required, zone optional */}
          {needsLocation && (
            <div className="space-y-1">
              <Label className="text-xs">Stock Location *</Label>
              <WarehouseZoneSelect
                value={locationValue}
                onChange={setLocationValue}
                locations={locations}
                triggerClassName="h-9"
              />
              <p className="text-[10px] text-muted-foreground">
                Select a warehouse to count all its zones, or pick a specific zone to narrow the count.
              </p>
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
                <Select value={itemGroup || ''} onValueChange={handleItemGroupChange}>
                  <SelectTrigger><SelectValue placeholder="Select category..." /></SelectTrigger>
                  <SelectContent className="z-[70]">
                    {COUNTABLE_TYPES.map(t => (
                      <SelectItem key={t} value={t}>{CATEGORY_LABELS[t]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>

          {/* Optional subcategory — only when a category is selected and has subs */}
          {needsCategory && subCategories.length > 0 && (
            <div className="space-y-1">
              <Label className="text-xs">Subcategory <span className="text-muted-foreground">(optional)</span></Label>
              <Select value={subItemGroup || 'all'} onValueChange={v => setSubItemGroup(v === 'all' ? '' : v)}>
                <SelectTrigger><SelectValue placeholder="All subcategories" /></SelectTrigger>
                <SelectContent className="z-[70]">
                  <SelectItem value="all">All subcategories</SelectItem>
                  {subCategories.map(s => (
                    <SelectItem key={s} value={s}>{s}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

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
          <Button className="flex-1 gap-2" onClick={handleCreate} disabled={saving || !isFormValid}>
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <ClipboardCheck className="w-4 h-4" />}
            {saving ? 'Creating...' : 'Create Count'}
          </Button>
        </div>
      </div>
    </div>
  );
}
