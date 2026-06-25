// Recover correct per-line quantities and unit prices from the archived supplier
// PDF, for invoices whose lines were collapsed at the source (typically Xero
// bills booked as "1 × line-total"). Reads each stored PDF through OpenAI (same
// logic as the live scanner), matches the extracted lines to our invoice lines
// by description / item code, and corrects qty + unit_cost + unit while keeping
// line_total (so the invoice total never changes).
//
// SAFE BY DEFAULT — dry-run unless told to apply:
//   { mode: 'dryrun', batchSize?, invoiceId? }  → returns proposed changes, writes nothing
//   { mode: 'apply',  batchSize?, invoiceId? }   → applies confident changes, marks repriced_at
//
// Only matches with confidence >= MIN_CONFIDENCE are auto-applied; everything
// else is reported for manual review. Idempotent via purchase_invoices.repriced_at.

import { getSupabase, corsHeaders, json } from '../_shared/xero.ts';
import { chainNext } from '../_shared/chain.ts';
import { extractInvoiceData, bytesToBase64, num } from '../_shared/invoice-extract.ts';

const FN_NAME = 'reprice-from-attachments';
const BUCKET = 'purchase-documents';
const DEFAULT_BATCH = 4;          // OpenAI call per invoice — keep batches small
const MIN_CONFIDENCE = 0.5;       // token-overlap threshold to auto-apply

const norm = (s: string) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const tokenize = (s: string) => (s || '').toLowerCase().split(/[^a-z0-9]+/).filter(t => t.length > 2);

function overlap(a: string, b: string): number {
  const setA = new Set(tokenize(a));
  const listB = tokenize(b);
  if (!setA.size || !listB.length) return 0;
  const hits = listB.filter(t => setA.has(t)).length;
  return hits / Math.max(setA.size, listB.length);
}

interface Line {
  id: string;
  xero_item_code: string | null;
  xero_description: string | null;
  qty: number | null;
  unit: string | null;
  unit_cost: number | null;
  line_total: number | null;
  product_id: string | null;
  supplier_product_id: string | null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders() });

  let body: { mode?: string; batchSize?: number; invoiceId?: string } = {};
  try { body = await req.json(); } catch { /* empty ok */ }
  const apply = body.mode === 'apply';
  const supabase = getSupabase();

  // Which invoices to consider: those with an archived document, not yet repriced.
  let invoiceIds: string[] = [];
  if (body.invoiceId) {
    invoiceIds = [body.invoiceId];
  } else {
    const { data: atts } = await supabase
      .from('purchase_attachments')
      .select('invoice_id')
      .in('source', ['xero', 'native'])
      .not('invoice_id', 'is', null)
      .limit(5000);
    const candidate = Array.from(new Set((atts || []).map((a: any) => a.invoice_id)));
    if (candidate.length) {
      const { data: invs } = await supabase
        .from('purchase_invoices')
        .select('id')
        .in('id', candidate)
        .is('repriced_at', null)
        .limit(5000);
      invoiceIds = (invs || []).map((i: any) => i.id);
    }
  }

  const batchSize = Math.max(1, Math.min(15, body.batchSize || DEFAULT_BATCH));
  const batch = invoiceIds.slice(0, batchSize);
  const report: any[] = [];
  let changedLines = 0;

  for (const invId of batch) {
    const res = await repriceInvoice(supabase, invId, apply);
    report.push(res);
    changedLines += res.changes.filter((c: any) => c.willApply).length;
  }

  const remaining = Math.max(0, invoiceIds.length - batch.length);
  const hasMore = !body.invoiceId && remaining > 0;
  if (hasMore && apply) {
    chainNext(FN_NAME, { mode: 'apply', batchSize }, 2);
  }

  return json({
    status: hasMore && apply ? 'running' : 'completed',
    mode: apply ? 'apply' : 'dryrun',
    processed: batch.length,
    remaining,
    hasMore,
    changedLines,
    report,
  });
});

async function repriceInvoice(supabase: ReturnType<typeof getSupabase>, invoiceId: string, apply: boolean) {
  const out: any = { invoiceId, changes: [], note: '' };

  // Pick the best archived document for this invoice (prefer Xero PDF/image).
  const { data: atts } = await supabase
    .from('purchase_attachments')
    .select('*')
    .eq('invoice_id', invoiceId)
    .in('source', ['xero', 'native']);
  const att = (atts || [])
    .filter((a: any) => a.file_path)
    .sort((a: any, b: any) => (a.source === 'xero' ? -1 : 1))[0];
  if (!att) { out.note = 'no archived document'; if (apply) await markRepriced(supabase, invoiceId); return out; }

  // Download the file from storage.
  const { data: blob, error: dlErr } = await supabase.storage.from(BUCKET).download(att.file_path);
  if (dlErr || !blob) { out.note = 'download failed'; return out; }
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const fileBase64 = bytesToBase64(bytes);

  // Extract true line items from the PDF.
  const extracted = await extractInvoiceData(fileBase64, att.mime_type || 'application/pdf');
  if (extracted.error || !extracted.data?.lines?.length) {
    out.note = 'extraction failed: ' + (extracted.error || 'no lines');
    return out;
  }
  const exLines: any[] = extracted.data.lines;

  // Load our invoice lines.
  const { data: ourLines } = await supabase
    .from('purchase_invoice_lines')
    .select('id, xero_item_code, xero_description, qty, unit, unit_cost, line_total, product_id, supplier_product_id')
    .eq('invoice_id', invoiceId);
  if (!ourLines?.length) { out.note = 'no invoice lines'; if (apply) await markRepriced(supabase, invoiceId); return out; }

  // Greedy 1:1 match each of our lines to the best extracted line.
  const usedEx = new Set<number>();
  for (const line of ourLines as Line[]) {
    let bestIdx = -1, bestScore = 0;
    for (let i = 0; i < exLines.length; i++) {
      if (usedEx.has(i)) continue;
      const ex = exLines[i];
      let score = overlap(line.xero_description || '', ex.description || '');
      if (line.xero_item_code && ex.item_code && norm(line.xero_item_code) === norm(ex.item_code)) {
        score = Math.max(score, 0.95);
      }
      if (score > bestScore) { bestScore = score; bestIdx = i; }
    }
    if (bestIdx < 0 || bestScore < MIN_CONFIDENCE) continue;

    const ex = exLines[bestIdx];
    const newQty = num(ex.qty);
    const newUnit = ex.unit || line.unit || null;
    const newCost = num(ex.unit_price);
    const newTotal = num(ex.line_total);
    if (newQty == null || newCost == null) continue;

    // Only a change worth making if qty or unit_cost differs materially.
    const qtyDiff = Math.abs((line.qty ?? 0) - newQty) > 0.001;
    const costDiff = Math.abs((line.unit_cost ?? 0) - newCost) > Math.max(0.02 * Math.abs(newCost), 0.01);
    if (!qtyDiff && !costDiff) { usedEx.add(bestIdx); continue; }

    // Guard: the corrected line total should still match what was billed. If the
    // PDF line total diverges from our stored total by >2%, skip (likely a
    // mismatched line or a Xero line that bundles several PDF rows).
    const ourTotal = line.line_total ?? ((line.qty ?? 0) * (line.unit_cost ?? 0));
    if (newTotal != null && ourTotal && Math.abs(newTotal - ourTotal) > Math.max(0.02 * Math.abs(ourTotal), 0.01)) {
      out.changes.push({
        lineId: line.id, description: line.xero_description, confidence: round2(bestScore),
        skipped: 'line-total mismatch', from: { qty: line.qty, unit_cost: line.unit_cost, line_total: line.line_total },
        to: { qty: newQty, unit_cost: newCost, line_total: newTotal }, willApply: false,
      });
      usedEx.add(bestIdx);
      continue;
    }

    usedEx.add(bestIdx);
    const change = {
      lineId: line.id,
      description: line.xero_description,
      confidence: round2(bestScore),
      from: { qty: line.qty, unit: line.unit, unit_cost: line.unit_cost, line_total: line.line_total },
      to: { qty: newQty, unit: newUnit, unit_cost: newCost, line_total: newTotal ?? ourTotal },
      willApply: true,
    };
    out.changes.push(change);

    if (apply) {
      await supabase.from('purchase_invoice_lines').update({
        qty: newQty,
        unit: newUnit,
        unit_cost: newCost,
        line_total: newTotal ?? ourTotal,
        updated_date: new Date().toISOString(),
      }).eq('id', line.id);

      // Keep the supplier's last price in sync if this line is already linked.
      if (line.supplier_product_id) {
        await supabase.from('supplier_products')
          .update({ last_purchase_price: newCost, updated_date: new Date().toISOString() })
          .eq('id', line.supplier_product_id);
      }
    }
  }

  if (apply) await markRepriced(supabase, invoiceId);
  return out;
}

async function markRepriced(supabase: ReturnType<typeof getSupabase>, invoiceId: string) {
  await supabase.from('purchase_invoices')
    .update({ repriced_at: new Date().toISOString() })
    .eq('id', invoiceId);
}

const round2 = (n: number) => Math.round(n * 100) / 100;
