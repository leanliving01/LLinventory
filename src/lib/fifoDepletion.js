import { base44 } from '@/api/base44Client';

/**
 * Deplete CostLayers in FIFO order (oldest received_date first) for a product.
 *
 * Returns the blended cost per stock unit consumed.
 * If layers run out before qtyToConsume is satisfied, the remainder is valued at 0
 * (stock shortage — caller should handle).
 *
 * @param {string} productId
 * @param {number} qtyToConsume  in stock UOM units
 * @returns {Promise<{ blendedCost: number, qtyFulfilled: number, qtyUnfulfilled: number }>}
 */
export async function depleteStock(productId, qtyToConsume) {
  if (!productId || qtyToConsume <= 0) {
    return { blendedCost: 0, qtyFulfilled: 0, qtyUnfulfilled: qtyToConsume };
  }

  // Load undepleted layers for this product, oldest first
  const layers = await base44.entities.CostLayer.filter(
    { product_id: productId, is_depleted: false },
    'received_date',
    500,
  );

  let remaining = qtyToConsume;
  let totalCost = 0;
  let qtyFulfilled = 0;

  for (const layer of layers) {
    if (remaining <= 0) break;

    const available = layer.qty_remaining || 0;
    if (available <= 0) continue;

    const consumed = Math.min(available, remaining);
    totalCost += consumed * (layer.cost_per_stock_uom || 0);
    qtyFulfilled += consumed;
    remaining -= consumed;

    const newRemaining = Math.round((available - consumed) * 10000) / 10000;
    const isDepleted = newRemaining <= 0.00001;

    await base44.entities.CostLayer.update(layer.id, {
      qty_remaining: newRemaining,
      is_depleted: isDepleted,
    });
  }

  const blendedCost = qtyFulfilled > 0 ? Math.round((totalCost / qtyFulfilled) * 10000) / 10000 : 0;

  return {
    blendedCost,
    qtyFulfilled,
    qtyUnfulfilled: Math.max(0, remaining),
  };
}
