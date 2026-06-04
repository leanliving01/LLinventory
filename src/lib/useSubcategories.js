import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { getSubcategoriesForCategory } from '@/lib/productClassification';

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
    rows.forEach(r => {
      if (!r.product_type || !r.name) return;
      (byType[r.product_type] = byType[r.product_type] || []).push(r.name);
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

    return { subcatsByType: byType, getSubcategoriesForType };
  }, [rows]);
}
