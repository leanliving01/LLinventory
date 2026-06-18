#!/usr/bin/env node
// External cron trigger for Lean Living sync edge functions.
// Runs every 15 min via GitHub Actions (sync-cron.yml).
//
// Required env vars:
//   SUPABASE_URL              — e.g. https://xxxx.supabase.co
//   SUPABASE_SERVICE_ROLE_KEY — service role key (keep secret)

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const FUNCTIONS_URL = `${SUPABASE_URL}/functions/v1`;

// Abort a fetch after 60 s so a hung edge function never blocks the whole cron run.
async function invoke(fnName, body = {}, timeoutMs = 60_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${FUNCTIONS_URL}/${fnName}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SERVICE_KEY}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch { data = { raw: text }; }
    return { status: res.status, ok: res.ok, data };
  } finally {
    clearTimeout(timer);
  }
}

// Direct PostgREST RPC call with a 60-second timeout.
async function callRpc(path, body = '{}') {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60_000);
  try {
    const res = await fetch(`${SUPABASE_URL}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SERVICE_KEY}`,
        'apikey': SERVICE_KEY,
      },
      body,
      signal: controller.signal,
    });
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch { data = { raw: text }; }
    return { status: res.status, data };
  } finally {
    clearTimeout(timer);
  }
}

async function run() {
  const now = new Date();
  console.log(`[cron-trigger] ${now.toISOString()} — running sync checks`);

  // Shopify orders — every 15 min
  try {
    const r = await invoke('sync-shopify-orders', { mode: 'start' });
    console.log(`[shopify-orders] ${r.status} — ${JSON.stringify(r.data).slice(0, 120)}`);
  } catch (e) {
    console.error('[shopify-orders] Error:', e.message);
  }

  // Demand decomposition — every 15 min (decomposes new orders into component SKUs)
  // Runs after the order sync so fresh orders are picked up immediately.
  try {
    const r = await invoke('recalc-demand', {});
    console.log(`[recalc-demand] ${r.status} — ${JSON.stringify(r.data).slice(0, 120)}`);
  } catch (e) {
    console.error('[recalc-demand] Error:', e.message);
  }

  // Committed stock recalculation — every 15 min (same cadence as order sync)
  try {
    const { status, data } = await callRpc('/rest/v1/rpc/recalc_committed_stock');
    console.log(`[recalc-committed-stock] ${status} — rows_written=${data?.rows_written ?? '?'} skus=${data?.unique_skus ?? '?'}`);
  } catch (e) {
    console.error('[recalc-committed-stock] Error:', e.message);
  }

  // Deduct physical stock for newly-fulfilled orders — every 15 min.
  // Processes up to 50 orders per run (p_limit) to stay well within the
  // Supabase statement timeout. Idempotent via sticky flag + reference_key.
  try {
    const { status, data } = await callRpc('/rest/v1/rpc/deduct_fulfilled_stock', '{"p_limit":50}');
    console.log(`[deduct-fulfilled-stock] ${status} — orders=${data?.orders_processed ?? '?'} rows_written=${data?.rows_written ?? '?'} missing_skus=${JSON.stringify(data?.missing_skus ?? [])}`);
  } catch (e) {
    console.error('[deduct-fulfilled-stock] Error:', e.message);
  }

  // Shopify native returns (RMAs) — every 15 min. Imports as Draft Returns;
  // no-op for stores without the Returns feature. Refunds ride on the order sync.
  try {
    const r = await invoke('sync-shopify-returns', { maxPages: 5 });
    console.log(`[shopify-returns] ${r.status} — ${JSON.stringify(r.data).slice(0, 120)}`);
  } catch (e) {
    console.error('[shopify-returns] Error:', e.message);
  }

  // Xero invoices — every 4 hours (UTC hours 0, 4, 8, 12, 16, 20).
  // Running it every 15 min burned Xero's daily API quota and caused 429s.
  if (now.getUTCHours() % 4 === 0 && now.getUTCMinutes() < 15) {
    try {
      const r = await invoke('sync-xero-invoices', { mode: 'start' });
      console.log(`[xero-invoices] ${r.status} — ${JSON.stringify(r.data).slice(0, 120)}`);
    } catch (e) {
      console.error('[xero-invoices] Error:', e.message);
    }
  } else {
    const nextHour = (Math.floor(now.getUTCHours() / 4) + 1) * 4 % 24;
    console.log(`[xero-invoices] Skipped — next run at ${String(nextHour).padStart(2, '0')}:00 UTC`);
  }

  // Shopify products — once per day at 03:00 SAST (01:00 UTC).
  // Pulls product changes (incl. price edits) from Shopify; the function stores
  // VAT-exclusive prices. Incremental via updated_at_min, so a price edit on
  // Shopify is picked up on the next daily run. Self-chains across pages.
  if (now.getUTCHours() === 1 && now.getUTCMinutes() < 15) {
    try {
      const r = await invoke('sync-shopify-products', { mode: 'start' });
      console.log(`[shopify-products] ${r.status} — ${JSON.stringify(r.data).slice(0, 120)}`);
    } catch (e) {
      console.error('[shopify-products] Error:', e.message);
    }
  }

  // Daily reconciliation — only fire once per day (at 02:00 SAST = 00:00 UTC)
  if (now.getUTCHours() === 0 && now.getUTCMinutes() < 15) {
    try {
      const r = await invoke('reconcile-daily', {});
      console.log(`[reconcile-daily] ${r.status} — ${JSON.stringify(r.data).slice(0, 120)}`);
    } catch (e) {
      console.error('[reconcile-daily] Error:', e.message);
    }
  }
}

run().catch(e => { console.error('Fatal:', e); process.exit(1); });
