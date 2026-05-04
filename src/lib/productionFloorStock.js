import { base44 } from '@/api/base44Client';

/**
 * Production Floor Stock helpers.
 * Manages StockOnHand records for the virtual "Production" location,
 * giving visibility into WIP ingredients on the floor.
 */

const PRODUCTION_LOCATION_ID = '__production_floor__';
const PRODUCTION_LOCATION_NAME = 'Production Floor';

/**
 * Increment (or create) a Production-floor SOH record for a product.
 */
export async function addToProductionFloor(productId, productSku, productName, qty, uom) {
  if (!qty || qty <= 0) return;

  const existing = await base44.entities.StockOnHand.filter({
    product_id: productId,
    location_id: PRODUCTION_LOCATION_ID,
  }, '-created_date', 1);

  if (existing.length > 0) {
    const soh = existing[0];
    const newQty = (soh.qty_on_hand || 0) + qty;
    await base44.entities.StockOnHand.update(soh.id, {
      qty_on_hand: newQty,
      qty_available: newQty,
      last_updated_at: new Date().toISOString(),
    });
  } else {
    await base44.entities.StockOnHand.create({
      product_id: productId,
      product_sku: productSku,
      product_name: productName,
      location_id: PRODUCTION_LOCATION_ID,
      location_name: PRODUCTION_LOCATION_NAME,
      qty_on_hand: qty,
      qty_committed: 0,
      qty_available: qty,
      uom: uom || 'kg',
      last_updated_at: new Date().toISOString(),
    });
  }
}

/**
 * Decrement a Production-floor SOH record for a product.
 */
export async function removeFromProductionFloor(productId, qty) {
  if (!qty || qty <= 0) return;

  const existing = await base44.entities.StockOnHand.filter({
    product_id: productId,
    location_id: PRODUCTION_LOCATION_ID,
  }, '-created_date', 1);

  if (existing.length > 0) {
    const soh = existing[0];
    const newQty = Math.max(0, (soh.qty_on_hand || 0) - qty);
    await base44.entities.StockOnHand.update(soh.id, {
      qty_on_hand: newQty,
      qty_available: newQty,
      last_updated_at: new Date().toISOString(),
    });
  }
}

/**
 * Clear all Production-floor SOH for a given pick list's released lines.
 * Called when a production run is completed or cancelled.
 */
export async function clearProductionFloorForRun(pickListId) {
  if (!pickListId) return;

  const pickLines = await base44.entities.PickLine.filter(
    { pick_list_id: pickListId, status: 'released' },
    'product_name', 500
  );

  const productIds = [...new Set(pickLines.map(pl => pl.product_id))];

  for (const productId of productIds) {
    const existing = await base44.entities.StockOnHand.filter({
      product_id: productId,
      location_id: PRODUCTION_LOCATION_ID,
    }, '-created_date', 1);

    if (existing.length > 0) {
      const soh = existing[0];
      // Find total released qty for this product in this pick list
      const totalReleased = pickLines
        .filter(pl => pl.product_id === productId)
        .reduce((sum, pl) => sum + (pl.actual_qty_picked || pl.required_qty || 0), 0);

      const newQty = Math.max(0, (soh.qty_on_hand || 0) - totalReleased);
      await base44.entities.StockOnHand.update(soh.id, {
        qty_on_hand: newQty,
        qty_available: newQty,
        last_updated_at: new Date().toISOString(),
      });
    }
  }
}