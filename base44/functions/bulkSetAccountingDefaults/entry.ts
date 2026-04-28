import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * Bulk-update all active products with correct Xero accounting defaults.
 *
 * Mapping (Lean Living, SA food business):
 *   COGS Account:      5000 (Cost of Goods Sold)
 *   Inventory Account:  6300 (Inventory)
 *   Revenue Account:    1000 (Shopify sales) — only for sellable types
 *   Purchase Tax Rule:  "Zero Rate Purchases" for food raw materials,
 *                       "Standard Rate Purchases" for packaging/non-food
 *   Sale Tax Rule:      "Output Tax on Income" — only for sellable types
 */

const SELLABLE_TYPES = new Set(['finished_meal', 'supplement', 'package', 'bundle', 'solo_serve']);

// Food raw materials are zero-rated in SA; packaging & non-food are standard-rated
const ZERO_RATED_TYPES = new Set(['raw', 'wip_bulk', 'finished_meal', 'sauce']);

function getAccountingDefaults(product) {
  const type = product.type || 'raw';
  const isSellable = SELLABLE_TYPES.has(type);
  const isZeroRatedPurchase = ZERO_RATED_TYPES.has(type);

  return {
    cogs_account: '5000',
    inventory_account: '6300',
    revenue_account: isSellable ? '1000' : null,
    purchase_tax_rule: isZeroRatedPurchase ? 'Zero Rate Purchases' : 'Standard Rate Purchases',
    sale_tax_rule: isSellable ? 'Output Tax on Income' : null,
    sellable: isSellable,
    purchasable: !SELLABLE_TYPES.has(type) || type === 'supplement',
  };
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Admin access required' }, { status: 403 });
    }

    const { dryRun, startFrom = 0, batchLimit = 50 } = await req.json();

    // Fetch all active products in batches
    let allProducts = [];
    let offset = 0;
    const batchSize = 200;
    while (true) {
      const batch = await base44.asServiceRole.entities.Product.filter(
        { status: 'active' }, 'sku', batchSize, offset
      );
      allProducts = allProducts.concat(batch);
      if (batch.length < batchSize) break;
      offset += batchSize;
    }

    console.log(`Found ${allProducts.length} active products, starting from index ${startFrom}, limit ${batchLimit}`);

    // Slice to process only a batch
    const batch = allProducts.slice(startFrom, startFrom + batchLimit);

    let updated = 0;
    let skipped = 0;
    const changes = [];

    for (const product of batch) {
      const defaults = getAccountingDefaults(product);

      // Check if any field needs updating
      const needsUpdate =
        product.cogs_account !== defaults.cogs_account ||
        product.inventory_account !== defaults.inventory_account ||
        product.revenue_account !== defaults.revenue_account ||
        product.purchase_tax_rule !== defaults.purchase_tax_rule ||
        product.sale_tax_rule !== defaults.sale_tax_rule;

      if (!needsUpdate) {
        skipped++;
        continue;
      }

      changes.push({
        sku: product.sku,
        name: product.name,
        type: product.type,
        before: {
          cogs_account: product.cogs_account,
          inventory_account: product.inventory_account,
          revenue_account: product.revenue_account,
          purchase_tax_rule: product.purchase_tax_rule,
          sale_tax_rule: product.sale_tax_rule,
        },
        after: defaults,
      });

      if (!dryRun) {
        await base44.asServiceRole.entities.Product.update(product.id, defaults);
        // Throttle to avoid rate limits — small pause every 10 updates
        if (updated % 10 === 0) {
          await new Promise(r => setTimeout(r, 500));
        }
      }
      updated++;
    }

    return Response.json({
      total: allProducts.length,
      batchProcessed: batch.length,
      updated,
      skipped,
      dryRun: !!dryRun,
      nextStartFrom: startFrom + batchLimit,
      done: startFrom + batchLimit >= allProducts.length,
      sampleChanges: changes.slice(0, 10),
    });
  } catch (error) {
    console.error('bulkSetAccountingDefaults error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});