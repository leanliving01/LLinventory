// extract-invoice — read ONE invoice's PDF, OpenAI-extract its line items, and
// CACHE them on purchase_invoices.extracted_lines. Every queue line for that
// invoice then reuses the cache instead of re-scanning the whole PDF (the old
// behaviour scanned the entire invoice once PER line — the slow, expensive bit).
//
// Body: { invoiceId, force? }  ->  { status, lines, cached }

import { getSupabase, corsHeaders, json } from '../_shared/xero.ts';
import { extractInvoiceData } from '../_shared/invoice-extract.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders() });

  let body: { invoiceId?: string; force?: boolean } = {};
  try { body = await req.json(); } catch { /* empty */ }
  const invoiceId = body.invoiceId;
  if (!invoiceId) return json({ status: 'error', error: 'invoiceId required' }, 400);

  const supabase = getSupabase();

  // Serve from cache unless forced.
  const { data: inv } = await supabase
    .from('purchase_invoices')
    .select('id, extracted_lines, extracted_at')
    .eq('id', invoiceId)
    .maybeSingle();
  if (!body.force && inv?.extracted_lines) {
    return json({ status: 'ok', lines: inv.extracted_lines, cached: true });
  }

  // Find a stored PDF/image for this invoice.
  const { data: atts } = await supabase
    .from('purchase_attachments')
    .select('file_url, mime_type')
    .eq('invoice_id', invoiceId);
  const att = (atts || []).find((a: any) => a.file_url);
  if (!att) return json({ status: 'error', error: 'no-pdf' }, 404);

  // Download + base64 (server-side, so the browser never moves the PDF).
  let fileBase64: string;
  try {
    const resp = await fetch(att.file_url);
    const bytes = new Uint8Array(await resp.arrayBuffer());
    let bin = '';
    const chunk = 8192;
    for (let i = 0; i < bytes.length; i += chunk) bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
    fileBase64 = btoa(bin);
  } catch (e) {
    return json({ status: 'error', error: 'fetch-failed: ' + String(e) }, 502);
  }

  const result = await extractInvoiceData(fileBase64, att.mime_type || 'application/pdf');
  if (result.error) return json({ status: 'error', error: result.error }, result.status || 502);

  const lines = result.data?.lines || [];
  await supabase.from('purchase_invoices')
    .update({ extracted_lines: lines, extracted_at: new Date().toISOString() })
    .eq('id', invoiceId);

  return json({ status: 'ok', lines, cached: false });
});
