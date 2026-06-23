import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { getSubcategoriesForCategory, resolveSubcategoryColor } from '@/lib/productClassification';
import { getSubcategories as getStaticBomSubcategories } from '@/lib/bomSubcategories';

/**
 * Loads the user-managed subcategories (Settings → Categories) and exposes
 * helpers to use them on the Products page. Falls back to the canonical
 * hardcoded defaults so nothing breaks before the tables are seeded.
 *
 * Shares the ['product-subcategories'] query key with the Settings tab, so a
 * subcategory added there shows up here as soon as the cache invalidates.
 */
export function useSubcategories() {
  const { data: rows = [] } = useQuery({
    queryKey: ['product-subcategories'],
    queryFn: () => base44.entities.ProductSubcategory.filter({ is_active: true }, 'sort_order', 1000),
    staleTime: 60_000,
  });

  return useMemo(() => {
    const byType = {};
    const colorByName = {}; // lowercased subcategory name → stored hex
    rows.forEach(r => {
      if (!r.product_type || !r.name) return;
      (byType[r.product_type] = byType[r.product_type] || []).push(r.name);
      if (r.color) colorByName[r.name.toLowerCase()] = r.color;
    });

    // DB names first (in their sort order), then any hardcoded defaults not
    // already present — deduped case-insensitively.
    const getSubcategoriesForType = (type) => {
      const merged = [...(byType[type] || []), ...(getSubcategoriesForCategory(type) || [])];
      const seen = new Set();
      const out = [];
      for (const name of merged) {
        const k = (name || '').toLowerCase();
        if (!k || seen.has(k)) continue;
        seen.add(k);
        out.push(name);
      }
      return out;
    };

    // Resolved display hex for a subcategory: stored colour → keyword default →
    // null (caller keeps its own fallback when null).
    const getSubcategoryHex = (name) => resolveSubcategoryColor(name, colorByName);

    return { rows, subcatsByType: byType, colorByName, getSubcategoriesForType, getSubcategoryHex };
  }, [rows]);
}

/**
 * Subcategory options for the BOM "Subcategory" chips, per BOM layer.
 *
 * The Packing (pack) layer is DB-driven: a packing BOM packs finished meals of a
 * given range into a box, so its options ARE the catalog's managed meal ranges
 * (finished_meal subcategories — already incl. "Winter Warmer Range" and
 * editable in Settings → Categories), unioned with the generic pack kinds so
 * nothing previously selectable is lost. Adding a range in Settings flows
 * through here automatically. prep/cook/portion keep their static lists.
 *
 * Returns a `(bomType) => string[]` selector. Call the hook at component top
 * level, then invoke the returned function during render.
 */
export function useBomSubcategories() {
  const { getSubcategoriesForType } = useSubcategories();
  return (bomType) => {
    if (bomType !== 'pack') return getStaticBomSubcategories(bomType);
    const merged = [
      ...getSubcategoriesForType('finished_meal'),
      ...getStaticBomSubcategories('pack'),
    ];
    const seen = new Set();
    const out = [];
    for (const name of merged) {
      const k = (name || '').toLowerCase();
      if (!k || seen.has(k)) continue;
      seen.add(k);
      out.push(name);
    }
    return out;
  };
}
