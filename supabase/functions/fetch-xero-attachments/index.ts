// Fetch supplier-invoice PDFs that live as attachments on Xero bills and archive
// them in the `purchase-documents` Storage bucket + `purchase_attachments` table,
// linked to our invoice (and its PO / GRN when present).
//
// Xero never exposed these to the sync, so the original supplier document — which
// carries the real per-line quantities and unit prices — was unavailable. This
// backfills history and can be re-run for new bills.
//
// Modes:
//   { mode: 'start' | 'continue', batchSize?: number }  — walk all un-fetched bills
//   { invoiceId: '<our purchase_invoices.id>' }          — process a single bill
//
// Bills are marked purchase_invoices.attachments_fetched_at once processed (with
// or without an attachment) so they aren't re-polled. Self-chains in batches to
// stay within Xero's rate limit.

import { getSupabase, getValidTokens, XERO_API_BASE, corsHeaders, json } from '../_shared/xero.ts';
import { chainNext } from '../_shared/chain.ts';

const FN_NAME = 'fetch-xero-attachments';
const BUCKET = 'purchase-documents';
const DEFAULT_BATCH = 8;

interface InvoiceRow {
  id: string;
  xero_bill_id: string | null;
  purchase_order_id: string | null;
  grn_id: string | null;
}

interface XeroAttachment {
  AttachmentID: string;
  FileName: string;
  MimeType: string;
  ContentLength?: number;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders() });

  let body: { mode?: string; invoiceId?: string; batchSize?: number } = {};
  try { body = await req.json(); } catch { /* empty body ok */ }

  const supabase = getSupabase();
  const tokens = await getValidTokens(supabase);
  if (!tokens) return json({ status: 'error', error: 'Xero not connected. Connect in Settings.' }, 400);

  const xeroHeaders = (accept: string) => ({
    'Authorization': `Bearer ${tokens.access_token}`,
    'Xero-Tenant-Id': tokens.tenant_id,
    'Accept': accept,
  });

  // ── Single-invoice mode (go-forward, e.g. fired after a sync) ──────────────
  if (body.invoiceId) {
    const { data: inv } = await supabase
      .from('purchase_invoices')
      .select('id, xero_bill_id, purchase_order_id, grn_id')
      .eq('id', body.invoiceId)
      .maybeSingle();
    if (!inv) return json({ status: 'error', error: 'Invoice not found' }, 404);
    const result = await processInvoice(supabase, xeroHeaders, inv as InvoiceRow);
    return json({ status: 'completed', processed: 1, ...result });
  }

  // ── Batch mode (backfill) ─────────────────────────────────────────────────
  const batchSize = Math.max(1, Math.min(25, body.batchSize || DEFAULT_BATCH));
  const { data: invoices, error: qErr } = await supabase
    .from('purchase_invoices')
    .select('id, xero_bill_id, purchase_order_id, grn_id')
    .not('xero_bill_id', 'is', null)
    .is('attachments_fetched_at', null)
    .order('created_date', { ascending: false })
    .limit(batchSize);

  if (qErr) return json({ status: 'error', error: qErr.message }, 500);
  if (!invoices || invoices.length === 0) {
    return json({ status: 'completed', processed: 0, hasMore: false });
  }

  let imported = 0;
  let rateLimited = false;
  for (const inv of invoices as InvoiceRow[]) {
    const res = await processInvoice(supabase, xeroHeaders, inv);
    imported += res.imported;
    if (res.rateLimited) { rateLimited = true; break; }
  }

  // More to do? chain the next batch. On a rate limit, back off harder.
  const { count: remaining } = await supabase
    .from('purchase_invoices')
    .select('id', { count: 'exact', head: true })
    .not('xero_bill_id', 'is', null)
    .is('attachments_fetched_at', null);

  const hasMore = (remaining || 0) > 0;
  if (hasMore) {
    chainNext(FN_NAME, { mode: 'continue', batchSize }, rateLimited ? 60 : 2);
  }

  return json({ status: hasMore ? 'running' : 'completed', processed: invoices.length, imported, hasMore, remaining: remaining || 0 });
});

/**
 * Pull every attachment on one Xero bill, archive each, and mark the invoice
 * processed. Returns { imported, rateLimited }.
 */
async function processInvoice(
  supabase: ReturnType<typeof getSupabase>,
  xeroHeaders: (accept: string) => Record<string, string>,
  inv: InvoiceRow,
): Promise<{ imported: number; rateLimited: boolean }> {
  if (!inv.xero_bill_id) {
    await markFetched(supabase, inv.id);
    return { imported: 0, rateLimited: false };
  }

  // 1. List attachments on the bill.
  const listRes = await fetch(
    `${XERO_API_BASE}/Invoices/${inv.xero_bill_id}/Attachments`,
    { headers: xeroHeaders('application/json') },
  );
  if (listRes.status === 429) return { imported: 0, rateLimited: true };
  if (!listRes.ok) {
    // 404 / other → nothing we can do; mark so we don't keep retrying.
    await markFetched(supabase, inv.id);
    return { imported: 0, rateLimited: false };
  }

  const listData = await listRes.json().catch(() => ({}));
  const attachments: XeroAttachment[] = listData?.Attachments || [];
  let imported = 0;

  for (const att of attachments) {
    // Skip if we already have this Xero attachment.
    const { data: existing } = await supabase
      .from('purchase_attachments')
      .select('id')
      .eq('xero_attachment_id', att.AttachmentID)
      .maybeSingle();
    if (existing) continue;

    // 2. Download the binary.
    const mime = att.MimeType || 'application/octet-stream';
    const dlRes = await fetch(
      `${XERO_API_BASE}/Invoices/${inv.xero_bill_id}/Attachments/${att.AttachmentID}`,
      { headers: xeroHeaders(mime) },
    );
    if (dlRes.status === 429) return { imported, rateLimited: true };
    if (!dlRes.ok) continue;

    const bytes = new Uint8Array(await dlRes.arrayBuffer());

    // 3. Store in the bucket.
    const safeName = (att.FileName || `${att.AttachmentID}`).replace(/[^a-zA-Z0-9._-]/g, '_');
    const path = `xero/${inv.id}/${att.AttachmentID}-${safeName}`;
    const { error: upErr } = await supabase.storage
      .from(BUCKET)
      .upload(path, new Blob([bytes], { type: mime }), { contentType: mime, upsert: true });
    if (upErr) { console.error('[fetch-xero-attachments] upload failed:', upErr.message); continue; }

    const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(path);

    // 4. Row it.
    const now = new Date().toISOString();
    const { error: insErr } = await supabase.from('purchase_attachments').insert({
      id: crypto.randomUUID(),
      invoice_id: inv.id,
      purchase_order_id: inv.purchase_order_id,
      grn_id: inv.grn_id,
      source: 'xero',
      file_name: att.FileName || safeName,
      file_path: path,
      file_url: pub?.publicUrl || null,
      mime_type: mime,
      size_bytes: att.ContentLength ?? bytes.length,
      xero_attachment_id: att.AttachmentID,
      created_date: now,
      updated_date: now,
    });
    if (insErr && !String(insErr.message).includes('duplicate')) {
      console.error('[fetch-xero-attachments] insert failed:', insErr.message);
      continue;
    }
    imported++;
  }

  await markFetched(supabase, inv.id);
  return { imported, rateLimited: false };
}

async function markFetched(supabase: ReturnType<typeof getSupabase>, invoiceId: string) {
  await supabase
    .from('purchase_invoices')
    .update({ attachments_fetched_at: new Date().toISOString() })
    .eq('id', invoiceId);
}
