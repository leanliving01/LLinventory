// match-review-queue — bulk pre-fill the Product Review Queue (PROPOSE-ONLY).
//
// For each unmatched supplier invoice line it produces ONE review_queue_proposals
// row: the correct catalogue product + a derived purchasing unit, ready for a
// one-click Approve. Nothing is committed automatically.
//
// Tiered, cheapest-first (so the LLM is rarely needed):
//   1. Exact supplier-SKU / item-code  -> method 'sku',       conf 1.0, no AI
//   2. Strong, unambiguous embedding    -> method 'embedding', conf=similarity, no LLM
//   3. Ambiguous embedding shortlist    -> grounded LLM pick FROM THE SHORTLIST ONLY
//   4. Nothing plausible                -> method 'none' (flagged "link manually")
//
// Catalogue must be embedded first (embed-products). Chains itself in batches.
// Body: { batchSize? }

import { getSupabase, corsHeaders, json } from '../_shared/xero.ts';
import { chainNext } from '../_shared/chain.ts';
import { embedBatch, toVectorLiteral, chatJSON, hasOpenAI } from '../_shared/openai.ts';
import { extractInvoiceData } from '../_shared/invoice-extract.ts';

const FN_NAME = 'match-review-queue';
const DEFAULT_BATCH = 5;       // unmatched lines per invocation — kept small so a
                               // single call (which may scan uncached invoice PDFs)
                               // always finishes well under the function/proxy time
                               // limit and writes its proposals. The client loop /
                               // self-chain drives through the whole queue.
const SHORTLIST = 15;          // candidates from the embedding index
const LLM_GROUP = 10;          // ambiguous items per LLM call
// Accept an embedding match outright (skip the LLM) only when it's both strong
// and clearly ahead of the runner-up — otherwise let the LLM adjudicate.
const STRONG_SIM = 0.62;
const CLEAR_GAP = 0.07;

const norm = (s: string) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const tok = (s: string) => (s || '').toLowerCase().split(/[^a-z0-9]+/).filter(t => t.length > 2);

// ── pack parsing → pack size/qty + conversion (1 purchase unit = X stock) ────
const MASS: Record<string, number> = { kg: 1000, kgs: 1000, g: 1, gr: 1, gram: 1, grams: 1, kilo: 1000, kilogram: 1000 };
const VOL: Record<string, number> = { l: 1000, lt: 1000, litre: 1000, liter: 1000, ml: 1 };

function normPackUnit(u: string): string {
  const k = u.toLowerCase();
  if (['kg', 'kgs', 'kilo', 'kilogram'].includes(k)) return 'kg';
  if (['g', 'gr', 'gram', 'grams'].includes(k)) return 'g';
  if (['l', 'lt', 'litre', 'liter'].includes(k)) return 'l';
  return k; // ml
}

// Parse "10 × 2kg" / "case of 6 × 500g" / "25kg" / "per kg" into pack components.
function parsePackParts(text: string): { packQty: number; packSize: number; packUnit: string } | null {
  if (!text) return null;
  const t = String(text).toLowerCase();
  const U = '(kg|kgs|g|gr|gram|grams|ml|l|lt|litre|liter)';
  let m = t.match(new RegExp(`(\\d+(?:\\.\\d+)?)\\s*[x×]\\s*(\\d+(?:\\.\\d+)?)\\s*${U}\\b`))
       || t.match(new RegExp(`(?:case|bale|bag|box|carton|pack|crate)\\s*of\\s*(\\d+)\\D*?(\\d+(?:\\.\\d+)?)\\s*${U}\\b`));
  if (m) return { packQty: parseFloat(m[1]), packSize: parseFloat(m[2]), packUnit: normPackUnit(m[3]) };
  m = t.match(new RegExp(`(\\d+(?:\\.\\d+)?)\\s*${U}\\b`));
  if (m) return { packQty: 1, packSize: parseFloat(m[1]), packUnit: normPackUnit(m[2]) };
  m = t.match(/\b(?:per|p)\s*[/.]?\s*(kg|kgs|kilo|kilogram|g|gram|grams|l|lt|litre|liter|ml)\b/)
   || t.match(/(?:^|\s)(kg|kgs|kilo|kilogram|g|gram|grams|l|lt|litre|liter|ml)(?:\s|$)/);
  if (m) return { packQty: 1, packSize: 1, packUnit: normPackUnit(m[1]) };
  return null;
}

// Map a messy invoice unit/description to a CLEAN Purchase UOM name that matches
// a seeded unit (packaging name or measurement code), so the dropdown pre-selects.
const PKG_KW: [string, string][] = [
  ['carton', 'Carton'], ['case', 'Case'], ['box', 'Box'], ['bag', 'Bag'],
  ['punnet', 'Punnet'], ['tray', 'Tray'], ['tub', 'Tub'], ['bucket', 'Tub'], ['bkt', 'Tub'],
  ['bottle', 'Bottle'], ['bott', 'Bottle'], ['bunch', 'Bunch'], ['packet', 'Packet'],
  ['pkt', 'Packet'], ['crate', 'Crate'], ['bale', 'Bale'], ['pocket', 'Pocket'], ['drum', 'Drum'],
];
function packagingName(text: string): string | null {
  const t = (text || '').toLowerCase();
  for (const [kw, name] of PKG_KW) if (t.includes(kw)) return name;
  return null;
}
function normMeasure(u: string): string | null {
  const k = (u || '').toLowerCase().replace(/[^a-z]/g, '');
  if (['kg', 'kgs', 'kilo', 'kilogram', 'perkg', 'pkg'].includes(k)) return 'kg';
  if (['g', 'gr', 'gram', 'grams'].includes(k)) return 'g';
  if (['l', 'lt', 'litre', 'liter'].includes(k)) return 'l';
  if (k === 'ml') return 'ml';
  if (['each', 'ea', 'pcs', 'pc', 'unit', 'units', 'piece', 'pieces'].includes(k)) return 'each';
  return null;
}

// Conversion factor from parsed pack parts into the product's stock unit.
function convFromParts(pk: { packQty: number; packSize: number; packUnit: string }, stockUom: string): number | null {
  const su = (stockUom || '').toLowerCase();
  const unit = pk.packUnit;
  let per: number | null = null;
  if (unit in MASS) { const g = pk.packSize * MASS[unit]; if (su === 'g') per = g; else if (su === 'kg') per = g / 1000; }
  else if (unit in VOL) { const ml = pk.packSize * VOL[unit]; if (su === 'ml') per = ml; else if (su === 'l') per = ml / 1000; }
  if (per == null) return null;
  return Math.round(per * pk.packQty * 10000) / 10000;
}

// Read (and cache) the extracted line items for an invoice.
async function getInvoiceLines(supabase: any, invoiceId: string): Promise<any[]> {
  const { data: inv } = await supabase.from('purchase_invoices')
    .select('extracted_lines').eq('id', invoiceId).maybeSingle();
  if (inv?.extracted_lines) return inv.extracted_lines;

  const { data: atts } = await supabase.from('purchase_attachments')
    .select('file_url, mime_type').eq('invoice_id', invoiceId);
  const att = (atts || []).find((a: any) => a.file_url);
  if (!att) return [];
  try {
    const resp = await fetch(att.file_url);
    const bytes = new Uint8Array(await resp.arrayBuffer());
    let bin = ''; const ch = 8192;
    for (let i = 0; i < bytes.length; i += ch) bin += String.fromCharCode(...bytes.subarray(i, i + ch));
    const result = await extractInvoiceData(btoa(bin), att.mime_type || 'application/pdf');
    if (result.error) return [];
    const lines = result.data?.lines || [];
    await supabase.from('purchase_invoices')
      .update({ extracted_lines: lines, extracted_at: new Date().toISOString() }).eq('id', invoiceId);
    return lines;
  } catch (e) { console.error(`[${FN_NAME}] extract ${invoiceId}:`, e); return []; }
}

// Pick the extracted PDF line that corresponds to a queue line.
function evidenceFor(exLines: any[], itemCode: string, desc: string) {
  const want = norm(itemCode);
  const wantToks = new Set(tok(desc));
  let best: any = null, bestScore = 0;
  for (const el of exLines) {
    if (want && norm(el.item_code) === want) return el;
    const b = tok(el.description);
    const hits = b.filter((t: string) => wantToks.has(t)).length;
    const sc = wantToks.size && b.length ? hits / Math.max(wantToks.size, b.length) : 0;
    if (sc > bestScore) { bestScore = sc; best = el; }
  }
  return best;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders() });
  if (!hasOpenAI()) return json({ status: 'error', error: 'OPENAI_API_KEY not configured' }, 500);

  let body: { batchSize?: number; noChain?: boolean } = {};
  try { body = await req.json(); } catch { /* empty */ }
  const batchSize = Math.max(1, Math.min(80, body.batchSize || DEFAULT_BATCH));
  const supabase = getSupabase();
  const now = new Date().toISOString();

  // Unmatched lines not yet AI-proposed.
  const { data: lines, error } = await supabase
    .from('purchase_invoice_lines')
    .select('id, invoice_id, xero_item_code, xero_description, qty, unit, unit_cost, line_total')
    .eq('match_status', 'unmatched')
    .is('ai_proposed_at', null)
    .order('id', { ascending: true })
    .limit(batchSize);
  if (error) return json({ status: 'error', error: error.message }, 500);
  if (!lines || lines.length === 0) return json({ status: 'completed', processed: 0, hasMore: false });

  // Invoice -> supplier context.
  const invIds = [...new Set(lines.map((l: any) => l.invoice_id).filter(Boolean))];
  const { data: invs } = await supabase.from('purchase_invoices')
    .select('id, supplier_id, supplier_name').in('id', invIds);
  const invById = new Map((invs || []).map((i: any) => [i.id, i]));

  // Supplier products for SKU short-circuit.
  const supplierIds = [...new Set((invs || []).map((i: any) => i.supplier_id).filter(Boolean))];
  const { data: sps } = supplierIds.length
    ? await supabase.from('supplier_products')
        .select('product_id, product_name, product_sku, supplier_id, supplier_sku, xero_item_code')
        .in('supplier_id', supplierIds).eq('active', true)
    : { data: [] };
  const spBySupplier = new Map<string, any[]>();
  for (const sp of (sps || [])) {
    const arr = spBySupplier.get(sp.supplier_id) || []; arr.push(sp); spBySupplier.set(sp.supplier_id, arr);
  }

  // Dedupe lines into unique items (supplier + sku|description); match each once,
  // then fan the proposal out to every member line.
  type Item = { key: string; lineIds: string[]; rep: any; supplierId: string; supplierName: string };
  const items = new Map<string, Item>();
  for (const l of lines) {
    const inv = invById.get(l.invoice_id);
    const supplierId = inv?.supplier_id || 'none';
    const idKey = norm(l.xero_item_code) || norm(l.xero_description) || l.id;
    const key = `${supplierId}|${idKey}`;
    let it = items.get(key);
    if (!it) { it = { key, lineIds: [], rep: l, supplierId, supplierName: inv?.supplier_name || '' }; items.set(key, it); }
    it.lineIds.push(l.id);
  }
  const uniques = [...items.values()];

  // Embed every unique description in one request.
  const vectors = await embedBatch(uniques.map(u => u.rep.xero_description || u.rep.xero_item_code || ''));

  // Decide a product for each unique item.
  type Decision = {
    item: Item; productId: string | null; productName: string | null; productSku: string | null;
    stockUom: string | null; confidence: number; method: string; reasoning: string;
  };
  const decisions: Decision[] = [];
  const ambiguous: { item: Item; idx: number; candidates: any[] }[] = [];

  for (let i = 0; i < uniques.length; i++) {
    const it = uniques[i];
    const code = norm(it.rep.xero_item_code);

    // 1) Exact supplier-SKU / item-code.
    let skuHit: any = null;
    for (const sp of (spBySupplier.get(it.supplierId) || [])) {
      if (code && (norm(sp.supplier_sku) === code || norm(sp.xero_item_code) === code)) { skuHit = sp; break; }
    }
    if (skuHit) {
      decisions.push({ item: it, productId: skuHit.product_id, productName: skuHit.product_name,
        productSku: skuHit.product_sku, stockUom: null, confidence: 1, method: 'sku',
        reasoning: 'Supplier SKU / item code matches an existing supplier product' });
      continue;
    }

    // 2) Embedding shortlist.
    let candidates: any[] = [];
    try {
      const { data } = await supabase.rpc('match_products', {
        query_embedding: toVectorLiteral(vectors[i]), match_count: SHORTLIST,
      });
      candidates = data || [];
    } catch (e) { console.error(`[${FN_NAME}] match_products:`, e); }

    if (!candidates.length) {
      decisions.push({ item: it, productId: null, productName: null, productSku: null, stockUom: null,
        confidence: 0, method: 'none', reasoning: 'No catalogue candidates' });
      continue;
    }
    const top = candidates[0], second = candidates[1];
    if (top.similarity >= STRONG_SIM && (!second || top.similarity - second.similarity >= CLEAR_GAP)) {
      decisions.push({ item: it, productId: top.id, productName: top.name, productSku: top.sku,
        stockUom: top.stock_uom, confidence: Math.min(1, top.similarity), method: 'embedding',
        reasoning: `Strong semantic match (${top.similarity.toFixed(2)})` });
    } else {
      const idx = decisions.length;
      decisions.push({ item: it, productId: null, productName: null, productSku: null, stockUom: null,
        confidence: 0, method: 'none', reasoning: 'pending-llm' }); // placeholder, filled below
      ambiguous.push({ item: it, idx, candidates });
    }
  }

  // 3) Grounded LLM adjudication for ambiguous items (batched).
  const SYSTEM = `You match a supplier invoice line to the correct EXISTING inventory product.
You are given the supplier's line and a SHORTLIST of candidate products — these are the ONLY valid choices.
Choose the candidate that is the SAME physical item. Synonyms count (e.g. "brinjal" = eggplant, "mealie" = corn).
If NONE of the candidates is clearly the same product, return product_id = null — do NOT guess. Never pick a
different food/item just because the names share a word ("lemon" is not "eggplant").
Return ONLY JSON: {"results":[{"line_id":string,"product_id":string|null,"confidence":number(0..1),"reasoning":string}]}.`;

  for (let g = 0; g < ambiguous.length; g += LLM_GROUP) {
    const group = ambiguous.slice(g, g + LLM_GROUP);
    const payload = group.map(a => ({
      line_id: a.item.key,
      supplier_description: a.item.rep.xero_description || '',
      supplier_sku: a.item.rep.xero_item_code || '',
      unit: a.item.rep.unit || '',
      candidates: a.candidates.map(c => ({ id: c.id, name: c.name, sku: c.sku, similarity: Number(c.similarity?.toFixed?.(3) ?? c.similarity) })),
    }));
    let results: any[] = [];
    try {
      const out = await chatJSON(SYSTEM, JSON.stringify({ lines: payload }), 4000);
      results = out?.results || [];
    } catch (e) { console.error(`[${FN_NAME}] llm:`, e); }
    const byLine = new Map(results.map((r: any) => [r.line_id, r]));
    for (const a of group) {
      const r = byLine.get(a.item.key);
      const cand = r?.product_id ? a.candidates.find(c => c.id === r.product_id) : null;
      if (cand) {
        decisions[a.idx] = { item: a.item, productId: cand.id, productName: cand.name, productSku: cand.sku,
          stockUom: cand.stock_uom, confidence: Math.max(0, Math.min(1, Number(r.confidence) || 0.7)),
          method: 'ai', reasoning: r.reasoning || 'LLM match' };
      } else {
        decisions[a.idx] = { item: a.item, productId: null, productName: null, productSku: null, stockUom: null,
          confidence: 0, method: 'none', reasoning: r?.reasoning || 'No confident match — link manually' };
      }
    }
  }

  // Stock UoM for products we matched via SKU (the shortlist already carries it).
  const needUom = decisions.filter(d => d.productId && !d.stockUom).map(d => d.productId as string);
  if (needUom.length) {
    const { data: prods } = await supabase.from('products').select('id, stock_uom').in('id', [...new Set(needUom)]);
    const uomById = new Map((prods || []).map((p: any) => [p.id, p.stock_uom]));
    for (const d of decisions) if (d.productId && !d.stockUom) d.stockUom = uomById.get(d.productId) || null;
  }

  // Build + write proposals (one row per member line), pulling evidence/conversion
  // from the cached invoice extraction.
  const exCache = new Map<string, any[]>();
  const proposalRows: any[] = [];
  for (const d of decisions) {
    const it = d.item;
    const invId = it.rep.invoice_id;
    if (invId && !exCache.has(invId)) exCache.set(invId, await getInvoiceLines(supabase, invId));
    const ev = evidenceFor(exCache.get(invId) || [], it.rep.xero_item_code, it.rep.xero_description);

    const unit = ev?.unit || it.rep.unit || '';
    const unitPrice = ev?.unit_price != null ? ev.unit_price
      : (ev?.qty ? (ev.line_total / ev.qty) : (it.rep.unit_cost ?? null));
    const supplierSku = ev?.item_code || it.rep.xero_item_code || '';
    const supplierDesc = ev?.description || it.rep.xero_description || '';

    // Derive pack (size + qty + unit) and a clean Purchase UOM name.
    const pk = parsePackParts(`${unit} ${ev?.description || it.rep.xero_description || ''}`);
    const conversion = pk && d.stockUom ? convFromParts(pk, d.stockUom) : null;
    const packSize = pk ? pk.packSize : null;
    const packSizeUom = pk ? pk.packUnit : null;
    const packQty = pk ? pk.packQty : null;
    // Clean Purchase UOM: prefer a packaging keyword (Case/Bag/Box…), else the
    // parsed pack unit / normalised measurement, else 'Each'. Never the raw mess.
    const uomText = `${unit} ${ev?.description || it.rep.xero_description || ''}`;
    const pkgName = packagingName(uomText);
    const purchaseUom = pk
      ? (pkgName || (pk.packQty > 1 ? 'Case' : pk.packUnit))
      : (pkgName || normMeasure(unit) || 'Each');

    for (const lineId of it.lineIds) {
      proposalRows.push({
        id: lineId, invoice_line_id: lineId, invoice_id: invId,
        supplier_id: it.supplierId === 'none' ? null : it.supplierId, supplier_name: it.supplierName,
        supplier_sku: supplierSku, supplier_description: supplierDesc,
        proposed_product_id: d.productId, proposed_product_name: d.productName,
        proposed_product_sku: d.productSku, proposed_stock_uom: d.stockUom,
        confidence: d.confidence, match_method: d.method, reasoning: d.reasoning,
        purchase_uom: purchaseUom,
        purchase_uom_label: purchaseUom,
        pack_size: packSize, pack_size_uom: packSizeUom, pack_qty: packQty,
        conversion_factor: conversion, yield_factor: 1,
        nominal_cost: unitPrice != null ? unitPrice : null,
        status: 'pending', updated_date: now,
      });
    }
  }

  if (proposalRows.length) {
    await supabase.from('review_queue_proposals').upsert(proposalRows, { onConflict: 'id' });
  }
  // Mark every processed line so chained re-runs skip them.
  await supabase.from('purchase_invoice_lines')
    .update({ ai_proposed_at: now }).in('id', lines.map((l: any) => l.id));

  const matched = decisions.filter(d => d.productId).length;
  const { count: remaining } = await supabase.from('purchase_invoice_lines')
    .select('id', { count: 'exact', head: true })
    .eq('match_status', 'unmatched').is('ai_proposed_at', null);
  const hasMore = (remaining || 0) > 0;
  if (hasMore && !body.noChain) chainNext(FN_NAME, { batchSize }, 2);

  return json({
    status: hasMore ? 'running' : 'completed',
    processed: lines.length, uniqueItems: uniques.length, matched,
    llmUsed: ambiguous.length, remaining: remaining || 0, hasMore,
  });
});
