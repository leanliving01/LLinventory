import { getSupabase, getValidTokens, XERO_API_BASE, corsHeaders, json } from '../_shared/xero.ts';
import {
  getSyncState, markRunning, markComplete, markError, markCancelled, shouldCancel,
} from '../_shared/sync-state.ts';
import { chainNext } from '../_shared/chain.ts';
import { startSyncLog, finishSyncLog } from '../_shared/sync-log.ts';

const SOURCE_KEY = 'xero_purchase_orders';
const FN_NAME = 'sync-xero-purchase-orders';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders() });

  let body: { mode?: 'start' | 'continue' | 'cancel'; fullResync?: boolean; sinceDate?: string } = {};
  try { body = await req.json(); } catch { /* empty body ok */ }
  const mode = body.mode || 'start';
  const supabase = getSupabase();

  if (mode === 'cancel') {
    await markCancelled(supabase, SOURCE_KEY);
    return json({ status: 'cancelled', page: 0, processedThisPage: 0, totalProcessed: 0, hasMore: false });
  }

  let page = 1;
  let totalProcessed = 0;
  let sinceDate: string | undefined;
  let syncLogId: string | null = null;

  const priorState = await getSyncState(supabase, SOURCE_KEY);

  if (mode === 'start') {
    // Guard: reject concurrent starts unless it's a full resync (which intentionally overrides)
    if (priorState?.sync_status === 'running' && !body.fullResync) {
      return json({ status: 'error', error: 'Sync already in progress — wait for it to finish or cancel it first.', page: 0, processedThisPage: 0, totalProcessed: priorState.records_synced || 0, hasMore: false });
    }
    if (!body.fullResync && priorState?.last_sync_at) {
      sinceDate = priorState.last_sync_at;
    } else if (body.sinceDate) {
      sinceDate = body.sinceDate;
    }
    const newLogId = await startSyncLog(supabase, SOURCE_KEY, body.fullResync ? 'manual' : 'scheduled');
    syncLogId = newLogId;
    await markRunning(supabase, SOURCE_KEY, JSON.stringify({ page: 1, since: sinceDate || null, logId: newLogId }), 0);
  } else {
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

  if (await shouldCancel(supabase, SOURCE_KEY)) {
    await markCancelled(supabase, SOURCE_KEY);
    return json({ status: 'cancelled', page, processedThisPage: 0, totalProcessed, hasMore: false });
  }

  const tokens = await getValidTokens(supabase);
  if (!tokens) {
    await markError(supabase, SOURCE_KEY, 'Xero not connected');
    return json({ status: 'error', error: 'Xero not connected. Please connect in Settings.', page, processedThisPage: 0, totalProcessed, hasMore: false });
  }

  const url = `${XERO_API_BASE}/PurchaseOrders?page=${page}`;
  const headers: Record<string, string> = {
    'Authorization': `Bearer ${tokens.access_token}`,
    'Xero-Tenant-Id': tokens.tenant_id,
    'Accept': 'application/json',
  };
  if (sinceDate) headers['If-Modified-Since'] = new Date(sinceDate).toUTCString();
  const xeroRes = await fetch(url, { headers });

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
  const pos: XeroPO[] = data.PurchaseOrders || [];

  const minRem = Number(xeroRes.headers.get('X-MinLimit-Remaining') || '60');
  const dayRem = Number(xeroRes.headers.get('X-DayLimit-Remaining') || '5000');
  const nearLimit = minRem > 0 && minRem < 5;
  const nextDelay = nearLimit ? 60 : 1;

  if (pos.length === 0) {
    await markComplete(supabase, SOURCE_KEY, 0);
    return json({ status: 'completed', page, processedThisPage: 0, totalProcessed, hasMore: false });
  }

  const now = new Date().toISOString();

  // Pre-load suppliers
  const { data: allSuppliers } = await supabase.from('suppliers').select('id, name, xero_contact_id');
  const supplierByXeroId = new Map<string, { id: string; name: string }>();
  const supplierByName = new Map<string, { id: string; name: string }>();
  for (const s of allSuppliers || []) {
    if (s.xero_contact_id) supplierByXeroId.set(s.xero_contact_id, s);
    supplierByName.set((s.name as string).toLowerCase().trim(), s);
  }

  // Auto-create missing suppliers in bulk
  const newSupplierRows: Record<string, unknown>[] = [];
  const seen = new Set<string>();
  for (const xpo of pos) {
    const cid = xpo.Contact?.ContactID || '';
    const name = (xpo.Contact?.Name || '').trim();
    if (!name) continue;
    if (supplierByXeroId.has(cid)) continue;
    if (supplierByName.has(name.toLowerCase())) continue;
    if (seen.has(cid)) continue;
    let matched = false;
    for (const [key] of supplierByName) {
      if (name.toLowerCase().includes(key) || key.includes(name.toLowerCase())) { matched = true; break; }
    }
    if (matched) continue;
    seen.add(cid);
    newSupplierRows.push({
      id: crypto.randomUUID(),
      name,
      xero_contact_id: cid,
      status: 'active',
      created_date: now,
      updated_date: now,
    });
  }
  if (newSupplierRows.length) {
    const { data: created } = await supabase.from('suppliers').insert(newSupplierRows).select('id, name, xero_contact_id');
    for (const s of created || []) {
      if (s.xero_contact_id) supplierByXeroId.set(s.xero_contact_id as string, { id: s.id as string, name: s.name as string });
      supplierByName.set((s.name as string).toLowerCase().trim(), { id: s.id as string, name: s.name as string });
    }
  }

  // Resolve supplier for each PO
  const resolved: Array<{ xpo: XeroPO; supplier: { id: string; name: string } }> = [];
  for (const xpo of pos) {
    const cid = xpo.Contact?.ContactID || '';
    const name = (xpo.Contact?.Name || '').trim();
    let supplier = supplierByXeroId.get(cid);
    if (!supplier && name) supplier = supplierByName.get(name.toLowerCase());
    if (!supplier && name) {
      for (const [key, val] of supplierByName) {
        if (name.toLowerCase().includes(key) || key.includes(name.toLowerCase())) { supplier = val; break; }
      }
    }
    if (supplier) resolved.push({ xpo, supplier });
  }

  // Backfill xero_contact_id
  for (const { xpo, supplier } of resolved) {
    const cid = xpo.Contact?.ContactID;
    if (cid && !supplierByXeroId.has(cid)) {
      await supabase.from('suppliers').update({ xero_contact_id: cid }).eq('id', supplier.id);
      supplierByXeroId.set(cid, supplier);
    }
  }

  // Bulk fetch existing POs
  const xeroPoIds = resolved.map(r => r.xpo.PurchaseOrderID);
  const { data: existingRows } = await supabase
    .from('purchase_orders')
    .select('id, xero_po_id')
    .in('xero_po_id', xeroPoIds);
  const existingByXeroId = new Map<string, string>();
  for (const e of existingRows || []) existingByXeroId.set(e.xero_po_id as string, e.id as string);

  const toInsert: Record<string, unknown>[] = [];
  const toUpdate: Array<{ id: string; payload: Record<string, unknown> }> = [];
  const poIdMap = new Map<string, string>();

  for (const { xpo, supplier } of resolved) {
    const payload = {
      xero_po_id: xpo.PurchaseOrderID,
      po_number: xpo.PurchaseOrderNumber || xpo.PurchaseOrderID,
      supplier_id: supplier.id,
      supplier_name: supplier.name,
      order_date: xpo.DateString?.split('T')[0] || null,
      expected_date: xpo.DeliveryDateString?.split('T')[0] || null,
      status: mapXeroPoStatus(xpo.Status),
      subtotal: xpo.SubTotal || 0,
      tax_amount: xpo.TotalTax || 0,
      total: xpo.Total || 0,
      currency: xpo.CurrencyCode || 'ZAR',
      notes: xpo.Reference || '',
      source: 'xero',
      updated_date: now,
    };
    const existingId = existingByXeroId.get(xpo.PurchaseOrderID);
    if (existingId) {
      toUpdate.push({ id: existingId, payload });
      poIdMap.set(xpo.PurchaseOrderID, existingId);
    } else {
      const newId = crypto.randomUUID();
      toInsert.push({ id: newId, ...payload, created_date: now });
      poIdMap.set(xpo.PurchaseOrderID, newId);
    }
  }

  const allPoRows = [
    ...toInsert,
    ...toUpdate.map(u => ({ id: u.id, ...u.payload })),
  ];
  if (allPoRows.length) await supabase.from('purchase_orders').upsert(allPoRows, { onConflict: 'id' });

  // Bulk replace line items
  const affectedPoIds = Array.from(poIdMap.values());
  if (affectedPoIds.length) {
    await supabase.from('purchase_order_lines').delete().in('purchase_order_id', affectedPoIds);
  }

  const allLines: Record<string, unknown>[] = [];
  for (const { xpo } of resolved) {
    const ourPoId = poIdMap.get(xpo.PurchaseOrderID);
    if (!ourPoId || !xpo.LineItems?.length) continue;
    for (const l of xpo.LineItems) {
      const qty = l.Quantity || 0;
      const unitCost = l.UnitAmount || 0;
      allLines.push({
        id: crypto.randomUUID(),
        purchase_order_id: ourPoId,
        product_id: 'XERO_UNMATCHED',
        product_name: l.Description || '',
        product_sku: l.ItemCode || '',
        ordered_qty: qty,
        received_qty: 0,
        unit_cost: unitCost,
        line_total: qty * unitCost,
        purchase_uom: l.UnitOfMeasure || 'each',
        account_code: l.AccountCode || '',
        created_date: now,
        updated_date: now,
      });
    }
  }
  if (allLines.length) await supabase.from('purchase_order_lines').insert(allLines);

  const processedThisPage = pos.length;
  const newTotal = totalProcessed + processedThisPage;
  await markRunning(supabase, SOURCE_KEY, JSON.stringify({ page: page + 1, since: sinceDate || null, logId: syncLogId }), processedThisPage);

  const hasMore = pos.length === 100;

  if (!hasMore) {
    await markComplete(supabase, SOURCE_KEY, 0);
    if (syncLogId) await finishSyncLog(supabase, syncLogId, 'completed', { records_fetched: newTotal, records_created: toInsert.length, records_updated: toUpdate.length });
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

function mapXeroPoStatus(s: string): string {
  switch (s) {
    case 'DRAFT':      return 'draft';
    case 'SUBMITTED':  return 'awaiting_approval';
    case 'AUTHORISED': return 'approved';
    case 'BILLED':     return 'invoiced';
    case 'DELETED':    return 'cancelled';
    default:           return 'draft';
  }
}

interface XeroPO {
  PurchaseOrderID: string;
  PurchaseOrderNumber?: string;
  Contact?: { ContactID: string; Name: string };
  DateString?: string;
  DeliveryDateString?: string;
  Status: string;
  SubTotal: number;
  TotalTax: number;
  Total: number;
  CurrencyCode?: string;
  Reference?: string;
  LineItems?: XeroLineItem[];
}

interface XeroLineItem {
  LineItemID?: string;
  Description?: string;
  ItemCode?: string;
  Quantity?: number;
  UnitAmount?: number;
  UnitOfMeasure?: string;
  AccountCode?: string;
}
