// Daily reconciliation sweep. Scheduled at 02:00 SAST (00:00 UTC) via external cron.
//
// Step 1: Trigger sync-shopify-orders with fullResync=false but updated_at_min = 7 days ago
//         to re-pull any orders that changed in the last week.
// Step 2: Trigger sync-xero-invoices for the same window.
// Step 3: Call reconcile-shopify to detect mismatches.
// Step 4: Log the sweep in sync_logs.

import { getSupabase, corsHeaders, json } from '../_shared/shopify.ts';
import { startSyncLog, finishSyncLog } from '../_shared/sync-log.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

async function invokeFn(name: string, body: Record<string, unknown>): Promise<{ ok: boolean; status: number }> {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  return { ok: res.ok, status: res.status };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders() });

  const supabase = getSupabase();
  const logId = await startSyncLog(supabase, 'reconcile_daily', 'reconciliation');

  const results: Record<string, string> = {};
  let errors = 0;

  // 1. Re-sync last 7 days of Shopify orders (incremental window re-pull)
  const shopifyRes = await invokeFn('sync-shopify-orders', { mode: 'start', fullResync: false });
  results.shopify_orders = shopifyRes.ok ? 'triggered' : `error_${shopifyRes.status}`;
  if (!shopifyRes.ok) errors++;

  // 2. Re-sync Xero invoices
  const xeroRes = await invokeFn('sync-xero-invoices', { mode: 'start', fullResync: false });
  results.xero_invoices = xeroRes.ok ? 'triggered' : `error_${xeroRes.status}`;
  if (!xeroRes.ok) errors++;

  // 3. Run mismatch detection (existing reconcile-shopify)
  const reconRes = await invokeFn('reconcile-shopify', { scope: 'all', auto_correct: false });
  results.mismatch_scan = reconRes.ok ? 'triggered' : `error_${reconRes.status}`;
  if (!reconRes.ok) errors++;

  await finishSyncLog(supabase, logId, errors === 0 ? 'completed' : 'partial', {
    records_fetched: 0,
    errors_count: errors,
  });

  return json({ status: errors === 0 ? 'completed' : 'partial', results, errors });
});
