import React from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { splitLocations, resolveLocation, toStoredLocationId } from '@/lib/locationHierarchy';

/**
 * Cascading Warehouse → Zone picker over the flat `locations` list.
 *
 * `value` is the stored `default_location_id` (a warehouse id, or a zone id when
 * a specific zone is chosen). `onChange` receives the new stored id ('' = unset).
 */
export default function WarehouseZoneSelect({ value, onChange, locations = [], className = '', triggerClassName = 'h-9' }) {
  const { warehouses, zonesByWarehouse } = splitLocations(locations);
  const { warehouseId, zoneId } = resolveLocation(value, locations);
  const zones = warehouseId ? (zonesByWarehouse[warehouseId] || []) : [];

  const setWarehouse = (whId) => onChange(toStoredLocationId(whId, ''));
  const setZone = (zId) => onChange(toStoredLocationId(warehouseId, zId));

  return (
    <div className={`grid grid-cols-1 sm:grid-cols-2 gap-3 ${className}`}>
      <div className="space-y-1">
        <label className="text-xs font-medium text-muted-foreground">Warehouse</label>
        <Select value={warehouseId || 'none'} onValueChange={v => setWarehouse(v === 'none' ? '' : v)}>
          <SelectTrigger className={triggerClassName}><SelectValue placeholder="Select warehouse" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="none">— None —</SelectItem>
            {warehouses.map(w => <SelectItem key={w.id} value={w.id}>{w.name} ({w.code})</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1">
        <label className="text-xs font-medium text-muted-foreground">Zone</label>
        <Select value={zoneId || 'none'} onValueChange={v => setZone(v === 'none' ? '' : v)} disabled={!warehouseId || zones.length === 0}>
          <SelectTrigger className={triggerClassName}>
            <SelectValue placeholder={!warehouseId ? 'Select a warehouse first' : zones.length === 0 ? 'No zones' : 'No specific zone'} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">— No specific zone —</SelectItem>
            {zones.map(z => <SelectItem key={z.id} value={z.id}>{z.name} ({z.code})</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
