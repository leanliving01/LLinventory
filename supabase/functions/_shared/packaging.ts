// ============================================================================
// packaging.ts
// Data-driven package detection for order import.
//
// A sellable package/bundle order line must explode into its component meals for
// committed-stock, demand and fulfilment deduction. Which SKUs are packages is
// sourced from the pack_boms explosion map (active rows) — which is itself
// auto-synced from each package's packing BOM (migration 061). This replaces the
// brittle hardcoded title-keyword heuristic (detectLineType) as the source of
// truth for is_package_parent: add a package's pack_boms row and its orders
// explode automatically, no matter what the Shopify line title says.
//
// Imported by sync-shopify-orders, shopify-webhook-handler, shopify-history-import.
// ============================================================================

import { getSupabase } from './shopify.ts';

type SB = ReturnType<typeof getSupabase>;

export async function loadPackageSkus(supabase: SB): Promise<Set<string>> {
  const set = new Set<string>();
  const { data, error } = await supabase
    .from('pack_boms')
    .select('package_sku')
    .eq('active', true);
  if (error) {
    console.error('loadPackageSkus error:', error.message);
    return set;
  }
  for (const r of data || []) {
    if (r.package_sku) set.add(String(r.package_sku).toUpperCase());
  }
  return set;
}

// True when this SKU is a known sellable package (case-insensitive).
export function isPackageSku(sku: string | null | undefined, packageSkus: Set<string>): boolean {
  return !!sku && packageSkus.has(String(sku).toUpperCase());
}
