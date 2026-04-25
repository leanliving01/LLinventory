import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const SYNC_KEY = 'shopify_products';
const PAGE_SIZE = 25;
const THROTTLE_MS = 250; // delay between each record to avoid Base44 rate limits

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function deriveProductType(product) {
  const pt = (product.product_type || '').toLowerCase();
  const tags = (product.tags || '').toLowerCase();
  if (pt.includes('supplement') || tags.includes('supplement')) return 'supplement';
  if (pt.includes('sauce') || tags.includes('sauce')) return 'sauce';
  if (pt.includes('bundle') || tags.includes('bundle')) return 'bundle';
  if (pt.includes('package') || tags.includes('package') || tags.includes('meal plan')) return 'package';
  return 'finished_meal';
}

function computeHash(product) {
  return `${product.title}|${product.status}|${product.variants?.length}|${product.updated_at}`;
}

async function fetchShopifyPage(url, accessToken) {
  const MAX_RETRIES = 3;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const res = await fetch(url, {
      headers: { 'X-Shopify-Access-Token': accessToken, 'Content-Type': 'application/json' },
    });
    if (res.status === 429) {
      const retryAfter = parseFloat(res.headers.get('retry-after') || '2');
      await sleep(retryAfter * 1000);
      continue;
    }
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Shopify API ${res.status}: ${errText.slice(0, 500)}`);
    }
    const data = await res.json();
    const linkHeader = res.headers.get('link') || '';
    const nextMatch = linkHeader.match(/<([^>]+)>;\s*rel="next"/);
    return { items: data.products || [], nextUrl: nextMatch ? nextMatch[1] : '' };
  }
  throw new Error('Shopify products rate limit exceeded');
}

// Retry wrapper for Base44 SDK calls that may hit rate limits
async function withRetry(fn, maxRetries = 3) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const msg = (err.message || '').toLowerCase();
      if (msg.includes('rate limit') && attempt < maxRetries) {
        console.log(`[ProductSync] Rate limited, retry ${attempt}/${maxRetries} after 2s`);
        await sleep(2000 * attempt);
        continue;
      }
      throw err;
    }
  }
}

async function getSyncState(base44) {
  const existing = await base44.asServiceRole.entities.SyncState.filter({ source_key: SYNC_KEY });
  if (existing.length > 0) return existing[0];
  return await base44.asServiceRole.entities.SyncState.create({
    source_key: SYNC_KEY, sync_status: 'idle', records_synced: 0, records_failed: 0,
  });
}

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me();
  if (!user || user.role !== 'admin') {
    return Response.json({ error: 'Forbidden' }, { status: 403 });
  }

  const storeDomain = Deno.env.get('SHOPIFY_STORE_DOMAIN');
  const accessToken = Deno.env.get('SHOPIFY_ACCESS_TOKEN');
  if (!storeDomain || !accessToken) {
    return Response.json({ error: 'Shopify credentials not set' }, { status: 500 });
  }

  const syncState = await getSyncState(base44);

  // If stuck in running for > 10 minutes, force reset
  if (syncState.sync_status === 'running') {
    const lastSync = syncState.last_sync_at ? new Date(syncState.last_sync_at) : new Date(0);
    const minutesStale = (Date.now() - lastSync.getTime()) / 60000;
    if (minutesStale < 10) {
      return Response.json({ ok: true, status: 'already_running' });
    }
    console.log(`[ProductSync] Stale running state (${Math.round(minutesStale)}m), resetting`);
  }

  await base44.asServiceRole.entities.SyncState.update(syncState.id, {
    sync_status: 'running', records_synced: 0, records_failed: 0, error_message: '',
  });

  let currentUrl = `https://${storeDomain}/admin/api/2024-01/products.json?limit=${PAGE_SIZE}&status=active`;
  let created = 0, updated = 0, unchanged = 0, failed = 0, totalProcessed = 0, pageNum = 0;

  try {
    while (currentUrl) {
      pageNum++;
      const { items: products, nextUrl } = await fetchShopifyPage(currentUrl, accessToken);

      for (const product of products) {
        const productId = String(product.id);
        const newHash = computeHash(product);
        const isArchived = product.status === 'archived' || product.status === 'draft';
        const variants = product.variants || [];

        for (const variant of variants) {
          const variantId = String(variant.id);
          const sku = variant.sku || '';
          if (!sku) { totalProcessed++; continue; }

          const productData = {
            name: variants.length > 1 ? `${product.title} - ${variant.title}` : product.title,
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
            raw_payload: JSON.stringify({ product_title: product.title, variant }).slice(0, 15000),
          };

          try {
            let existing = await withRetry(() =>
              base44.asServiceRole.entities.Product.filter({ external_id: variantId })
            );
            if (existing.length === 0) {
              existing = await withRetry(() =>
                base44.asServiceRole.entities.Product.filter({ shopify_variant_id: variantId })
              );
            }
            if (existing.length === 0) {
              existing = await withRetry(() =>
                base44.asServiceRole.entities.Product.filter({ sku })
              );
            }

            if (existing.length > 0) {
              if (existing[0].data_hash === newHash) {
                unchanged++;
              } else {
                await withRetry(() =>
                  base44.asServiceRole.entities.Product.update(existing[0].id, {
                    name: productData.name, price: productData.price, tags: productData.tags,
                    status: productData.status, shopify_product_id: productData.shopify_product_id,
                    shopify_variant_id: productData.shopify_variant_id, external_id: productData.external_id,
                    weight_g: productData.weight_g || existing[0].weight_g,
                    data_hash: productData.data_hash, last_synced_at: productData.last_synced_at,
                    raw_payload: productData.raw_payload,
                  })
                );
                updated++;
              }
            } else {
              await withRetry(() =>
                base44.asServiceRole.entities.Product.create({
                  sku, ...productData, type: deriveProductType(product), stock_uom: 'pcs',
                })
              );
              created++;
            }
          } catch (err) {
            console.error(`[ProductSync] Error on ${sku}: ${err.message}`);
            failed++;
          }
          totalProcessed++;
          // Throttle to avoid Base44 rate limits
          await sleep(THROTTLE_MS);
        }
      }

      await withRetry(() =>
        base44.asServiceRole.entities.SyncState.update(syncState.id, {
          records_synced: totalProcessed, records_failed: failed,
          error_message: `Page ${pageNum}: ${created}c ${updated}u ${unchanged}s ${failed}e`,
          last_sync_at: new Date().toISOString(),
        })
      );

      console.log(`[ProductSync] Page ${pageNum}: ${products.length} products. Total variants: ${totalProcessed}`);
      currentUrl = nextUrl || '';
      if (currentUrl) await sleep(500);
    }

    await withRetry(() =>
      base44.asServiceRole.entities.SyncState.update(syncState.id, {
        sync_status: 'idle', records_synced: totalProcessed, records_failed: failed,
        error_message: '', last_sync_at: new Date().toISOString(),
      })
    );

    console.log(`[ProductSync] Complete: ${totalProcessed} variants (${created}c ${updated}u ${unchanged}s ${failed}e)`);

    await base44.asServiceRole.entities.AuditLog.create({
      action: 'sync', entity_type: 'Product',
      description: `Bulk product sync: ${created} new, ${updated} updated, ${unchanged} unchanged, ${failed} failed (${totalProcessed} total)`,
    }).catch(() => {});

    return Response.json({ ok: true, status: 'completed', created, updated, unchanged, failed, total: totalProcessed });

  } catch (err) {
    console.error(`[ProductSync FATAL] ${err.message}`);
    await base44.asServiceRole.entities.SyncState.update(syncState.id, {
      sync_status: 'error', error_message: err.message, last_sync_at: new Date().toISOString(),
    }).catch(() => {});
    return Response.json({ ok: false, error: err.message }, { status: 500 });
  }
});