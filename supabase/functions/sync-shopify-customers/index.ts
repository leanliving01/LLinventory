import { shopifyFetch, getSupabase, corsHeaders, json } from '../_shared/shopify.ts';
import {
  getSyncState, markRunning, markComplete, markError, markCancelled, shouldCancel,
} from '../_shared/sync-state.ts';
import { chainNext } from '../_shared/chain.ts';

const SOURCE_KEY = 'shopify_customers';
const FN_NAME = 'sync-shopify-customers';
const PAGE_SIZE = 250;

interface ShopifyCustomersResponse { customers: ShopifyCustomer[]; }

interface ShopifyCustomer {
  id: number;
  first_name?: string;
  last_name?: string;
  email: string | null;
  phone?: string;
  total_spent?: string;
  orders_count?: number;
  tags?: string;
  default_address?: { city?: string; province?: string };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders() });

  let body: { mode?: 'start' | 'continue' | 'cancel'; fullResync?: boolean } = {};
  try { body = await req.json(); } catch { /* empty body ok */ }
  const mode = body.mode || 'start';
  const supabase = getSupabase();

  if (mode === 'cancel') {
    await markCancelled(supabase, SOURCE_KEY);
    return json({ status: 'cancelled', processedThisPage: 0, totalProcessed: 0, hasMore: false });
  }

  let pageInfo: string | null = null;
  let totalProcessed = 0;
  let updatedAtMin: string | undefined;

  const priorState = await getSyncState(supabase, SOURCE_KEY);

  if (mode === 'start') {
    if (!body.fullResync && priorState?.last_sync_at) updatedAtMin = priorState.last_sync_at;
    await markRunning(supabase, SOURCE_KEY, JSON.stringify({ pageInfo: null, since: updatedAtMin || null }), 0);
  } else {
    try {
      const parsed = JSON.parse(priorState?.last_cursor || '{}');
      pageInfo = parsed.pageInfo || null;
      updatedAtMin = parsed.since || undefined;
    } catch {
      pageInfo = priorState?.last_cursor && priorState.last_cursor !== 'first' ? priorState.last_cursor : null;
    }
    totalProcessed = priorState?.records_synced || 0;
  }

  if (await shouldCancel(supabase, SOURCE_KEY)) {
    await markCancelled(supabase, SOURCE_KEY);
    return json({ status: 'cancelled', processedThisPage: 0, totalProcessed, hasMore: false });
  }

  const params: Record<string, string> = { limit: String(PAGE_SIZE) };
  if (pageInfo) {
    params.page_info = pageInfo;
  } else if (updatedAtMin) {
    params.updated_at_min = updatedAtMin;
  }

  const res = await shopifyFetch<ShopifyCustomersResponse>('/customers.json', params);

  if (res.status === 429) {
    const retryAfter = res.retryAfter || 4;
    await markError(supabase, SOURCE_KEY, `rate_limited: retry in ${retryAfter}s`);
    await markRunning(supabase, SOURCE_KEY, pageInfo || 'first', 0);
    EdgeRuntime.waitUntil(chainNext(FN_NAME, { mode: 'continue' }, retryAfter));
    return json({ status: 'rate_limited', processedThisPage: 0, totalProcessed, hasMore: true, rateLimit: { retryAfterSeconds: retryAfter } });
  }

  if (!res.ok) {
    await markError(supabase, SOURCE_KEY, `Shopify ${res.status}: ${(res.errorText || '').slice(0, 200)}`);
    return json({ status: 'error', error: `Shopify API ${res.status}`, processedThisPage: 0, totalProcessed, hasMore: false });
  }

  const customers = res.data?.customers || [];
  const nearLimit = res.apiCallLimit && (res.apiCallLimit.used / res.apiCallLimit.max) > 0.8;
  const nextDelay = nearLimit ? 10 : 1;

  if (customers.length === 0) {
    await markComplete(supabase, SOURCE_KEY, 0);
    return json({ status: 'completed', processedThisPage: 0, totalProcessed, hasMore: false });
  }

  const now = new Date().toISOString();

  // Filter customers without email — schema requires it
  const valid = customers.filter(c => c.email);

  const externalIds = valid.map(c => String(c.id));
  const { data: existing } = await supabase
    .from('customers').select('id, external_id')
    .in('external_id', externalIds);
  const existingByExtId = new Map<string, string>();
  for (const e of existing || []) existingByExtId.set(e.external_id as string, e.id as string);

  const toInsert: Record<string, unknown>[] = [];
  const toUpdate: Array<{ id: string; payload: Record<string, unknown> }> = [];

  for (const c of valid) {
    const payload: Record<string, unknown> = {
      external_id: String(c.id),
      first_name: c.first_name || null,
      last_name: c.last_name || null,
      email: c.email!,
      phone: c.phone || null,
      total_spent: c.total_spent ? Number(c.total_spent) : 0,
      orders_count: c.orders_count || 0,
      tags: c.tags ? c.tags.split(',').map(t => t.trim()).filter(Boolean) : [],
      default_address_city: c.default_address?.city || null,
      default_address_province: c.default_address?.province || null,
      source_platform: 'shopify',
      last_synced_at: now,
      raw_payload: c,
      updated_date: now,
    };
    const existingId = existingByExtId.get(String(c.id));
    if (existingId) {
      toUpdate.push({ id: existingId, payload });
    } else {
      toInsert.push({ id: crypto.randomUUID(), ...payload, created_date: now });
    }
  }

  if (toInsert.length) await supabase.from('customers').insert(toInsert);
  for (const u of toUpdate) await supabase.from('customers').update(u.payload).eq('id', u.id);

  const processedThisPage = customers.length;
  const newTotal = totalProcessed + processedThisPage;
  await markRunning(
    supabase, SOURCE_KEY,
    JSON.stringify({ pageInfo: res.nextPageInfo || null, since: updatedAtMin || null }),
    processedThisPage,
  );

  const hasMore = !!res.nextPageInfo;
  if (!hasMore) {
    await markComplete(supabase, SOURCE_KEY, 0);
    return json({ status: 'completed', processedThisPage, totalProcessed: newTotal, hasMore: false });
  }

  EdgeRuntime.waitUntil(chainNext(FN_NAME, { mode: 'continue' }, nextDelay));
  return json({
    status: nearLimit ? 'rate_limited' : 'running',
    processedThisPage,
    totalProcessed: newTotal,
    hasMore: true,
    rateLimit: nearLimit ? { retryAfterSeconds: nextDelay } : undefined,
    debug: { apiCallLimit: res.apiCallLimit },
  });
});
