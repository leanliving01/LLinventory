/**
 * Packing snapshot metrics — what a packer physically packed for one order.
 *
 * Pure functions (no I/O) so they're easy to unit-test. Inputs come straight from
 * FloorPack's derived state:
 *   groups      – the grouped pack list (see FloorPack `groups`): array of
 *                 { groupKey: 'pkg-*' | 'orphan' | 'byo' | 'standalone', items: [...] }
 *                 where each item is { sku, skuLower, qty, ... }.
 *   skuTypeMap  – { skuLower: { type, sellable } } from FloorPack.
 *
 * Classification mirrors FloorPack's standalone grouping exactly:
 *   type 'supplement'                  -> supplement
 *   type 'sauce' AND sellable          -> supplement
 *   type 'finished_meal' / anything else (incl. unknown) -> meal
 * Package-group and BYO-group items are always meals (package meals / byo meals).
 */

export function classifyStandaloneItem(skuLower, skuTypeMap = {}) {
  const info = skuTypeMap[skuLower];
  if (info?.type === 'supplement') return 'supplement';
  if (info?.type === 'sauce' && info?.sellable) return 'supplement';
  return 'meal';
}

export function computePackedSnapshot(groups = [], skuTypeMap = {}) {
  let packed_items = 0;          // total units scanned (Σ qty across all items)
  let packed_line_count = 0;     // distinct line items packed
  let packed_package_meals = 0;  // meals from package groups (pkg-*/orphan)
  let packed_byo_meals = 0;      // meals from the build-your-own group
  let standalone_meals = 0;      // standalone lines classified as meals
  let packed_supplements = 0;    // standalone lines classified as supplements

  for (const g of groups) {
    const key = g?.groupKey || '';
    const isPackage = key.startsWith('pkg-') || key === 'orphan';
    const isByo = key === 'byo';
    for (const it of g?.items || []) {
      const qty = Number(it.qty) || 0;
      packed_items += qty;
      packed_line_count += 1;
      if (isPackage) {
        packed_package_meals += qty;
      } else if (isByo) {
        packed_byo_meals += qty;
      } else {
        const skuLower = it.skuLower || (it.sku || '').toLowerCase();
        if (classifyStandaloneItem(skuLower, skuTypeMap) === 'supplement') packed_supplements += qty;
        else standalone_meals += qty;
      }
    }
  }

  const packed_meals = packed_package_meals + packed_byo_meals + standalone_meals;
  return { packed_items, packed_line_count, packed_meals, packed_package_meals, packed_byo_meals, packed_supplements };
}
