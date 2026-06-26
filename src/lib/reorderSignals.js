/**
 * Shared reorder / low-stock signal computation.
 *
 * Single source of truth for the severity + shortfall logic used by both the
 * Reorder Report (src/pages/ReorderReport.jsx) and the Inventory Dashboard's
 * reorder panel (src/components/inventory-dashboard/ReorderSignalsPanel.jsx).
 */

// Packages/bundles are produced/assembled on demand from component meals, so
// they hold no stock of their own — never raise reorder/shortage alerts for them.
export const isAssembledOnDemand = (p) => p.type === 'package' || p.type === 'bundle';

/**
 * Classify a single product's reorder state.
 * @returns { severity: 'critical'|'low'|'warning'|'ok', isBelow, shortfall }
 */
export function classifyReorder(product, onHand, reorderPoint) {
  const isBelow = !isAssembledOnDemand(product) && reorderPoint > 0 && onHand < reorderPoint;
  const shortfall = isBelow ? reorderPoint - onHand : 0;

  let severity = 'ok';
  if (isBelow) {
    if (onHand === 0) severity = 'critical';
    else if (reorderPoint > 0 && onHand / reorderPoint < 0.5) severity = 'low';
    else severity = 'warning';
  }
  return { severity, isBelow, shortfall };
}

/**
 * Build the full reorder item list (product + stock + supplier + severity).
 * Mirrors the original ReorderReport.allItems memo so both screens agree.
 */
export function buildReorderItems({ products = [], stockRecords = [], suppliers = [], supplierProducts = [] }) {
  return products.map((p) => {
    const stockRows = stockRecords.filter((s) => s.product_id === p.id);
    const totalOnHand = stockRows.reduce((sum, s) => sum + (s.qty_on_hand || 0), 0);
    const totalAvailable = stockRows.reduce((sum, s) => sum + (s.qty_available || 0), 0);
    const defaultSupplier = supplierProducts.find((sp) => sp.product_id === p.id && sp.is_default_supplier)
      || supplierProducts.find((sp) => sp.product_id === p.id);
    const legacySupplier = suppliers.find((s) => s.id === p.supplier_id);
    const reorderPoint = p.min_before_reorder || 0;

    const { severity, isBelow, shortfall } = classifyReorder(p, totalOnHand, reorderPoint);

    return {
      ...p,
      total_on_hand: totalOnHand,
      total_available: totalAvailable,
      shortfall,
      is_below: isBelow,
      severity,
      suggested_qty: p.reorder_qty || Math.max(shortfall, 0),
      supplier_name: defaultSupplier?.supplier_name || legacySupplier?.name || '—',
    };
  });
}

/** Severity sort order (critical first). */
export const SEVERITY_ORDER = { critical: 0, low: 1, warning: 2, ok: 3 };
