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

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 });
  }

  const rawBody = await req.text();

  const hmac = req.headers.get('x-shopify-hmac-sha256');
  const valid = await verifyHmac(rawBody, hmac);
  if (!valid) {
    console.error('[CustomerWebhook] HMAC verification failed');
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const reconstructedReq = new Request(req.url, {
    method: req.method,
    headers: req.headers,
    body: rawBody,
  });
  const base44 = createClientFromRequest(reconstructedReq);

  let customer;
  try {
    customer = JSON.parse(rawBody);
  } catch (e) {
    console.error('[CustomerWebhook] Invalid JSON:', e.message);
    return Response.json({ error: 'Bad payload' }, { status: 400 });
  }

  if (!customer || !customer.id) {
    return Response.json({ ok: true, skipped: true });
  }

  const customerId = String(customer.id);
  const topic = req.headers.get('x-shopify-topic') || 'customers/unknown';
  const email = customer.email || '';
  console.log(`[CustomerWebhook] ${topic} — ${customer.first_name || ''} ${customer.last_name || ''} (${customerId})`);

  try {
    // Log webhook event
    await base44.asServiceRole.entities.ShopifyWebhookEvent.create({
      topic,
      shop_domain: req.headers.get('x-shopify-shop-domain') || '',
      external_id: customerId,
      shopify_updated_at: customer.updated_at || '',
      payload: rawBody.slice(0, 50000),
      signature: hmac || '',
      received_at: new Date().toISOString(),
      status: 'pending',
    });

    // Build customer data
    const addr = customer.default_address || {};
    const dataHash = `${customer.first_name}|${customer.last_name}|${email}|${customer.phone}|${customer.orders_count}|${customer.updated_at}`;

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
      raw_payload: rawBody.slice(0, 50000),
    };

    // Upsert by external_id
    const existing = await base44.asServiceRole.entities.Customer.filter({ external_id: customerId });
    let action;

    if (existing.length > 0) {
      // Skip if unchanged
      if (existing[0].data_hash === dataHash) {
        console.log(`[CustomerWebhook] No changes for ${customerId}, skipped`);
        // Mark event processed
        const events = await base44.asServiceRole.entities.ShopifyWebhookEvent.filter({ external_id: customerId, status: 'pending' });
        if (events.length > 0) {
          await base44.asServiceRole.entities.ShopifyWebhookEvent.update(events[events.length - 1].id, { status: 'processed', processed_at: new Date().toISOString() });
        }
        return Response.json({ ok: true, action: 'skipped', reason: 'unchanged' });
      }

      const { external_id, ...updateData } = customerData;
      await base44.asServiceRole.entities.Customer.update(existing[0].id, updateData);
      action = 'updated';
    } else {
      if (!email) {
        console.log(`[CustomerWebhook] Skipping customer ${customerId} — no email`);
        return Response.json({ ok: true, action: 'skipped', reason: 'no_email' });
      }
      await base44.asServiceRole.entities.Customer.create(customerData);
      action = 'created';
    }

    console.log(`[CustomerWebhook] ${action} customer ${customerId}`);

    // Mark event processed
    const events = await base44.asServiceRole.entities.ShopifyWebhookEvent.filter({ external_id: customerId, status: 'pending' });
    if (events.length > 0) {
      await base44.asServiceRole.entities.ShopifyWebhookEvent.update(events[events.length - 1].id, { status: 'processed', processed_at: new Date().toISOString() });
    }

    await base44.asServiceRole.entities.AuditLog.create({
      action: 'sync',
      entity_type: 'Customer',
      description: `Customer webhook: ${action} ${customer.first_name || ''} ${customer.last_name || ''} (${email})`,
    }).catch(() => {});

    return Response.json({ ok: true, action, customer_id: customerId });

  } catch (err) {
    console.error(`[CustomerWebhook ERROR] ${err.message}`);

    const events = await base44.asServiceRole.entities.ShopifyWebhookEvent.filter({ external_id: customerId, status: 'pending' }).catch(() => []);
    if (events.length > 0) {
      await base44.asServiceRole.entities.ShopifyWebhookEvent.update(events[events.length - 1].id, {
        status: 'failed',
        error_message: err.message,
      }).catch(() => {});
    }

    return Response.json({ ok: false, error: err.message }, { status: 200 });
  }
});