import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/api/supabaseClient';

/**
 * Canonical current-stock source for the WHOLE app.
 *
 * Why this exists: `StockOnHand.list(...)` goes through PostgREST, which silently
 * caps every response at 1000 rows. stock_on_hand has one row PER product PER
 * location (≈1700+ rows), so any client-side aggregation over `.list()` drops the
 * tail of the table — and because callers sort by product_sku, late-alphabet SKUs
 * (WLM/WWL/WWR meals…) fall past row 1000 and silently read 0 on hand.
 *
 * The `production_stock_levels()` RPC (migration 101) sums stock_on_hand across all
 * locations server-side and returns ONE row per product (≈480 rows) — never
 * truncated. This hook is the single source of truth; every surface that needs
 * "current on hand / committed / available per product" should use it instead of
 * rolling its own capped `.list()` aggregation.
 *
 * Returns:
 *  - stockByProduct: { [product_id]: { on_hand, committed, available } }
 *  - rows:           raw RPC rows
 *  - isLoading, refetch
 */
export function useStockLevels(options = {}) {
  const query = useQuery({
    queryKey: ['stock-levels'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('production_stock_levels');
      if (error) {
        console.error('[stock-levels] production_stock_levels RPC:', error.message);
        return [];
      }
      return data || [];
    },
    staleTime: 30_000,
    ...options,
  });

  const stockByProduct = useMemo(() => {
    const map = {};
    for (const s of query.data || []) {
      map[s.product_id] = {
        on_hand: Number(s.qty_on_hand) || 0,
        committed: Number(s.qty_committed) || 0,
        available: Number(s.qty_available) || 0,
      };
    }
    return map;
  }, [query.data]);

  return {
    stockByProduct,
    rows: query.data || [],
    isLoading: query.isLoading,
    refetch: query.refetch,
  };
}

/** Query key for invalidating the canonical stock-levels cache after stock changes. */
export const STOCK_LEVELS_QUERY_KEY = ['stock-levels'];
