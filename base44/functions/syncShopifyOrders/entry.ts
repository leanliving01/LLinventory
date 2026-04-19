import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

// ─── Exclusion logic: skip non-meal items ───
function isExcluded(lineItem) {
  const title = (lineItem.title || '').toLowerCase();
  const variantTitle = (lineItem.variant_title || '').toLowerCase();
  const sku = (lineItem.sku || '').toLowerCase();
  const tags = (lineItem.properties || []).map(p => (p.value || '').toLowerCase()).join(' ');

  // Supplements
  if (title.includes('supplement') || tags.includes('supplement')) return true;

  // Sauces
  if (title.includes('low calorie sauce') || title.includes('sauce')) return true;

  // 90-day reset challenge
  if (title.includes('90-day reset') || title.includes('90 day reset')) return true;
  if (sku === 'l90c2') return true;

  // Non-food items
  if (title.includes('dry ice') || title.includes('cooler box') || title.includes('delivery')) return true;

  // Snacks / extras that aren't meal packs
  if (title.includes('snack') && !title.includes('meal')) return true;

  return false;
}

// ─── Determine meal type from product title ───
function getMealType(productTitle, variantTitle, orderTags) {
  const title = (productTitle || '').toLowerCase();
  const variant = (variantTitle || '').toLowerCase();
  const tags = (orderTags || '').toLowerCase();

  // Low Carb / Smart Carb
  if (title.includes('low carb') || title.includes('smart carb') || title.includes('low-carb')) {
    return 'LOW_CARB';
  }

  // Men's Lean Muscle
  if (title.includes('lean muscle') && (title.includes("men") || title.includes("man") || title.includes("male"))) {
    return 'MLM';
  }

  // Men's Weight Loss
  if (title.includes('weight loss') && (title.includes("men") || title.includes("man") || title.includes("male"))) {
    return 'MWL';
  }

  // Women's Lean Muscle
  if (title.includes('lean muscle') && (title.includes("women") || title.includes("woman") || title.includes("female") || title.includes("ladies"))) {
    return 'WLM';
  }

  // Women's Weight Loss
  if (title.includes('weight loss') && (title.includes("women") || title.includes("woman") || title.includes("female") || title.includes("ladies"))) {
    return 'WWL';
  }

  // Fallback: check variant title for clues
  if (variant.includes('lean muscle')) {
    if (variant.includes("men") || variant.includes("male")) return 'MLM';
    if (variant.includes("women") || variant.includes("female") || variant.includes("ladies")) return 'WLM';
  }
  if (variant.includes('weight loss')) {
    if (variant.includes("men") || variant.includes("male")) return 'MWL';
    if (variant.includes("women") || variant.includes("female") || variant.includes("ladies")) return 'WWL';
  }

  return null;
}

// ─── Determine pack size (number of meals) from variant title ───
function getPackSize(variantTitle) {
  const v = (variantTitle || '').toLowerCase();

  if (v.includes('60') || v.includes('ultimate')) return 60;
  if (v.includes('30') || v.includes('serious')) return 30;
  if (v.includes('15') || v.includes('starter')) return 15;

  // Try to extract a number from the variant
  const match = v.match(/(\d+)\s*(meal|pack)/i);
  if (match) return parseInt(match[1], 10);

  return 0;
}

// ─── Check if line item is BYO ───
function isBYOItem(lineItem, orderTags) {
  const title = (lineItem.title || '').toLowerCase();
  const tags = (orderTags || '').toLowerCase();
  return title.includes('build your own') || title.includes('byo') || tags.includes('byo meals');
}

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me();
  if (!user) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const storeDomain = Deno.env.get('SHOPIFY_STORE_DOMAIN');
  const accessToken = Deno.env.get('SHOPIFY_ACCESS_TOKEN');

  if (!storeDomain || !accessToken) {
    return Response.json({ error: 'Shopify credentials not configured' }, { status: 400 });
  }

  // Fetch paid, unfulfilled orders from Shopify
  const url = `https://${storeDomain}/admin/api/2024-01/orders.json?status=open&financial_status=paid&fulfillment_status=unfulfilled&limit=250`;

  const shopifyRes = await fetch(url, {
    headers: {
      'X-Shopify-Access-Token': accessToken,
      'Content-Type': 'application/json',
    },
  });

  if (!shopifyRes.ok) {
    const errorText = await shopifyRes.text();
    console.error('Shopify API error:', shopifyRes.status, errorText);
    return Response.json({ error: `Shopify API error: ${shopifyRes.status}` }, { status: 502 });
  }

  const { orders: shopifyOrders } = await shopifyRes.json();
  console.log(`Fetched ${shopifyOrders.length} orders from Shopify`);

  // Get existing orders for dedup
  const existingOrders = await base44.asServiceRole.entities.ShopifyOrder.filter({});
  const existingByShopifyId = {};
  const existingByOrderNumber = {};
  existingOrders.forEach(o => {
    if (o.shopify_order_id) existingByShopifyId[o.shopify_order_id] = o;
    if (o.order_number) existingByOrderNumber[o.order_number] = o;
  });

  // Get existing order lines for dedup
  const existingLines = await base44.asServiceRole.entities.ShopifyOrderLine.filter({});
  const existingLinesByItemId = {};
  existingLines.forEach(l => {
    if (l.shopify_line_item_id) existingLinesByItemId[l.shopify_line_item_id] = l;
  });

  // Get existing committed demand to avoid duplicates
  const existingDemand = await base44.asServiceRole.entities.CommittedDemand.filter({});
  const existingDemandByLineId = {};
  existingDemand.forEach(d => {
    if (d.source_line_id) {
      if (!existingDemandByLineId[d.source_line_id]) existingDemandByLineId[d.source_line_id] = [];
      existingDemandByLineId[d.source_line_id].push(d);
    }
  });

  // Get all SKUs for mapping BYO items
  const allSkus = await base44.asServiceRole.entities.SKU.filter({});

  let created = 0;
  let updated = 0;
  let skipped = 0;
  let linesCreated = 0;
  let linesUpdated = 0;
  let demandCreated = 0;

  for (const order of shopifyOrders) {
    const shopifyId = String(order.id);
    const orderNumber = order.name || `#${order.order_number}`;
    const orderTags = order.tags || '';

    const existingOrder = existingByShopifyId[shopifyId] || existingByOrderNumber[orderNumber];

    // ─── Parse all line items to calculate meal breakdown ───
    let mwlMeals = 0;
    let mlmMeals = 0;
    let wwlMeals = 0;
    let wlmMeals = 0;
    let lcMeals = 0;
    let byoMeals = 0;
    let totalMeals = 0;
    let orderIsByo = false;

    const parsedLines = [];

    for (const li of order.line_items) {
      const qty = li.quantity || 0;

      // Skip excluded items
      if (isExcluded(li)) {
        parsedLines.push({ li, excluded: true, mealType: null, packSize: 0, isByo: false });
        continue;
      }

      // Check if BYO
      if (isBYOItem(li, orderTags)) {
        orderIsByo = true;
        byoMeals += qty; // Each BYO line item = 1 meal per unit
        totalMeals += qty;
        parsedLines.push({ li, excluded: false, mealType: 'BYO', packSize: 1, isByo: true });
        continue;
      }

      // Standard meal pack
      const mealType = getMealType(li.title, li.variant_title, orderTags);
      const packSize = getPackSize(li.variant_title);

      if (mealType && packSize > 0) {
        const mealCount = packSize * qty;
        totalMeals += mealCount;

        switch (mealType) {
          case 'MWL': mwlMeals += mealCount; break;
          case 'MLM': mlmMeals += mealCount; break;
          case 'WWL': wwlMeals += mealCount; break;
          case 'WLM': wlmMeals += mealCount; break;
          case 'LOW_CARB': lcMeals += mealCount; break;
        }

        parsedLines.push({ li, excluded: false, mealType, packSize, isByo: false });
      } else {
        // Could not parse — skip
        parsedLines.push({ li, excluded: true, mealType: null, packSize: 0, isByo: false });
      }
    }

    // ─── Save / Update the Order ───
    let savedOrderId;
    const orderData = {
      customer_name: order.customer ? `${order.customer.first_name || ''} ${order.customer.last_name || ''}`.trim() : '',
      paid_status: 'paid',
      fulfilment_status: 'unfulfilled',
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
      demand_calculated: true,
    };

    if (existingOrder) {
      await base44.asServiceRole.entities.ShopifyOrder.update(existingOrder.id, orderData);
      updated++;
      savedOrderId = existingOrder.id;
    } else {
      const savedOrder = await base44.asServiceRole.entities.ShopifyOrder.create({
        shopify_order_id: shopifyId,
        order_number: orderNumber,
        order_date: order.created_at,
        demand_calculated: true,
        ...orderData,
      });
      savedOrderId = savedOrder.id;
      created++;
    }

    // ─── Sync line items and create committed demand ───
    for (const parsed of parsedLines) {
      const li = parsed.li;
      const lineItemId = String(li.id);
      const existingLine = existingLinesByItemId[lineItemId];
      const qty = li.quantity || 0;

      const lineData = {
        shopify_order_id: savedOrderId,
        shopify_line_item_id: lineItemId,
        product_title: li.title || '',
        variant_title: li.variant_title || '',
        quantity: qty,
        is_mapped: !parsed.excluded && (parsed.mealType !== null),
        mapping_type: parsed.excluded ? 'unmapped' : (parsed.isByo ? 'byo' : 'fixed_pack'),
        raw_payload: JSON.stringify(li),
      };

      let savedLineId;
      if (existingLine) {
        await base44.asServiceRole.entities.ShopifyOrderLine.update(existingLine.id, lineData);
        savedLineId = existingLine.id;
        linesUpdated++;
      } else {
        const savedLine = await base44.asServiceRole.entities.ShopifyOrderLine.create(lineData);
        savedLineId = savedLine.id;
        linesCreated++;
      }

      // ─── Create committed demand records ───
      if (!parsed.excluded && parsed.mealType && parsed.packSize > 0) {
        // Delete old demand for this line (recalculate fresh)
        const oldDemands = existingDemandByLineId[savedLineId] || [];
        for (const old of oldDemands) {
          await base44.asServiceRole.entities.CommittedDemand.delete(old.id);
        }

        if (parsed.isByo) {
          // BYO: each unit is 1 meal, map to MWL SKU (300g portions)
          const mwlSkus = allSkus.filter(s => s.package_type === 'MWL' && s.is_active !== false);
          // Try to match by meal name from the product title
          const byoTitle = (li.title || '').toLowerCase();
          const matchedSku = mwlSkus.find(s => byoTitle.includes((s.meal_name || '').toLowerCase()));

          if (matchedSku) {
            await base44.asServiceRole.entities.CommittedDemand.create({
              date: new Date().toISOString().split('T')[0],
              sku_id: matchedSku.id,
              sku_display_name: matchedSku.display_name || '',
              quantity: qty,
              source_order_id: savedOrderId,
              source_line_id: savedLineId,
              demand_type: 'byo',
            });
            demandCreated++;
          }
        } else {
          // Fixed pack: create demand for all SKUs of that package type
          const packageSkus = allSkus.filter(s => s.package_type === parsed.mealType && s.is_active !== false);
          const mealsPerSku = getMealsPerSku(parsed.mealType, parsed.packSize);

          for (const sku of packageSkus) {
            await base44.asServiceRole.entities.CommittedDemand.create({
              date: new Date().toISOString().split('T')[0],
              sku_id: sku.id,
              sku_display_name: sku.display_name || '',
              quantity: mealsPerSku * qty,
              source_order_id: savedOrderId,
              source_line_id: savedLineId,
              demand_type: 'fixed_pack',
            });
            demandCreated++;
          }
        }
      }
    }
  }

  // Audit log
  await base44.asServiceRole.entities.AuditLog.create({
    action: 'sync',
    entity_type: 'ShopifyOrder',
    description: `Synced ${shopifyOrders.length} orders (${created} new, ${updated} updated, ${linesCreated} new lines, ${demandCreated} demand records)`,
  });

  return Response.json({
    success: true,
    total: shopifyOrders.length,
    created,
    updated,
    skipped,
    lines_created: linesCreated,
    lines_updated: linesUpdated,
    demand_created: demandCreated,
  });
});

// ─── Calculate how many of each SKU per pack ───
// Goal-related: 15-pack = 1 each, 30-pack = 2 each, 60-pack = 4 each
// Low Carb: 15-pack = 3 each, 30-pack = 6 each, 60-pack = 12 each
function getMealsPerSku(mealType, packSize) {
  if (mealType === 'LOW_CARB') {
    // Low carb has fewer unique meals, so more of each per pack
    if (packSize === 15) return 3;
    if (packSize === 30) return 6;
    if (packSize === 60) return 12;
    return Math.ceil(packSize / 5); // fallback
  }
  // Goal-related packages
  if (packSize === 15) return 1;
  if (packSize === 30) return 2;
  if (packSize === 60) return 4;
  return Math.ceil(packSize / 15); // fallback
}