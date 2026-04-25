import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * Bulk sync ALL customers from Shopify → Customer entity.
 * Runs continuously, updates SyncState with progress.
 */

const SYNC_KEY = 'shopify_customers';
const PAGE_SIZE = 50;

async function fetchShopifyPage(url, accessToken) {
  const MAX_RETRIES = 3;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const res = await fetch(url, {
      headers: { 'X-Shopify-Access-Token': accessToken, 'Content-Type': 'application/json' },
    });
    if (res.status === 429) {
      const retryAfter = parseFloat(res.headers.get('retry-after') || '2');
      await new Promise(r => setTimeout(r, retryAfter * 1000));
      continue;
    }
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Shopify API ${res.status}: ${errText.slice(0, 500)}`);
    }
    const data = await res.json();
    const linkHeader = res.headers.get('link') || '';
    const nextMatch = linkHeader.match(/<([^>]+)>;\s*rel="next"/);
    return { items: data.customers || [], nextUrl: nextMatch ? nextMatch[1] : '' };
  }
  throw new Error('Shopify customers rate limit exceeded');
}

function computeHash(c) {
  return `${c.first_name}|${c.last_name}|${c.email}|${c.phone}|${c.orders_count}|${c.updated_at}`;
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
  if (syncState.sync_status === 'running') {
    return Response.json({ ok: true, status: 'already_running' });
  }

  await base44.asServiceRole.entities.SyncState.update(syncState.id, {
    sync_status: 'running', records_synced: 0, records_failed: 0, error_message: '',
  });

  let currentUrl = `https://${storeDomain}/admin/api/2024-01/customers.json?limit=${PAGE_SIZE}`;
  let created = 0, updated = 0, unchanged = 0, failed = 0, totalProcessed = 0, pageNum = 0;

  try {
    while (currentUrl) {
      pageNum++;
      const { items: customers, nextUrl } = await fetchShopifyPage(currentUrl, accessToken);

      for (const customer of customers) {
        const customerId = String(customer.id);
        const email = customer.email || '';
        const dataHash = computeHash(customer);
        const addr = customer.default_address || {};

        const customerData = {
          external_id: customerId,
          first_name: customer.first_name || '',
          last_name: customer.last_name || '',
          email,
          phone: customer.phone || '',
          total_spent: parseFloat(customer.total_spent || 0),
          orders_count: customer.orders_count || 0,
          tags: customer.tags ? customer.tags.split(',').map(t => t.trim()).filter(Boolean) : [],
          default_address_city: addr.city || '',
          default_address_province: addr.province || '',
          data_hash: dataHash,
          source_platform: 'shopify',
          last_synced_at: new Date().toISOString(),
          raw_payload: JSON.stringify(customer).slice(0, 50000),
        };

        try {
          const existing = await base44.asServiceRole.entities.Customer.filter({ external_id: customerId });

          if (existing.length > 0) {
            if (existing[0].data_hash === dataHash) { unchanged++; }
            else {
              const { external_id, ...updateData } = customerData;
              await base44.asServiceRole.entities.Customer.update(existing[0].id, updateData);
              updated++;
            }
          } else {
            if (!email) { totalProcessed++; continue; } // Skip customers without email
            await base44.asServiceRole.entities.Customer.create(customerData);
            created++;
          }
        } catch (err) {
          console.error(`[CustomerSync] Error on ${customerId}: ${err.message}`);
          failed++;
        }
        totalProcessed++;
      }

      await base44.asServiceRole.entities.SyncState.update(syncState.id, {
        records_synced: totalProcessed, records_failed: failed,
        error_message: `Page ${pageNum}: ${created}c ${updated}u ${unchanged}s ${failed}e`,
        last_sync_at: new Date().toISOString(),
      });

      console.log(`[CustomerSync] Page ${pageNum}: ${customers.length} customers. Total: ${totalProcessed}`);
      currentUrl = nextUrl || '';
      if (currentUrl) await new Promise(r => setTimeout(r, 300));
    }

    await base44.asServiceRole.entities.SyncState.update(syncState.id, {
      sync_status: 'idle', records_synced: totalProcessed, records_failed: failed,
      error_message: '', last_sync_at: new Date().toISOString(),
    });

    console.log(`[CustomerSync] Complete: ${totalProcessed} (${created}c ${updated}u ${unchanged}s ${failed}e)`);

    await base44.asServiceRole.entities.AuditLog.create({
      action: 'sync', entity_type: 'Customer',
      description: `Bulk customer sync: ${created} new, ${updated} updated, ${unchanged} unchanged, ${failed} failed (${totalProcessed} total)`,
    }).catch(() => {});

    return Response.json({ ok: true, status: 'completed', created, updated, unchanged, failed, total: totalProcessed });

  } catch (err) {
    console.error(`[CustomerSync FATAL] ${err.message}`);
    await base44.asServiceRole.entities.SyncState.update(syncState.id, {
      sync_status: 'error', error_message: err.message, last_sync_at: new Date().toISOString(),
    });
    return Response.json({ ok: false, error: err.message }, { status: 500 });
  }
});