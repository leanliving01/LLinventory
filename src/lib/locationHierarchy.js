/**
 * Location hierarchy helpers — single source of truth for the two-level
 * Warehouse → Zone model.
 *
 * The `locations` table is self-referencing:
 *   - Warehouse = no `parent_location_id` and `type !== 'production'`
 *   - Zone      = has a `parent_location_id` pointing at its warehouse, plus a
 *                 storage `type` (ambient/chilled/frozen/packing/dispatch).
 *
 * A product's `default_location_id` stores the MOST-SPECIFIC location: the zone
 * id when a zone is chosen, otherwise the warehouse id. Warehouse is always
 * derivable from a zone via its `parent_location_id`.
 */

/** Is this location a warehouse (top-level, non-production)? */
export function isWarehouse(loc) {
  return !!loc && !loc.parent_location_id && loc.type !== 'production';
}

/** Is this location a zone (lives under a warehouse)? */
export function isZone(loc) {
  return !!loc && !!loc.parent_location_id;
}

/**
 * Split a flat locations array into warehouses + zones grouped by warehouse.
 * Mirrors the logic previously inline in WarehouseManager.
 * @returns {{ warehouses: object[], zonesByWarehouse: Record<string, object[]> }}
 */
export function splitLocations(locations = []) {
  const warehouses = locations.filter(isWarehouse);
  const zones = locations.filter(isZone);
  const zonesByWarehouse = {};
  warehouses.forEach(w => { zonesByWarehouse[w.id] = []; });
  zones.forEach(z => {
    if (zonesByWarehouse[z.parent_location_id]) {
      zonesByWarehouse[z.parent_location_id].push(z);
    }
  });
  Object.values(zonesByWarehouse).forEach(arr =>
    arr.sort((a, b) => (a.name || '').localeCompare(b.name || ''))
  );
  warehouses.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  return { warehouses, zonesByWarehouse };
}

/**
 * Resolve a stored `default_location_id` (which may be a warehouse OR a zone)
 * into its { warehouseId, zoneId } pair.
 * @returns {{ warehouseId: string, zoneId: string }} ids ('' when unset)
 */
export function resolveLocation(locationId, locations = []) {
  if (!locationId) return { warehouseId: '', zoneId: '' };
  const loc = locations.find(l => l.id === locationId);
  if (!loc) return { warehouseId: '', zoneId: '' };
  if (loc.parent_location_id) {
    return { warehouseId: loc.parent_location_id, zoneId: loc.id };
  }
  return { warehouseId: loc.id, zoneId: '' };
}

/**
 * Collapse a { warehouseId, zoneId } selection back into the single value to
 * store on `default_location_id` — the zone if set, else the warehouse.
 */
export function toStoredLocationId(warehouseId, zoneId) {
  return zoneId || warehouseId || '';
}

/**
 * The set of `location_id`s a stock count should aggregate for a given
 * Warehouse/Zone selection.
 *   - zone selected            → [zoneId]
 *   - warehouse only           → all stock-bearing zone ids under it, plus the
 *                                warehouse id itself if it is stock-bearing
 *   - nothing selected         → null  (= all locations / no filter)
 * @returns {string[] | null}
 */
export function getCountScopeIds(warehouseId, zoneId, locations = []) {
  if (zoneId) return [zoneId];
  if (!warehouseId) return null;
  const { zonesByWarehouse } = splitLocations(locations);
  const ids = (zonesByWarehouse[warehouseId] || [])
    .filter(z => z.is_stock_bearing)
    .map(z => z.id);
  const warehouse = locations.find(l => l.id === warehouseId);
  if (warehouse?.is_stock_bearing) ids.push(warehouse.id);
  return ids;
}

/**
 * Stock-bearing zones under a warehouse (used to decide whether a warehouse-level
 * count is ambiguous and must be narrowed to a specific zone before posting).
 */
export function stockBearingZones(warehouseId, locations = []) {
  const { zonesByWarehouse } = splitLocations(locations);
  return (zonesByWarehouse[warehouseId] || []).filter(z => z.is_stock_bearing);
}

/**
 * Display names for a stored `default_location_id`, resolved into its
 * warehouse and zone parts. Either may be '' when unset.
 * @returns {{ warehouse: string, zone: string }}
 */
export function locationLabels(locationId, locations = []) {
  const { warehouseId, zoneId } = resolveLocation(locationId, locations);
  const wh = locations.find(l => l.id === warehouseId);
  const z = locations.find(l => l.id === zoneId);
  return { warehouse: wh?.name || '', zone: z?.name || '' };
}
