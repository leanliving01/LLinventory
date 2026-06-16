import { shopifyFetch, shopifyBaseUrl, SHOPIFY_TOKEN, getSupabase, corsHeaders, json } from '../_shared/shopify.ts';

// Webhooks we register. The handler at /shopify-webhook-handler receives all of them.
const WEBHOOK_TOPICS = [
  'orders/create',
  'orders/updated',
  'orders/paid',
  'orders/fulfilled',
  // Refunds ride on the order sync; returns are polled via cron (store plan
  // does not expose returns/* webhook topics).
  'refunds/create',
] as const;

interface WebhookRegistration {
  topic: string;
  address: string;
  format: string;
}

interface ShopifyWebhook {
  id: number;
  topic: string;
  address: string;
  format: string;
  created_at: string;
}

interface ShopifyWebhooksResponse {
  webhooks: ShopifyWebhook[];
}

interface ShopifyCreateWebhookResponse {
  webhook: ShopifyWebhook;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders() });

  const supabase = getSupabase();
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const handlerUrl = `${supabaseUrl}/functions/v1/shopify-webhook-handler`;

  const results: Array<{ topic: string; status: string; webhookId?: number; error?: string }> = [];

  // Fetch existing webhooks to avoid duplicates
  const existing = await shopifyFetch<ShopifyWebhooksResponse>('/webhooks.json', { limit: '250' });
  const existingByTopic = new Map<string, ShopifyWebhook>();
  if (existing.ok && existing.data) {
    for (const wh of existing.data.webhooks) {
      existingByTopic.set(wh.topic, wh);
    }
  }

  for (const topic of WEBHOOK_TOPICS) {
    const alreadyRegistered = existingByTopic.get(topic);

    if (alreadyRegistered && alreadyRegistered.address === handlerUrl) {
      // Already pointing at our handler — just record the existing ID
      await supabase.from('settings').upsert({
        id: crypto.randomUUID(),
        group: 'shopify',
        key: `webhook_id_${topic.replace('/', '_')}`,
        value: String(alreadyRegistered.id),
        updated_date: new Date().toISOString(),
      }, { onConflict: 'key' });

      results.push({ topic, status: 'already_registered', webhookId: alreadyRegistered.id });
      continue;
    }

    // Delete stale registration pointing elsewhere
    if (alreadyRegistered) {
      await fetch(
        `${shopifyBaseUrl()}/webhooks/${alreadyRegistered.id}.json`,
        {
          method: 'DELETE',
          headers: { 'X-Shopify-Access-Token': SHOPIFY_TOKEN },
        },
      );
    }

    // Create new registration
    const res = await fetch(`${shopifyBaseUrl()}/webhooks.json`, {
      method: 'POST',
      headers: {
        'X-Shopify-Access-Token': SHOPIFY_TOKEN,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        webhook: { topic, address: handlerUrl, format: 'json' } satisfies WebhookRegistration,
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      results.push({ topic, status: 'error', error: err });
      continue;
    }

    const created: ShopifyCreateWebhookResponse = await res.json();
    const webhookId = created.webhook.id;

    await supabase.from('settings').upsert({
      id: crypto.randomUUID(),
      group: 'shopify',
      key: `webhook_id_${topic.replace('/', '_')}`,
      value: String(webhookId),
      updated_date: new Date().toISOString(),
    }, { onConflict: 'key' });

    results.push({ topic, status: 'registered', webhookId });
  }

  return json({ results, handler_url: handlerUrl });
});
