import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

// ─── HMAC verification ───
async function verifyHmac(rawBody, hmacHeader) {
  if (!hmacHeader) return true;
  const secret = Deno.env.get('SHOPIFY_WEBHOOK_SECRET');
  if (!secret) return true;
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(rawBody));
  const computed = btoa(String.fromCharCode(...new Uint8Array(sig)));
  return computed === hmacHeader;
}

// ─── Derive product type from Shopify product_type / tags ───
function deriveProductType(product) {
  const pt = (product.product_type || '').toLowerCase();
  const tags = (product.tags || '').toLowerCase();

  if (pt.includes('supplement') || tags.includes('supplement')) return 'supplement';
  if (pt.includes('sauce') || tags.includes('sauce')) return 'sauce';
  if (pt.includes('bundle') || tags.includes('bundle')) return 'bundle';
  if (pt.includes('package') || tags.includes('package') || tags.includes('meal plan')) return 'package';
  // Default for Shopify products = finished_meal (most common)
  return 'finished_meal';
}

// ─── Simple data hash for change detection ───
function computeHash(data) {
  // Lightweight hash — just use a string of key fields
  return `${data.title}|${data.status}|${data.variants?.length}|${data.updated_at}`;
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 });
  }

  const rawBody = await req.text();

  // HMAC verification
  const hmac = req.headers.get('x-shopify-hmac-sha256');
  const valid = await verifyHmac(rawBody, hmac);
  if (!valid) {
    console.error('[ProductWebhook] HMAC verification failed');
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const reconstructedReq = new Request(req.url, {
    method: req.method,
    headers: req.headers,
    body: rawBody,
  });
  const base44 = createClientFromRequest(reconstructedReq);

  let product;
  try {
    product = JSON.parse(rawBody);
  } catch (e) {
    console.error('[ProductWebhook] Invalid JSON:', e.message);
    return Response.json({ error: 'Bad payload' }, { status: 400 });
  }

  if (!product || !product.id) {
    return Response.json({ ok: true, skipped: true });
  }

  const productId = String(product.id);
  const topic = req.headers.get('x-shopify-topic') || 'products/unknown';
  console.log(`[ProductWebhook] ${topic} — ${product.title} (${productId})`);

  try {
    // Log webhook event
    await base44.asServiceRole.entities.ShopifyWebhookEvent.create({
      topic,
      shop_domain: req.headers.get('x-shopify-shop-domain') || '',
      external_id: productId,
      shopify_updated_at: product.updated_at || '',
      payload: rawBody.slice(0, 50000),
      signature: hmac || '',
      received_at: new Date().toISOString(),
      status: 'pending',
    });

    const newHash = computeHash(product);
    const isArchived = product.status === 'archived' || product.status === 'draft';
    let totalCreated = 0;
    let totalUpdated = 0;
    let totalSkipped = 0;

    // Process each variant as a separate Product record
    const variants = product.variants || [];

    for (const variant of variants) {
      const variantId = String(variant.id);
      const sku = variant.sku || '';

      if (!sku) {
        console.log(`[ProductWebhook] Skipping variant ${variantId} — no SKU`);
        totalSkipped++;
        continue;
      }

      // Build product data from Shopify
      const productData = {
        name: variants.length > 1
          ? `${product.title} - ${variant.title}`
          : product.title,
        price: parseFloat(variant.price || 0),
        weight_g: variant.weight ? Math.round(variant.weight * (variant.weight_unit === 'kg' ? 1000 : variant.weight_unit === 'lb' ? 453.592 : 1)) : null,
        shopify_product_id: productId,
        shopify_variant_id: variantId,
        external_id: variantId,
        tags: product.tags ? product.tags.split(',').map(t => t.trim()).filter(Boolean) : [],
        status: isArchived ? 'archived' : 'active',
        data_hash: newHash,
        source_platform: 'shopify',
        last_synced_at: new Date().toISOString(),
        raw_payload: JSON.stringify({ product_title: product.title, variant }).slice(0, 50000),
      };

      // Try to find existing product by variant ID first, then by SKU
      let existing = await base44.asServiceRole.entities.Product.filter({ external_id: variantId });
      if (existing.length === 0) {
        existing = await base44.asServiceRole.entities.Product.filter({ shopify_variant_id: variantId });
      }
      if (existing.length === 0) {
        existing = await base44.asServiceRole.entities.Product.filter({ sku });
      }

      if (existing.length > 0) {
        // Update existing — only Shopify-authoritative fields (name, price, tags, status, sync metadata)
        // Do NOT overwrite: cost_avg, stock_uom, type, pick_category, supplier, reorder, par_level, etc.
        const record = existing[0];

        // Skip if hash unchanged (no real changes)
        if (record.data_hash === newHash) {
          totalSkipped++;
          continue;
        }

        await base44.asServiceRole.entities.Product.update(record.id, {
          name: productData.name,
          price: productData.price,
          tags: productData.tags,
          status: productData.status,
          shopify_product_id: productData.shopify_product_id,
          shopify_variant_id: productData.shopify_variant_id,
          external_id: productData.external_id,
          weight_g: productData.weight_g || record.weight_g,
          data_hash: productData.data_hash,
          last_synced_at: productData.last_synced_at,
          raw_payload: productData.raw_payload,
        });
        totalUpdated++;
      } else {
        // Create new product
        await base44.asServiceRole.entities.Product.create({
          sku,
          ...productData,
          type: deriveProductType(product),
          stock_uom: 'pcs', // default for Shopify products
        });
        totalCreated++;
      }
    }

    console.log(`[ProductWebhook] Done: ${totalCreated} created, ${totalUpdated} updated, ${totalSkipped} skipped`);

    // Mark webhook processed
    const events = await base44.asServiceRole.entities.ShopifyWebhookEvent.filter({ external_id: productId, status: 'pending' });
    if (events.length > 0) {
      await base44.asServiceRole.entities.ShopifyWebhookEvent.update(events[events.length - 1].id, {
        status: 'processed',
        processed_at: new Date().toISOString(),
      });
    }

    // Audit log
    await base44.asServiceRole.entities.AuditLog.create({
      action: 'sync',
      entity_type: 'Product',
      description: `Product webhook: ${product.title} — ${totalCreated} created, ${totalUpdated} updated, ${totalSkipped} skipped`,
    }).catch(() => {});

    return Response.json({
      ok: true,
      product_title: product.title,
      created: totalCreated,
      updated: totalUpdated,
      skipped: totalSkipped,
    });

  } catch (err) {
    console.error(`[ProductWebhook ERROR] ${err.message}`);

    const events = await base44.asServiceRole.entities.ShopifyWebhookEvent.filter({ external_id: productId, status: 'pending' }).catch(() => []);
    if (events.length > 0) {
      await base44.asServiceRole.entities.ShopifyWebhookEvent.update(events[events.length - 1].id, {
        status: 'failed',
        error_message: err.message,
      }).catch(() => {});
    }

    await base44.asServiceRole.entities.AuditLog.create({
      action: 'sync',
      entity_type: 'Product',
      description: `Product webhook FAILED for ${product?.title || productId}: ${err.message}`,
    }).catch(() => {});

    return Response.json({ ok: false, error: err.message }, { status: 200 });
  }
});