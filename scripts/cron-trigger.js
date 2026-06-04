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

async function invoke(fnName, body = {}) {
  const res = await fetch(`${FUNCTIONS_URL}/${fnName}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${SERVICE_KEY}`,
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }
  return { status: res.status, ok: res.ok, data };
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
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/recalc_committed_stock`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SERVICE_KEY}`,
        'apikey': SERVICE_KEY,
      },
      body: '{}',
    });
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch { data = { raw: text }; }
    console.log(`[recalc-committed-stock] ${res.status} — rows_written=${data?.rows_written ?? '?'} skus=${data?.unique_skus ?? '?'}`);
  } catch (e) {
    console.error('[recalc-committed-stock] Error:', e.message);
  }

  // Deduct physical stock for newly-fulfilled orders — every 15 min.
  // Sweeps any order in lifecycle_state='fulfilled' with stock_deducted=false.
  // Idempotent (sticky flag + stock_movements.reference_key), so re-runs are safe.
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/deduct_fulfilled_stock`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SERVICE_KEY}`,
        'apikey': SERVICE_KEY,
      },
      body: '{}',
    });
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch { data = { raw: text }; }
    console.log(`[deduct-fulfilled-stock] ${res.status} — orders=${data?.orders_processed ?? '?'} rows_written=${data?.rows_written ?? '?'}`);
  } catch (e) {
    console.error('[deduct-fulfilled-stock] Error:', e.message);
  }

  // Xero invoices — every 4 hours (guard: the function itself checks for concurrent runs)
  try {
    const r = await invoke('sync-xero-invoices', { mode: 'start' });
    console.log(`[xero-invoices] ${r.status} — ${JSON.stringify(r.data).slice(0, 120)}`);
  } catch (e) {
    console.error('[xero-invoices] Error:', e.message);
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
