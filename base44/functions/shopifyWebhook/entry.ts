import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

// ─── Exclusion logic: skip non-meal items ───
function isExcluded(lineItem) {
  const title = (lineItem.title || '').toLowerCase();
  const sku = (lineItem.sku || '').toLowerCase();
  if (title.includes('supplement')) return true;
  if (title.includes('low calorie sauce') || title.includes('sauce')) return true;
  if (title.includes('90-day reset') || title.includes('90 day reset')) return true;
  if (sku === 'l90c2') return true;
  if (title.includes('dry ice') || title.includes('cooler box') || title.includes('delivery')) return true;
  if (title.includes('snack') && !title.includes('meal')) return true;
  return false;
}

function isBYOItem(lineItem, orderTags, byoProductIds) {
  const title = (lineItem.title || '').toLowerCase();
  const tags = (orderTags || '').toLowerCase();
  const tagList = tags.split(',').map(t => t.trim());
  const productId = String(lineItem.product_id || '');
  if (byoProductIds.has(productId)) return true;
  return title.includes('build your own') || title.includes('byo') || tagList.includes('byo meals') || tagList.includes('byo');
}

function parseOrder(order, byoProductIds, packageLookup) {
  const orderTags = order.tags || '';
  let mwlMeals = 0, mlmMeals = 0, wwlMeals = 0, wlmMeals = 0, lcMeals = 0, byoMeals = 0, totalMeals = 0;
  let orderIsByo = false;

  for (const li of (order.line_items || [])) {
    const qty = li.quantity || 0;
    if (isExcluded(li)) continue;
    if (isBYOItem(li, orderTags, byoProductIds)) {
      orderIsByo = true;
      byoMeals += qty;
      totalMeals += qty;
      continue;
    }

    const variantId = String(li.variant_id || '');
    const productId = String(li.product_id || '');
    
    let matched = packageLookup.byVariant[variantId];
    if (!matched && packageLookup.byProduct[productId]) {
      const lineSku = (li.sku || '').toLowerCase();
      matched = packageLookup.byProduct[productId].find(p => 
        p.shopify_sku && p.shopify_sku.toLowerCase() === lineSku
      );
    }

    if (matched) {
      const mealCount = matched.pack_size * qty;
      totalMeals += mealCount;
      switch (matched.package_family) {
        case 'MWL': mwlMeals += mealCount; break;
        case 'MLM': mlmMeals += mealCount; break;
        case 'WWL': wwlMeals += mealCount; break;
        case 'WLM': wlmMeals += mealCount; break;
        case 'LOW_CARB': lcMeals += mealCount; break;
      }
    }
  }

  return {
    shopify_order_id: String(order.id),
    order_number: order.name || `#${order.order_number}`,
    order_date: order.created_at,
    customer_name: order.customer ? `${order.customer.first_name || ''} ${order.customer.last_name || ''}`.trim() : '',
    paid_status: mapFinancialStatus(order.financial_status),
    fulfilment_status: mapFulfillmentStatus(order.fulfillment_status),
    tags: orderTags,
    synced_at: new Date().toISOString(),
    total_meals: totalMeals,
    mwl_meals: mwlMeals,
    mlm_meals: mlmMeals,
    wwl_meals: wwlMeals,
    wlm_meals: wlmMeals,
    lc_meals: lcMeals,
    byo_meals: byoMeals,
    is_byo: orderIsByo,
    demand_calculated: false,
  };
}

function mapFinancialStatus(status) {
  const map = { paid: 'paid', pending: 'unpaid', partially_paid: 'partially_paid', refunded: 'refunded' };
  return map[status] || 'unpaid';
}

function mapFulfillmentStatus(status) {
  if (!status || status === 'null') return 'unfulfilled';
  const map = { fulfilled: 'fulfilled', partial: 'partial', restocked: 'restocked' };
  return map[status] || 'unfulfilled';
}

function buildPackageLookup(packages) {
  const byVariant = {};
  const byProduct = {};
  for (const p of packages) {
    if (p.is_active === false) continue;
    if (p.shopify_variant_id) byVariant[p.shopify_variant_id] = p;
    if (p.shopify_product_id) {
      if (!byProduct[p.shopify_product_id]) byProduct[p.shopify_product_id] = [];
      byProduct[p.shopify_product_id].push(p);
    }
  }
  return { byVariant, byProduct };
}

Deno.serve(async (req) => {
  // Only accept POST
  if (req.method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 });
  }

  const base44 = createClientFromRequest(req);

  try {
    const order = await req.json();
    
    if (!order || !order.id) {
      console.warn('[Webhook] Received payload without order ID, ignoring');
      return Response.json({ ok: true, skipped: true });
    }

    console.log(`[Webhook] Processing order ${order.name || order.id}`);

    // Load package master data for meal counting
    const packages = await base44.asServiceRole.entities.PackageProduct.filter({});
    const packageLookup = buildPackageLookup(packages);

    // Load BYO product IDs from Setting (cached) or default to tag-based detection
    const byoProductIds = new Set();
    // We use tag-based BYO detection from the order itself (no extra API call needed)

    // Parse the order
    const parsed = parseOrder(order, byoProductIds, packageLookup);

    // Check if order already exists
    const existing = await base44.asServiceRole.entities.ShopifyOrder.filter({ shopify_order_id: parsed.shopify_order_id });

    if (existing.length > 0) {
      // Update existing order
      const ex = existing[0];
      const { shopify_order_id, order_number, order_date, ...updateData } = parsed;
      await base44.asServiceRole.entities.ShopifyOrder.update(ex.id, updateData);
      console.log(`[Webhook] Updated order ${parsed.order_number} (${parsed.total_meals} meals)`);

      await base44.asServiceRole.entities.AuditLog.create({
        action: 'sync',
        entity_type: 'ShopifyOrder',
        entity_id: ex.id,
        description: `Webhook: updated ${parsed.order_number} (${parsed.total_meals} meals)`,
      }).catch(() => {});

      return Response.json({ ok: true, action: 'updated', order_number: parsed.order_number });
    } else {
      // Create new order
      const created = await base44.asServiceRole.entities.ShopifyOrder.create(parsed);
      console.log(`[Webhook] Created order ${parsed.order_number} (${parsed.total_meals} meals)`);

      await base44.asServiceRole.entities.AuditLog.create({
        action: 'sync',
        entity_type: 'ShopifyOrder',
        entity_id: created.id,
        description: `Webhook: new order ${parsed.order_number} (${parsed.total_meals} meals)`,
      }).catch(() => {});

      return Response.json({ ok: true, action: 'created', order_number: parsed.order_number });
    }

  } catch (err) {
    console.error(`[Webhook ERROR] ${err.message}`);

    await base44.asServiceRole.entities.AuditLog.create({
      action: 'sync',
      entity_type: 'ShopifyOrder',
      description: `Webhook FAILED: ${err.message}`,
    }).catch(() => {});

    // Return 200 to Shopify so it doesn't retry endlessly
    return Response.json({ ok: false, error: err.message }, { status: 200 });
  }
});