/**
 * FIFO stock valuation — the authoritative cost basis for this app.
 *
 * Every product is costed FIFO (costing_method='fifo', migration 001), so the real
 * value of stock on hand is the sum of its non-depleted cost layers
 * (qty_remaining × cost_per_stock_uom), NOT products.cost_avg (a legacy weighted
 * average that drifts from the FIFO truth). Use this so every valuation report
 * (Inventory, Stock Valuation, Stock Age, Dead Stock) agrees on cost basis.
 *
 * @param layers cost_layers rows (ideally already filtered to is_depleted=false)
 * @returns { [product_id]: { qty, value } } aggregated across layers
 */
export function buildFifoCostMap(layers = []) {
  const agg = {};
  for (const l of layers) {
    if (l.is_depleted) continue;
    const q = l.qty_remaining || 0;
    if (q <= 0) continue;
    const a = agg[l.product_id] || (agg[l.product_id] = { qty: 0, value: 0 });
    a.qty += q;
    a.value += q * (l.cost_per_stock_uom || 0);
  }
  return agg;
}

/**
 * Per-product FIFO unit cost (weighted across remaining layers). Falls back to the
 * supplied value (e.g. products.cost_avg) when a product has no FIFO layers.
 */
export function fifoUnitCost(fifoMap, productId, fallback = 0) {
  const a = fifoMap[productId];
  return a && a.qty > 0 ? a.value / a.qty : fallback;
}
