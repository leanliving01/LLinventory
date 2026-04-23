/**
 * Bridges CommittedDemand (which references SKU entity IDs) to Product entities
 * used in the production planning page.
 *
 * CommittedDemand.sku_id → SKU.sku_code (e.g. "WLM-006") → Product.sku (e.g. "WLM6")
 *
 * Returns a map of Product ID → total committed quantity.
 */

/**
 * Normalize a SKU code from the SKU entity format to the Product entity format.
 * "WLM-006" → "WLM6", "MLM-015" → "MLM15", "MWL-001" → "MWL1"
 * Also handles descriptive MWL SKUs that don't follow the pattern.
 */
function normalizeSKUCode(skuCode) {
  if (!skuCode) return null;
  // Match pattern: PREFIX-NNN (e.g. WLM-006, MLM-015, MWL-001, LC-003)
  const match = skuCode.match(/^([A-Z]+)-(\d+)$/);
  if (match) {
    const prefix = match[1];
    const num = parseInt(match[2], 10); // strips leading zeros
    return `${prefix}${num}`;
  }
  // For descriptive SKUs (BYO meals), return as-is
  return skuCode;
}

/**
 * Build a map of Product.id → committed quantity from CommittedDemand + SKU + Product data.
 *
 * @param {Array} demandRecords - CommittedDemand entities
 * @param {Array} skuRecords - SKU entities
 * @param {Array} products - Product entities (finished_meals)
 * @returns {Object} { productId: committedQty }
 */
export function buildCommittedMap(demandRecords, skuRecords, products) {
  // Step 1: Build SKU ID → normalized product SKU
  const skuIdToProductSku = {};
  for (const sku of skuRecords) {
    const normalizedCode = normalizeSKUCode(sku.sku_code);
    if (normalizedCode) {
      skuIdToProductSku[sku.id] = normalizedCode;
    }
  }

  // Step 2: Build Product SKU → Product ID lookup
  const productSkuToId = {};
  for (const p of products) {
    if (p.sku) {
      productSkuToId[p.sku] = p.id;
    }
  }

  // Step 3: Aggregate demand → product ID
  const committedByProduct = {};
  for (const d of demandRecords) {
    const productSku = skuIdToProductSku[d.sku_id];
    if (!productSku) continue;
    const productId = productSkuToId[productSku];
    if (!productId) continue;
    committedByProduct[productId] = (committedByProduct[productId] || 0) + (d.quantity || 0);
  }

  return committedByProduct;
}