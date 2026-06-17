import { getSupabase, getValidTokens, XERO_API_BASE, corsHeaders, json } from '../_shared/xero.ts';
import {
  getSyncState, markRunning, markComplete, markError, markCancelled, shouldCancel,
} from '../_shared/sync-state.ts';
import { chainNext } from '../_shared/chain.ts';
import { startSyncLog, finishSyncLog } from '../_shared/sync-log.ts';

const SOURCE_KEY = 'xero_invoices';
const FN_NAME = 'sync-xero-invoices';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders() });

  let body: { mode?: 'start' | 'continue' | 'cancel'; sinceDate?: string; fullResync?: boolean } = {};
  try { body = await req.json(); } catch { /* empty body ok */ }
  const mode = body.mode || 'start';
  const supabase = getSupabase();

  // Cancel branch
  if (mode === 'cancel') {
    await markCancelled(supabase, SOURCE_KEY);
    return json({ status: 'cancelled', page: 0, processedThisPage: 0, totalProcessed: 0, hasMore: false });
  }

  // Determine cursor + cumulative count + since date for incremental sync
  let page = 1;
  let totalProcessed = 0;
  let sinceDate: string | undefined;

  const priorState = await getSyncState(supabase, SOURCE_KEY);

  let syncLogId: string | null = null;

  if (mode === 'start') {
    // Guard: reject concurrent starts unless it's a full resync (which intentionally overrides).
    // Auto-clear stale locks (>30 min) so a broken chain can't block forever.
    if (priorState?.sync_status === 'running' && !body.fullResync) {
      const staleCutoff = new Date(Date.now() - 30 * 60 * 1000);
      const lockedAt = priorState.updated_date ? new Date(priorState.updated_date) : null;
      if (!lockedAt || lockedAt < staleCutoff) {
        console.log('[sync-xero-invoices] Stale running lock detected — auto-clearing and restarting');
        await markCancelled(supabase, SOURCE_KEY);
      } else {
        return json({ status: 'error', error: 'Sync already in progress — wait for it to finish or cancel it first.', page: 0, processedThisPage: 0, totalProcessed: priorState.records_synced || 0, hasMore: false });
      }
    }
    // Incremental: use last_sync_at unless fullResync requested
    if (!body.fullResync && priorState?.last_sync_at) {
      sinceDate = priorState.last_sync_at;
    } else if (body.sinceDate) {
      sinceDate = body.sinceDate;
    }
    syncLogId = await startSyncLog(supabase, SOURCE_KEY, body.fullResync ? 'manual' : 'scheduled');
    await markRunning(supabase, SOURCE_KEY, JSON.stringify({ page: 1, since: sinceDate || null, logId: syncLogId }), 0);
  } else {
    // Continue: parse cursor JSON to recover page + since + logId
    try {
      const parsed = JSON.parse(priorState?.last_cursor || '{}');
      page = Number(parsed.page || 1);
      sinceDate = parsed.since || undefined;
      syncLogId = parsed.logId || null;
    } catch {
      page = Number(priorState?.last_cursor || '1');
    }
    totalProcessed = priorState?.records_synced || 0;
  }

  // Honour cancellation between pages
  if (await shouldCancel(supabase, SOURCE_KEY)) {
    await markCancelled(supabase, SOURCE_KEY);
    return json({ status: 'cancelled', page, processedThisPage: 0, totalProcessed, hasMore: false });
  }

  // Token
  const tokens = await getValidTokens(supabase);
  if (!tokens) {
    await markError(supabase, SOURCE_KEY, 'Xero not connected');
    return json({ status: 'error', error: 'Xero not connected. Please connect in Settings.', page, processedThisPage: 0, totalProcessed, hasMore: false });
  }

  // Fetch one page from Xero
  const params = new URLSearchParams({ where: 'Type=="ACCPAY"', page: String(page) });
  const url = `${XERO_API_BASE}/Invoices?${params}`;
  const headers: Record<string, string> = {
    'Authorization': `Bearer ${tokens.access_token}`,
    'Xero-Tenant-Id': tokens.tenant_id,
    'Accept': 'application/json',
  };
  if (sinceDate) headers['If-Modified-Since'] = new Date(sinceDate).toUTCString();

  const xeroRes = await fetch(url, { headers });

  // Rate limit handling — preserve full cursor so resume picks up correct page/since/logId
  if (xeroRes.status === 429) {
    const retryAfter = Number(xeroRes.headers.get('Retry-After') || '60');
    await markError(supabase, SOURCE_KEY, `rate_limited: retry in ${retryAfter}s`);
    await markRunning(supabase, SOURCE_KEY, JSON.stringify({ page, since: sinceDate || null, logId: syncLogId }), 0);
    EdgeRuntime.waitUntil(chainNext(FN_NAME, { mode: 'continue' }, retryAfter));
    return json({ status: 'rate_limited', page, processedThisPage: 0, totalProcessed, hasMore: true, rateLimit: { retryAfterSeconds: retryAfter } });
  }

  if (!xeroRes.ok) {
    const errText = await xeroRes.text();
    await markError(supabase, SOURCE_KEY, `Xero ${xeroRes.status}: ${errText.slice(0, 200)}`);
    return json({ status: 'error', error: `Xero API ${xeroRes.status}: ${errText.slice(0, 200)}`, page, processedThisPage: 0, totalProcessed, hasMore: false });
  }

  const data = await xeroRes.json();
  const invoices: XeroInvoice[] = data.Invoices || [];

  const minRem = Number(xeroRes.headers.get('X-MinLimit-Remaining') || '60');
  const dayRem = Number(xeroRes.headers.get('X-DayLimit-Remaining') || '5000');
  const nearLimit = minRem > 0 && minRem < 5;
  const nextDelay = nearLimit ? 60 : 1;

  // Empty page = we're done
  if (invoices.length === 0) {
    await markComplete(supabase, SOURCE_KEY, 0);
    return json({ status: 'completed', page, processedThisPage: 0, totalProcessed, hasMore: false });
  }

  // ── BULK PROCESSING ──────────────────────────────────────────────────────
  const now = new Date().toISOString();

  // Pre-load all suppliers
  const { data: allSuppliers } = await supabase.from('suppliers').select('id, name, xero_contact_id');
  const supplierByXeroId = new Map<string, { id: string; name: string }>();
  const supplierByName = new Map<string, { id: string; name: string }>();
  for (const s of allSuppliers || []) {
    if (s.xero_contact_id) supplierByXeroId.set(s.xero_contact_id, s);
    supplierByName.set((s.name as string).toLowerCase().trim(), s);
  }

  // Collect Xero contacts that don't match any supplier in our system.
  // We do NOT auto-create suppliers — ops managers must create them manually.
  // Unmatched contacts are logged to xero_unmatched_contacts for review.
  const unmatchedContacts: Array<{ xero_contact_id: string; xero_name: string }> = [];
  for (const inv of invoices) {
    const cid = inv.Contact?.ContactID || '';
    const name = (inv.Contact?.Name || '').trim();
    if (!name || !cid) continue;
    if (supplierByXeroId.has(cid)) continue;
    if (supplierByName.has(name.toLowerCase())) continue;
    // Partial match check
    let matched = false;
    for (const [key] of supplierByName) {
      if (name.toLowerCase().includes(key) || key.includes(name.toLowerCase())) { matched = true; break; }
    }
    if (matched) continue;
    unmatchedContacts.push({ xero_contact_id: cid, xero_name: name });
  }
  // Upsert unmatched contacts — on conflict update last_seen_at only
  if (unmatchedContacts.length) {
    const rows = unmatchedContacts.map(uc => ({
      id: crypto.randomUUID(),
      xero_contact_id: uc.xero_contact_id,
      xero_name: uc.xero_name,
      last_seen_at: now,
      created_date: now,
      updated_date: now,
      invoice_count: 1,
    }));
    // Use raw upsert; the unique index on xero_contact_id handles deduplication
    await supabase.from('xero_unmatched_contacts').upsert(rows, { onConflict: 'xero_contact_id' });
  }

  // Resolve supplier for each invoice
  const resolved: Array<{ inv: XeroInvoice; supplier: { id: string; name: string } }> = [];
  for (const inv of invoices) {
    const cid = inv.Contact?.ContactID || '';
    const name = (inv.Contact?.Name || '').trim();
    let supplier = supplierByXeroId.get(cid);
    if (!supplier && name) supplier = supplierByName.get(name.toLowerCase());
    if (!supplier && name) {
      for (const [key, val] of supplierByName) {
        if (name.toLowerCase().includes(key) || key.includes(name.toLowerCase())) { supplier = val; break; }
      }
    }
    if (supplier) resolved.push({ inv, supplier });
  }

  // Backfill xero_contact_id for newly-matched suppliers
  for (const { inv, supplier } of resolved) {
    const cid = inv.Contact?.ContactID;
    if (cid && !supplierByXeroId.has(cid)) {
      await supabase.from('suppliers').update({ xero_contact_id: cid }).eq('id', supplier.id);
      supplierByXeroId.set(cid, supplier);
    }
  }

  // Bulk fetch existing invoices for this page
  const xeroBillIds = resolved.map(r => r.inv.InvoiceID);
  const { data: existingRows } = await supabase
    .from('purchase_invoices')
    .select('id, xero_bill_id')
    .in('xero_bill_id', xeroBillIds);
  const existingByXeroId = new Map<string, string>();
  for (const e of existingRows || []) existingByXeroId.set(e.xero_bill_id as string, e.id as string);

  // Partition into insert / update
  const toInsert: Record<string, unknown>[] = [];
  const toUpdate: Array<{ id: string; payload: Record<string, unknown> }> = [];
  const invoiceIdMap = new Map<string, string>(); // xero_bill_id → our invoice id

  for (const { inv, supplier } of resolved) {
    const payload = {
      xero_bill_id: inv.InvoiceID,
      invoice_number: inv.InvoiceNumber || inv.InvoiceID,
      supplier_id: supplier.id,
      supplier_name: supplier.name,
      invoice_date: inv.DateString?.split('T')[0] || null,
      due_date: inv.DueDateString?.split('T')[0] || null,
      status: mapXeroInvoiceStatus(inv.Status),
      subtotal: inv.SubTotal || 0,
      tax_amount: inv.TotalTax || 0,
      total: inv.Total || 0,
      currency: inv.CurrencyCode || 'ZAR',
      source: 'xero_sync',
      updated_date: now,
    };
    const existingId = existingByXeroId.get(inv.InvoiceID);
    if (existingId) {
      toUpdate.push({ id: existingId, payload });
      invoiceIdMap.set(inv.InvoiceID, existingId);
    } else {
      const newId = crypto.randomUUID();
      toInsert.push({ id: newId, ...payload, created_date: now });
      invoiceIdMap.set(inv.InvoiceID, newId);
    }
  }

  const allInvoiceRows = [
    ...toInsert,
    ...toUpdate.map(u => ({ id: u.id, ...u.payload })),
  ];
  if (allInvoiceRows.length) await supabase.from('purchase_invoices').upsert(allInvoiceRows, { onConflict: 'id' });

  // Bulk delete + bulk insert line items for this page's invoices
  const affectedInvoiceIds = Array.from(invoiceIdMap.values());
  if (affectedInvoiceIds.length) {
    await supabase.from('purchase_invoice_lines').delete().in('invoice_id', affectedInvoiceIds);
  }

  const allLines: Record<string, unknown>[] = [];
  for (const { inv } of resolved) {
    const ourInvoiceId = invoiceIdMap.get(inv.InvoiceID);
    if (!ourInvoiceId || !inv.LineItems?.length) continue;
    for (const l of inv.LineItems) {
      allLines.push({
        id: crypto.randomUUID(),
        invoice_id: ourInvoiceId,
        xero_line_item_id: l.LineItemID || '',
        xero_item_code: l.ItemCode || '',
        xero_description: l.Description || '',
        qty: l.Quantity || 0,
        unit_cost: l.UnitAmount || 0,
        line_total: l.LineAmount || 0,
        account_code: l.AccountCode || '',
        match_status: 'unmatched',
        created_date: now,
        updated_date: now,
      });
    }
  }
  if (allLines.length) await supabase.from('purchase_invoice_lines').insert(allLines);

  // ── PROGRESS + CHAIN ────────────────────────────────────────────────────
  const processedThisPage = invoices.length;
  const newTotal = totalProcessed + processedThisPage;
  await markRunning(supabase, SOURCE_KEY, JSON.stringify({ page: page + 1, since: sinceDate || null, logId: syncLogId }), processedThisPage);

  const hasMore = invoices.length === 100;

  if (!hasMore) {
    await markComplete(supabase, SOURCE_KEY, 0); // already counted via markRunning
    if (syncLogId) {
      await finishSyncLog(supabase, syncLogId, 'completed', {
        records_fetched: newTotal,
        records_created: toInsert.length,
        records_updated: toUpdate.length,
      });
    }
    return json({ status: 'completed', page, processedThisPage, totalProcessed: newTotal, hasMore: false });
  }

  EdgeRuntime.waitUntil(chainNext(FN_NAME, { mode: 'continue' }, nextDelay));

  return json({
    status: nearLimit ? 'rate_limited' : 'running',
    page,
    processedThisPage,
    totalProcessed: newTotal,
    hasMore: true,
    rateLimit: nearLimit ? { retryAfterSeconds: nextDelay } : undefined,
    debug: { minRem, dayRem },
  });
});

function mapXeroInvoiceStatus(s: string): string {
  switch (s) {
    case 'DRAFT':      return 'pending_match';
    case 'SUBMITTED':  return 'pending_match';
    case 'AUTHORISED': return 'approved';
    case 'PAID':       return 'approved';
    case 'VOIDED':     return 'disputed';
    default:           return 'pending_match';
  }
}

interface XeroInvoice {
  InvoiceID: string;
  InvoiceNumber?: string;
  Contact?: { ContactID: string; Name: string };
  DateString?: string;
  DueDateString?: string;
  Status: string;
  SubTotal: number;
  TotalTax: number;
  Total: number;
  CurrencyCode?: string;
  LineItems?: XeroLineItem[];
}

interface XeroLineItem {
  LineItemID?: string;
  Description?: string;
  ItemCode?: string;
  Quantity?: number;
  UnitAmount?: number;
  LineAmount?: number;
  AccountCode?: string;
}
