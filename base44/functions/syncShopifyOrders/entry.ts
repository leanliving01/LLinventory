import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

// ─── Exclusion logic: skip non-meal items ───
function isExcluded(lineItem) {
  const title = (lineItem.title || '').toLowerCase();
  const variantTitle = (lineItem.variant_title || '').toLowerCase();
  const sku = (lineItem.sku || '').toLowerCase();
  const tags = (lineItem.properties || []).map(p => String(p.value || '').toLowerCase()).join(' ');

  if (title.includes('supplement') || tags.includes('supplement')) return true;
  if (title.includes('low calorie sauce') || title.includes('sauce')) return true;
  if (title.includes('90-day reset') || title.includes('90 day reset')) return true;
  if (sku === 'l90c2') return true;
  if (title.includes('dry ice') || title.includes('cooler box') || title.includes('delivery')) return true;
  if (title.includes('snack') && !title.includes('meal')) return true;
  return false;
}

// ─── Determine meal type from product title ───
function getMealType(productTitle, variantTitle) {
  const title = (productTitle || '').toLowerCase();
  const variant = (variantTitle || '').toLowerCase();

  if (title.includes('low carb') || title.includes('smart carb') || title.includes('low-carb')) return 'LOW_CARB';
  if (title.includes('lean muscle') && (title.includes("men") || title.includes("man") || title.includes("male"))) return 'MLM';
  if (title.includes('weight loss') && (title.includes("men") || title.includes("man") || title.includes("male"))) return 'MWL';
  if (title.includes('lean muscle') && (title.includes("women") || title.includes("woman") || title.includes("female") || title.includes("ladies"))) return 'WLM';
  if (title.includes('weight loss') && (title.includes("women") || title.includes("woman") || title.includes("female") || title.includes("ladies"))) return 'WWL';

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

// ─── Determine pack size from variant title ───
function getPackSize(variantTitle) {
  const v = (variantTitle || '').toLowerCase();
  if (v.includes('60') || v.includes('ultimate')) return 60;
  if (v.includes('30') || v.includes('serious')) return 30;
  if (v.includes('15') || v.includes('starter')) return 15;
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

// ─── Meals per SKU per pack ───
function getMealsPerSku(mealType, packSize) {
  if (mealType === 'LOW_CARB') {
    if (packSize === 15) return 3;
    if (packSize === 30) return 6;
    if (packSize === 60) return 12;
    return Math.ceil(packSize / 5);
  }
  if (packSize === 15) return 1;
  if (packSize === 30) return 2;
  if (packSize === 60) return 4;
  return Math.ceil(packSize / 15);
}

// ─── Helper: delay to avoid rate limits ───
function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

// ─── Helper: retry with backoff on 429 ───
async function withRetry(fn, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (err) {
      if (err.status === 429 && i < retries - 1) {
        console.log(`Rate limited, waiting ${(i + 1) * 2}s before retry...`);
        await delay((i + 1) * 2000);
      } else {
        throw err;
      }
    }
  }
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
    headers: { 'X-Shopify-Access-Token': accessToken, 'Content-Type': 'application/json' },
  });

  if (!shopifyRes.ok) {
    const errorText = await shopifyRes.text();
    return Response.json({ error: `Shopify API error: ${shopifyRes.status}` }, { status: 502 });
  }

  const { orders: shopifyOrders } = await shopifyRes.json();
  console.log(`Fetched ${shopifyOrders.length} orders from Shopify`);

  // Load all reference data upfront
  const [existingOrders, existingLines, existingDemand, allSkus] = await Promise.all([
    base44.asServiceRole.entities.ShopifyOrder.filter({}),
    base44.asServiceRole.entities.ShopifyOrderLine.filter({}),
    base44.asServiceRole.entities.CommittedDemand.filter({}),
    base44.asServiceRole.entities.SKU.filter({}),
  ]);

  const existingByShopifyId = {};
  const existingByOrderNumber = {};
  existingOrders.forEach(o => {
    if (o.shopify_order_id) existingByShopifyId[o.shopify_order_id] = o;
    if (o.order_number) existingByOrderNumber[o.order_number] = o;
  });

  const existingLinesByItemId = {};
  existingLines.forEach(l => {
    if (l.shopify_line_item_id) existingLinesByItemId[l.shopify_line_item_id] = l;
  });

  const existingDemandByLineId = {};
  existingDemand.forEach(d => {
    if (d.source_line_id) {
      if (!existingDemandByLineId[d.source_line_id]) existingDemandByLineId[d.source_line_id] = [];
      existingDemandByLineId[d.source_line_id].push(d);
    }
  });

  let created = 0, updated = 0, linesCreated = 0, linesUpdated = 0, demandCreated = 0;
  let opCount = 0;

  for (const order of shopifyOrders) {
    const shopifyId = String(order.id);
    const orderNumber = order.name || `#${order.order_number}`;
    const orderTags = order.tags || '';
    const existingOrder = existingByShopifyId[shopifyId] || existingByOrderNumber[orderNumber];

    // ─── Parse line items for meal breakdown ───
    let mwlMeals = 0, mlmMeals = 0, wwlMeals = 0, wlmMeals = 0, lcMeals = 0, byoMeals = 0, totalMeals = 0;
    let orderIsByo = false;
    const parsedLines = [];

    for (const li of order.line_items) {
      const qty = li.quantity || 0;

      if (isExcluded(li)) {
        parsedLines.push({ li, excluded: true, mealType: null, packSize: 0, isByo: false });
        continue;
      }

      if (isBYOItem(li, orderTags)) {
        orderIsByo = true;
        byoMeals += qty;
        totalMeals += qty;
        parsedLines.push({ li, excluded: false, mealType: 'BYO', packSize: 1, isByo: true });
        continue;
      }

      const mealType = getMealType(li.title, li.variant_title);
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
        parsedLines.push({ li, excluded: true, mealType: null, packSize: 0, isByo: false });
      }
    }

    // ─── Save / Update Order (with retry) ───
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

    let savedOrderId;
    if (existingOrder) {
      await withRetry(() => base44.asServiceRole.entities.ShopifyOrder.update(existingOrder.id, orderData));
      updated++;
      savedOrderId = existingOrder.id;
    } else {
      const saved = await withRetry(() => base44.asServiceRole.entities.ShopifyOrder.create({
        shopify_order_id: shopifyId,
        order_number: orderNumber,
        order_date: order.created_at,
        ...orderData,
      }));
      savedOrderId = saved.id;
      created++;
    }
    opCount++;

    // ─── Batch line items: collect creates and updates ───
    const newLines = [];
    const lineUpdates = [];
    const lineIdMap = {}; // lineItemId -> parsed info for demand later

    for (const parsed of parsedLines) {
      const li = parsed.li;
      const lineItemId = String(li.id);
      const existingLine = existingLinesByItemId[lineItemId];

      const lineData = {
        shopify_order_id: savedOrderId,
        shopify_line_item_id: lineItemId,
        product_title: li.title || '',
        variant_title: li.variant_title || '',
        quantity: li.quantity || 0,
        is_mapped: !parsed.excluded && (parsed.mealType !== null),
        mapping_type: parsed.excluded ? 'unmapped' : (parsed.isByo ? 'byo' : 'fixed_pack'),
        raw_payload: JSON.stringify(li),
      };

      if (existingLine) {
        lineUpdates.push({ id: existingLine.id, data: lineData, parsed });
        lineIdMap[lineItemId] = { savedLineId: existingLine.id, parsed };
      } else {
        newLines.push({ data: lineData, parsed, lineItemId });
      }
    }

    // Batch update existing lines
    for (const upd of lineUpdates) {
      await withRetry(() => base44.asServiceRole.entities.ShopifyOrderLine.update(upd.id, upd.data));
      linesUpdated++;
      opCount++;
      if (opCount % 8 === 0) await delay(500);
    }

    // Bulk create new lines in batches of 25
    for (let i = 0; i < newLines.length; i += 25) {
      const batch = newLines.slice(i, i + 25);
      const createdBatch = await withRetry(() =>
        base44.asServiceRole.entities.ShopifyOrderLine.bulkCreate(batch.map(b => b.data))
      );
      // Map back the created IDs
      createdBatch.forEach((created_line, idx) => {
        const orig = batch[idx];
        lineIdMap[orig.lineItemId] = { savedLineId: created_line.id, parsed: orig.parsed };
      });
      linesCreated += batch.length;
      opCount += 1;
      if (opCount % 8 === 0) await delay(500);
    }

    // ─── Committed Demand: batch creates ───
    const demandToCreate = [];

    for (const [lineItemId, info] of Object.entries(lineIdMap)) {
      const { savedLineId, parsed } = info;
      if (parsed.excluded || !parsed.mealType || parsed.packSize <= 0) continue;

      // Delete old demand
      const oldDemands = existingDemandByLineId[savedLineId] || [];
      for (const old of oldDemands) {
        await withRetry(() => base44.asServiceRole.entities.CommittedDemand.delete(old.id));
        opCount++;
        if (opCount % 8 === 0) await delay(500);
      }

      const qty = parsed.li ? (parsed.li.quantity || 0) : 0;
      const today = new Date().toISOString().split('T')[0];

      if (parsed.isByo) {
        const mwlSkus = allSkus.filter(s => s.package_type === 'MWL' && s.is_active !== false);
        const byoTitle = (parsed.li?.title || '').toLowerCase();
        const matchedSku = mwlSkus.find(s => byoTitle.includes((s.meal_name || '').toLowerCase()));
        if (matchedSku) {
          demandToCreate.push({
            date: today,
            sku_id: matchedSku.id,
            sku_display_name: matchedSku.display_name || '',
            quantity: qty,
            source_order_id: savedOrderId,
            source_line_id: savedLineId,
            demand_type: 'byo',
          });
        }
      } else {
        const packageSkus = allSkus.filter(s => s.package_type === parsed.mealType && s.is_active !== false);
        const mealsPerSku = getMealsPerSku(parsed.mealType, parsed.packSize);
        for (const sku of packageSkus) {
          demandToCreate.push({
            date: today,
            sku_id: sku.id,
            sku_display_name: sku.display_name || '',
            quantity: mealsPerSku * qty,
            source_order_id: savedOrderId,
            source_line_id: savedLineId,
            demand_type: 'fixed_pack',
          });
        }
      }
    }

    // Bulk create demand in batches of 25
    for (let i = 0; i < demandToCreate.length; i += 25) {
      const batch = demandToCreate.slice(i, i + 25);
      await withRetry(() => base44.asServiceRole.entities.CommittedDemand.bulkCreate(batch));
      demandCreated += batch.length;
      opCount += 1;
      if (opCount % 8 === 0) await delay(500);
    }

    // Throttle between orders
    if (opCount % 6 === 0) await delay(300);
  }

  // Audit log
  await withRetry(() => base44.asServiceRole.entities.AuditLog.create({
    action: 'sync',
    entity_type: 'ShopifyOrder',
    description: `Synced ${shopifyOrders.length} orders (${created} new, ${updated} updated, ${linesCreated} new lines, ${demandCreated} demand records)`,
  }));

  return Response.json({
    success: true,
    total: shopifyOrders.length,
    created,
    updated,
    lines_created: linesCreated,
    lines_updated: linesUpdated,
    demand_created: demandCreated,
  });
});