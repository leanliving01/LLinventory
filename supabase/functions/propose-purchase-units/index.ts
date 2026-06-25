// AI purchasing-unit recovery — RULES-FIRST, Gemini only for the leftovers.
//
// For each active raw/supplement/packaging supplier_product:
//   1. Deterministic parser reads the stated pack (purchase_uom_label, product
//      name, and recent invoice-line descriptions) and converts it into the
//      product's stock_uom to get the correct conversion_factor. This is exact
//      and free, and handles the bulk (e.g. "1kg" + grams stock -> 1000).
//   2. Only when the rules find NO pack at all do we call Gemini (batched) with
//      the same text evidence. (Skipped automatically if GEMINI_API_KEY is unset
//      — the function still runs rules-only.)
//
// Unambiguous gram/ml "missing ×factor" errors auto-apply; kg/L packs, label↔name
// conflicts and low-confidence Gemini results go to purchase_unit_proposals as
// 'pending' for review. Idempotent via supplier_products.purchase_unit_checked_at.

import { getSupabase, corsHeaders, json } from '../_shared/xero.ts';
import { chainNext } from '../_shared/chain.ts';

const FN_NAME = 'propose-purchase-units';
const DEFAULT_BATCH = 15;
const DEFAULT_THRESHOLD = 0.85;
const SCOPE_TYPES = ['raw', 'supplement', 'packaging'];
const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY');
const GEMINI_MODEL = 'gemini-2.0-flash';
const VALID_STOCK = new Set(['g', 'kg', 'ml', 'l', 'pcs']);

const MASS: Record<string, number> = { kg: 1000, kgs: 1000, g: 1, gr: 1, gram: 1, grams: 1, kilo: 1000, kilogram: 1000 };
const VOL: Record<string, number> = { l: 1000, lt: 1000, litre: 1000, liter: 1000, ml: 1 };
const MULTI = /(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)\s*(kg|kgs|g|gr|gram|grams|ml|l|lt|litre|liter)\b/i;
const CASEOF = /(?:case|bale|bag|box|carton|pack|crate)\s*of\s*(\d+)\D*?(\d+(?:\.\d+)?)\s*(kg|kgs|g|gr|gram|grams|ml|l|lt|litre|liter)\b/i;
const PER = /\bper\s*(kg|kgs|kilo|kilogram|g|gram|l|lt|litre|liter|ml)\b/i;
const SINGLE = /(\d+(?:\.\d+)?)\s*(kg|kgs|g|gr|gram|grams|ml|l|lt|litre|liter)\b/i;

function toBase(value: number, unit: string): [string, number] | null {
  const u = unit.toLowerCase();
  if (u in MASS) return ['mass', value * MASS[u]];
  if (u in VOL) return ['vol', value * VOL[u]];
  return null;
}

function parsePack(text: string | null): [string, number] | null {
  if (!text) return null;
  let m = MULTI.exec(text);
  if (m) { const b = toBase(parseFloat(m[2]), m[3]); if (b) return [b[0], parseFloat(m[1]) * b[1]]; }
  m = CASEOF.exec(text);
  if (m) { const b = toBase(parseFloat(m[2]), m[3]); if (b) return [b[0], parseFloat(m[1]) * b[1]]; }
  m = PER.exec(text);
  if (m) {
    const u = m[1].toLowerCase();
    if (['kg', 'kgs', 'kilo', 'kilogram'].includes(u)) return ['mass', 1000];
    if (['g', 'gram'].includes(u)) return ['mass', 1];
    if (['l', 'lt', 'litre', 'liter'].includes(u)) return ['vol', 1000];
    if (u === 'ml') return ['vol', 1];
  }
  m = SINGLE.exec(text);
  if (m) { const b = toBase(parseFloat(m[1]), m[2]); if (b) return [b[0], b[1]]; }
  return null;
}

function convFor(stockUom: string, fam: string, base: number): number | null {
  const su = stockUom.toLowerCase();
  if (fam === 'mass') { if (su === 'g') return round3(base); if (su === 'kg') return round4(base / 1000); }
  if (fam === 'vol') { if (su === 'ml') return round3(base); if (su === 'l') return round4(base / 1000); }
  return null;
}
const round3 = (n: number) => Math.round(n * 1000) / 1000;
const round4 = (n: number) => Math.round(n * 10000) / 10000;
const convFromText = (t: string | null, su: string): number | null => {
  const p = parsePack(t); if (!p) return null; const c = convFor(su, p[0], p[1]); return c && c > 0 ? c : null;
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders() });

  let body: { batchSize?: number; threshold?: number } = {};
  try { body = await req.json(); } catch { /* empty ok */ }
  const batchSize = Math.max(1, Math.min(40, body.batchSize || DEFAULT_BATCH));
  const threshold = body.threshold ?? DEFAULT_THRESHOLD;
  const supabase = getSupabase();
  const now = new Date().toISOString();

  const { data: sps, error: spErr } = await supabase
    .from('supplier_products')
    .select('id, product_id, product_name, supplier_id, supplier_name, supplier_sku, purchase_uom, purchase_uom_label, conversion_factor, yield_factor, last_purchase_price')
    .eq('active', true)
    .is('purchase_unit_checked_at', null)
    .order('id', { ascending: true })
    .limit(batchSize);
  if (spErr) return json({ status: 'error', error: spErr.message }, 500);
  if (!sps || sps.length === 0) return json({ status: 'completed', processed: 0, hasMore: false });

  const productIds = [...new Set(sps.map(s => s.product_id).filter(Boolean))];
  const { data: prods } = await supabase.from('products').select('id, type, stock_uom, name').in('id', productIds);
  const prodById = new Map((prods || []).map((p: any) => [p.id, p]));
  const inScope = sps.filter(s => SCOPE_TYPES.includes(prodById.get(s.product_id)?.type));

  // Invoice-line descriptions per (product, supplier) — extra pack evidence.
  const evidence = new Map<string, string[]>();
  if (inScope.length) {
    const supplierIds = [...new Set(inScope.map(s => s.supplier_id).filter(Boolean))];
    const { data: invs } = await supabase.from('purchase_invoices').select('id, supplier_id').in('supplier_id', supplierIds).limit(3000);
    const invSup = new Map((invs || []).map((i: any) => [i.id, i.supplier_id]));
    const invIds = (invs || []).map((i: any) => i.id);
    const scopeProductIds = [...new Set(inScope.map(s => s.product_id))];
    const lines: any[] = [];
    for (let i = 0; i < invIds.length; i += 200) {
      const { data: chunk } = await supabase
        .from('purchase_invoice_lines')
        .select('invoice_id, product_id, xero_description')
        .in('product_id', scopeProductIds).in('invoice_id', invIds.slice(i, i + 200))
        .order('created_date', { ascending: false }).limit(500);
      if (chunk) lines.push(...chunk);
    }
    for (const sp of inScope) {
      const ds = lines.filter(l => l.product_id === sp.product_id && invSup.get(l.invoice_id) === sp.supplier_id)
        .map(l => l.xero_description).filter(Boolean).slice(0, 4);
      if (ds.length) evidence.set(sp.id, ds);
    }
  }

  // ── Pass 1: deterministic rules ───────────────────────────────────────────
  let autoApplied = 0, pending = 0;
  const needGemini: any[] = [];
  for (const sp of inScope) {
    const prod = prodById.get(sp.product_id);
    const su = (prod?.stock_uom || '').trim();
    const cur = Number(sp.conversion_factor) || 1;
    if (!VALID_STOCK.has(su.toLowerCase())) {
      await writeProposal(supabase, sp, su, cur, null, 'pending', 0, `invalid stock_uom '${su}' — needs cleanup`, now);
      continue; // leave costing untouched
    }
    const labelC = convFromText(sp.purchase_uom_label, su);
    const nameC = convFromText(sp.product_name, su) ?? convFromText(prod?.name, su);
    let invC: number | null = null;
    for (const d of (evidence.get(sp.id) || [])) { invC = convFromText(d, su); if (invC) break; }
    const cands = [labelC, nameC, invC].filter((c): c is number => !!c);

    if (cands.length === 0) { needGemini.push({ sp, su, cur }); continue; }

    const newc = labelC ?? nameC ?? invC!;
    const conflict = labelC && nameC && Math.abs(labelC - nameC) > Math.max(0.01 * Math.max(labelC, nameC), 0.01);
    if (!conflict && Math.abs(cur - newc) <= Math.max(0.001 * newc, 0.001)) { await markChecked(supabase, sp.id, now); continue; }

    const auto = !conflict && ['g', 'ml'].includes(su.toLowerCase()) && newc >= 50 && cur < newc / 5;
    if (auto) { await applyFix(supabase, sp, su, newc, now, `pack parsed: ${sp.purchase_uom_label || sp.product_name}`); autoApplied++; }
    else { await writeProposal(supabase, sp, su, cur, newc, 'pending', conflict ? 0.55 : 0.6, conflict ? 'label/name conflict — verify pack' : 'kg/L or ambiguous — confirm pack', now); pending++; }
  }

  // ── Pass 2: Gemini for records with no parsable pack in any field ──────────
  if (needGemini.length && GEMINI_API_KEY) {
    let proposals: Record<string, any> = {};
    try { proposals = await askGemini(needGemini.map(x => ({
      id: x.sp.id, product_name: prodById.get(x.sp.product_id)?.name || x.sp.product_name,
      stock_uom: x.su, supplier_name: x.sp.supplier_name, current_label: x.sp.purchase_uom_label,
      invoice_examples: evidence.get(x.sp.id) || [],
    }))); } catch (e) { console.error('[propose-purchase-units] gemini:', e); }
    for (const x of needGemini) {
      const p = proposals[x.sp.id];
      const newc = p ? Number(p.conversion_factor) : NaN;
      if (!p || !Number.isFinite(newc) || newc <= 0 || Math.abs(x.cur - newc) <= Math.max(0.001 * newc, 0.001)) {
        await markChecked(supabase, x.sp.id, now); continue;
      }
      const conf = Number(p.confidence) || 0;
      const auto = conf >= threshold && ['g', 'ml'].includes(x.su.toLowerCase()) && newc >= 50 && x.cur < newc / 5;
      if (auto) { await applyFix(supabase, x.sp, x.su, newc, now, p.reasoning || 'gemini'); autoApplied++; }
      else { await writeProposal(supabase, x.sp, x.su, x.cur, newc, 'pending', conf, p.reasoning || 'gemini proposal', now); pending++; }
    }
  } else {
    for (const x of needGemini) {
      await writeProposal(supabase, x.sp, x.su, x.cur, null, 'pending', 0, 'no pack in fields — add a label or attach an invoice', now);
    }
  }

  // mark every processed sp (in + out of scope) checked
  await supabase.from('supplier_products').update({ purchase_unit_checked_at: now }).in('id', sps.map(s => s.id));

  const { count: remaining } = await supabase.from('supplier_products')
    .select('id', { count: 'exact', head: true }).eq('active', true).is('purchase_unit_checked_at', null);
  const hasMore = (remaining || 0) > 0;
  if (hasMore) chainNext(FN_NAME, { batchSize, threshold }, 2);

  return json({ status: hasMore ? 'running' : 'completed', processed: sps.length, inScope: inScope.length, autoApplied, pending, geminiUsed: needGemini.length && !!GEMINI_API_KEY, remaining: remaining || 0, hasMore });
});

async function applyFix(supabase: any, sp: any, su: string, newc: number, now: string, reason: string) {
  const yf = Number(sp.yield_factor) || 1;
  await supabase.from('supplier_products').update({
    conversion_factor: newc, conversion_uom: su,
    effective_internal_qty: Math.round(newc * yf * 1000) / 1000, updated_date: now,
  }).eq('id', sp.id);
  await writeProposal(supabase, sp, su, Number(sp.conversion_factor) || 1, newc, 'auto_applied', 0.95, reason, now);
}

async function writeProposal(supabase: any, sp: any, su: string, cur: number, newc: number | null, status: string, conf: number, reason: string, now: string) {
  await supabase.from('purchase_unit_proposals').upsert({
    id: sp.id, supplier_product_id: sp.id, product_id: sp.product_id, product_name: sp.product_name,
    supplier_name: sp.supplier_name, stock_uom: su, current_conversion_factor: cur,
    proposed_conversion_factor: newc, confidence: conf, reasoning: reason, status,
    applied_at: status === 'auto_applied' ? now : null, updated_date: now,
  }, { onConflict: 'supplier_product_id' });
}

async function markChecked(supabase: any, id: string, now: string) {
  await supabase.from('supplier_products').update({ purchase_unit_checked_at: now }).eq('id', id);
}

async function askGemini(items: any[]): Promise<Record<string, any>> {
  const prompt = `You determine the purchasing unit of measure for inventory products from invoice evidence.
For EACH item return how it is bought. "conversion_factor" = how many of the product's stock_uom are in ONE purchase unit (e.g. 1kg pack + stock_uom g -> 1000; 5kg bag + g -> 5000; 400ml + ml -> 400; per kg + kg -> 1).
Use the current_label, product_name and invoice_examples to find the pack size.
confidence 0..1: >=0.85 only when the pack is explicit; lower when guessing.
Return ONLY a JSON array: [{"id","conversion_factor","purchase_uom","confidence","reasoning"}]
Items:
${JSON.stringify(items)}`;
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0, maxOutputTokens: 4000, responseMimeType: 'application/json' } }),
  });
  if (!res.ok) throw new Error(`Gemini ${res.status}`);
  const data = await res.json();
  const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text || '[]';
  const arr = JSON.parse(raw.replace(/^```(?:json)?\n?/m, '').replace(/\n?```$/m, '').trim());
  const out: Record<string, any> = {};
  for (const p of (Array.isArray(arr) ? arr : [])) if (p?.id) out[p.id] = p;
  return out;
}
