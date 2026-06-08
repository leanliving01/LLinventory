#!/usr/bin/env node
// One-shot FULL Shopify order resync. Triggered manually via the
// "Full Shopify Resync" GitHub Action (full-resync.yml). The edge function
// self-chains through all pages server-side, so this only needs to fire 'start'
// with fullResync:true (which also bypasses the "already running" guard).
//
// Required env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

async function run() {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/sync-shopify-orders`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${SERVICE_KEY}`,
    },
    body: JSON.stringify({ mode: 'start', fullResync: true }),
  });
  const text = await res.text();
  console.log(`[full-resync] ${res.status} — ${text.slice(0, 400)}`);
  if (!res.ok) process.exit(1);
}

run().catch((e) => { console.error('Fatal:', e); process.exit(1); });
