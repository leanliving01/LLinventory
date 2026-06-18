import React, { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { X, Loader2, ClipboardCheck, Check } from 'lucide-react';
import { toast } from 'sonner';
import { createPlannedCount } from '@/lib/stockCount';
import { splitLocations, getCountScopeIds } from '@/lib/locationHierarchy';
import { CATEGORY_ORDER, CATEGORY_LABELS, SUBCATEGORIES_BY_CATEGORY } from '@/lib/productClassification';
import { cn } from '@/lib/utils';

const SCOPES = [
  { key: 'location',          label: 'By Location',          hint: 'One location, all categories' },
  { key: 'location_category', label: 'Location + Category',  hint: 'One category in one location' },
  { key: 'category',          label: 'By Category',          hint: 'One category across every location' },
];

const COUNTABLE_TYPES = CATEGORY_ORDER.filter(c => c !== 'service');

function ToggleChip({ label, selected, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium border transition-colors',
        selected
          ? 'border-primary bg-primary/10 text-primary'
          : 'border-border text-muted-foreground hover:border-primary/40 hover:text-foreground'
      )}
    >
      {selected && <Check className="w-3 h-3" />}
      {label}
    </button>
  );
}

export default function CreatePlannedCountModal({ onCreated, onCancel }) {
  const [scope, setScope] = useState('location');
  const [countName, setCountName] = useState('');
  const [warehouseId, setWarehouseId] = useState('');
  const [selectedZoneIds, setSelectedZoneIds] = useState([]); // empty = all zones
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [itemGroup, setItemGroup] = useState('');
  const [selectedSubcategories, setSelectedSubcategories] = useState([]); // empty = all subcategories
  const [assignedTo, setAssignedTo] = useState('none');
  const [saving, setSaving] = useState(false);

  const needsLocation = scope !== 'category';
  const needsCategory = scope !== 'location';

  const isFormValid =
    !!date &&
    (!needsLocation || !!warehouseId) &&
    (!needsCategory || !!itemGroup);

  const { data: locations = [] } = useQuery({
    queryKey: ['locations-all'],
    queryFn: () => base44.entities.Location.list('name', 200),
  });

  const { data: team = [] } = useQuery({
    queryKey: ['team-members-active'],
    queryFn: () => base44.entities.TeamMember.filter({ is_active: true }, 'name', 200),
  });

  const { warehouses, zonesByWarehouse } = useMemo(() => splitLocations(locations), [locations]);
  const zonesForWarehouse = warehouseId ? (zonesByWarehouse[warehouseId] || []) : [];

  const subCategories = useMemo(() => {
    if (!itemGroup) return [];
    return SUBCATEGORIES_BY_CATEGORY[itemGroup] || [];
  }, [itemGroup]);

  const handleScopeChange = (newScope) => {
    setScope(newScope);
    if (newScope === 'category') { setWarehouseId(''); setSelectedZoneIds([]); }
    if (newScope === 'location') { setItemGroup(''); setSelectedSubcategories([]); }
  };

  const handleWarehouseChange = (wId) => {
    setWarehouseId(wId === '__none__' ? '' : wId);
    setSelectedZoneIds([]);
  };

  const toggleZone = (zoneId) => {
    setSelectedZoneIds(prev =>
      prev.includes(zoneId) ? prev.filter(id => id !== zoneId) : [...prev, zoneId]
    );
  };

  const handleItemGroupChange = (val) => {
    setItemGroup(val);
    setSelectedSubcategories([]);
  };

  const toggleSubcategory = (sub) => {
    setSelectedSubcategories(prev =>
      prev.includes(sub) ? prev.filter(s => s !== sub) : [...prev, sub]
    );
  };

  const handleCreate = async () => {
    const warehouse = needsLocation ? locations.find(l => l.id === warehouseId) : null;
    if (needsLocation && !warehouse) { toast.error('Select a warehouse'); return; }
    if (needsCategory && !itemGroup) { toast.error('Select a category'); return; }
    if (!date) { toast.error('Select a count date'); return; }

    setSaving(true);
    try {
      const member = team.find(t => t.id === assignedTo);

      // Scope ids: use the explicitly selected zones, or expand the whole warehouse.
      let locationScopeIds = null;
      if (needsLocation && warehouse) {
        if (selectedZoneIds.length > 0) {
          locationScopeIds = selectedZoneIds;
        } else {
          locationScopeIds = getCountScopeIds(warehouseId, '', locations);
          if (!locationScopeIds || locationScopeIds.length === 0) locationScopeIds = [warehouseId];
        }
      }

      const header = await createPlannedCount({
        location: needsLocation ? warehouse : null,
        locationScopeIds,
        date,
        countName: countName.trim() || null,
        itemGroup: needsCategory ? itemGroup : 'all',
        subItemGroups: selectedSubcategories.length > 0 ? selectedSubcategories : null,
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
      <div className="bg-card rounded-2xl border border-border w-full max-w-md shadow-xl flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border shrink-0">
          <h3 className="text-lg font-bold flex items-center gap-2">
            <ClipboardCheck className="w-5 h-5 text-primary" /> New Planned Count
          </h3>
          <Button variant="ghost" size="icon" onClick={onCancel}><X className="w-5 h-5" /></Button>
        </div>

        {/* Body — scrollable */}
        <div className="px-6 py-4 space-y-4 overflow-y-auto">

          {/* Count scope */}
          <div className="space-y-1.5">
            <Label className="text-xs">Count Scope</Label>
            <div className="grid grid-cols-3 gap-2">
              {SCOPES.map(s => (
                <button
                  key={s.key}
                  type="button"
                  onClick={() => handleScopeChange(s.key)}
                  className={cn(
                    'text-left rounded-lg border px-2.5 py-2 transition-colors',
                    scope === s.key ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted'
                  )}
                >
                  <p className="text-xs font-semibold">{s.label}</p>
                  <p className="text-[10px] text-muted-foreground leading-tight mt-0.5">{s.hint}</p>
                </button>
              ))}
            </div>
          </div>

          {/* Optional name */}
          <div className="space-y-1">
            <Label className="text-xs">Count Name <span className="text-muted-foreground">(optional)</span></Label>
            <Input
              placeholder="e.g. Month-end — BE Chilled"
              value={countName}
              onChange={e => setCountName(e.target.value)}
            />
          </div>

          {/* Location — warehouse select + multi-zone chips */}
          {needsLocation && (
            <div className="space-y-2">
              <div className="space-y-1">
                <Label className="text-xs">Warehouse *</Label>
                <Select value={warehouseId || '__none__'} onValueChange={handleWarehouseChange}>
                  <SelectTrigger className="h-9"><SelectValue placeholder="Select warehouse..." /></SelectTrigger>
                  <SelectContent className="z-[70]">
                    <SelectItem value="__none__">— Select warehouse —</SelectItem>
                    {warehouses.map(w => (
                      <SelectItem key={w.id} value={w.id}>{w.name}{w.code ? ` (${w.code})` : ''}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {warehouseId && zonesForWarehouse.length > 0 && (
                <div className="space-y-1.5">
                  <Label className="text-xs">
                    Zones <span className="text-muted-foreground">(optional — leave blank to count all zones)</span>
                  </Label>
                  <div className="flex flex-wrap gap-1.5">
                    {zonesForWarehouse.map(z => (
                      <ToggleChip
                        key={z.id}
                        label={z.name}
                        selected={selectedZoneIds.includes(z.id)}
                        onClick={() => toggleZone(z.id)}
                      />
                    ))}
                  </div>
                  {selectedZoneIds.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setSelectedZoneIds([])}
                      className="text-[10px] text-muted-foreground hover:text-foreground underline"
                    >
                      Clear selection (count all zones)
                    </button>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Date + Category row */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Count Date *</Label>
              <Input type="date" value={date} onChange={e => setDate(e.target.value)} />
            </div>
            {needsCategory && (
              <div className="space-y-1">
                <Label className="text-xs">Category *</Label>
                <Select value={itemGroup || ''} onValueChange={handleItemGroupChange}>
                  <SelectTrigger className="h-9"><SelectValue placeholder="Select category..." /></SelectTrigger>
                  <SelectContent className="z-[70]">
                    {COUNTABLE_TYPES.map(t => (
                      <SelectItem key={t} value={t}>{CATEGORY_LABELS[t]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>

          {/* Subcategory chips — multi-select */}
          {needsCategory && subCategories.length > 0 && (
            <div className="space-y-1.5">
              <Label className="text-xs">
                Subcategories <span className="text-muted-foreground">(optional — leave blank to count all)</span>
              </Label>
              <div className="flex flex-wrap gap-1.5">
                {subCategories.map(s => (
                  <ToggleChip
                    key={s}
                    label={s}
                    selected={selectedSubcategories.includes(s)}
                    onClick={() => toggleSubcategory(s)}
                  />
                ))}
              </div>
              {selectedSubcategories.length > 0 && (
                <button
                  type="button"
                  onClick={() => setSelectedSubcategories([])}
                  className="text-[10px] text-muted-foreground hover:text-foreground underline"
                >
                  Clear selection (count all subcategories)
                </button>
              )}
            </div>
          )}

          {/* Assign to */}
          <div className="space-y-1">
            <Label className="text-xs">Assign To <span className="text-muted-foreground">(optional)</span></Label>
            <Select value={assignedTo} onValueChange={setAssignedTo}>
              <SelectTrigger className="h-9"><SelectValue placeholder="Unassigned" /></SelectTrigger>
              <SelectContent className="z-[70]">
                <SelectItem value="none">Unassigned</SelectItem>
                {team.map(t => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <p className="text-[11px] text-muted-foreground">
            {scope === 'category'
              ? 'Lines are created for the chosen category across every location that has stock. Nothing posts until you review and post.'
              : 'Lines are created for every matching product with stock in the selected location. Nothing posts until you review and post.'}
          </p>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-border flex gap-3 shrink-0">
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
