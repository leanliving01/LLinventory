// AI purchasing-unit recovery.
//
// For each active raw / supplement / packaging supplier_product, gather the
// evidence we have (product name, current label, recent invoice line
// descriptions + prices for THAT supplier) and ask Gemini for the correct
// purchase unit, conversion factor (how many stock_uom in one purchase unit) and
// supplier SKU. High-confidence fixes are applied straight to supplier_products;
// the rest are rowed into purchase_unit_proposals as 'pending' for review.
//
//   { mode: 'run', batchSize?, threshold? }   — walk all un-checked supplier products
//
// Cursor: supplier_products.purchase_unit_checked_at (set for every sp looked at).
// Self-chains in small batches (one Gemini call per batch).

import { getSupabase, corsHeaders, json } from '../_shared/xero.ts';
import { chainNext } from '../_shared/chain.ts';

const FN_NAME = 'propose-purchase-units';
const DEFAULT_BATCH = 12;
const DEFAULT_THRESHOLD = 0.85;
const SCOPE_TYPES = ['raw', 'supplement', 'packaging'];
const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY');
const GEMINI_MODEL = 'gemini-2.0-flash';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders() });
  if (!GEMINI_API_KEY) return json({ status: 'error', error: 'GEMINI_API_KEY not configured' }, 500);

  let body: { batchSize?: number; threshold?: number } = {};
  try { body = await req.json(); } catch { /* empty ok */ }
  const batchSize = Math.max(1, Math.min(25, body.batchSize || DEFAULT_BATCH));
  const threshold = body.threshold ?? DEFAULT_THRESHOLD;
  const supabase = getSupabase();
  const now = new Date().toISOString();

  // 1. Next batch of un-checked active supplier products.
  const { data: sps, error: spErr } = await supabase
    .from('supplier_products')
    .select('id, product_id, product_name, supplier_id, supplier_name, supplier_sku, purchase_uom, purchase_uom_label, conversion_factor, yield_factor, last_purchase_price')
    .eq('active', true)
    .is('purchase_unit_checked_at', null)
    .order('id', { ascending: true })
    .limit(batchSize);
  if (spErr) return json({ status: 'error', error: spErr.message }, 500);
  if (!sps || sps.length === 0) return json({ status: 'completed', processed: 0, hasMore: false });

  // 2. Products → type + stock_uom. Only raw/supplement/packaging are in scope.
  const productIds = [...new Set(sps.map(s => s.product_id).filter(Boolean))];
  const { data: prods } = await supabase
    .from('products')
    .select('id, type, stock_uom, name')
    .in('id', productIds);
  const prodById = new Map((prods || []).map((p: any) => [p.id, p]));

  const inScope = sps.filter(s => SCOPE_TYPES.includes(prodById.get(s.product_id)?.type));

  // 3. Invoice evidence for the in-scope supplier products (last ~4 months).
  const evidenceBySp = new Map<string, any[]>();
  if (inScope.length) {
    const supplierIds = [...new Set(inScope.map(s => s.supplier_id).filter(Boolean))];
    const cutoff = fourMonthsAgo();
    const { data: invs } = await supabase
      .from('purchase_invoices')
      .select('id, supplier_id')
      .in('supplier_id', supplierIds)
      .gte('invoice_date', cutoff)
      .limit(2000);
    const invSupplier = new Map((invs || []).map((i: any) => [i.id, i.supplier_id]));
    const invIds = (invs || []).map((i: any) => i.id);

    if (invIds.length) {
      const scopeProductIds = [...new Set(inScope.map(s => s.product_id))];
      // Chunk the IN list on invoice_id to stay within URL limits.
      const lines: any[] = [];
      for (let i = 0; i < invIds.length; i += 200) {
        const slice = invIds.slice(i, i + 200);
        const { data: chunk } = await supabase
          .from('purchase_invoice_lines')
          .select('invoice_id, product_id, xero_item_code, xero_description, qty, unit, unit_cost, line_total')
          .in('product_id', scopeProductIds)
          .in('invoice_id', slice)
          .order('created_date', { ascending: false })
          .limit(500);
        if (chunk) lines.push(...chunk);
      }
      for (const sp of inScope) {
        const ev = lines
          .filter(l => l.product_id === sp.product_id && invSupplier.get(l.invoice_id) === sp.supplier_id)
          .slice(0, 4);
        if (ev.length) evidenceBySp.set(sp.id, ev);
      }
    }
  }

  // 4. Ask Gemini for the whole batch at once.
  let proposals: Record<string, any> = {};
  if (inScope.length) {
    const items = inScope.map(sp => ({
      id: sp.id,
      product_name: prodById.get(sp.product_id)?.name || sp.product_name,
      stock_uom: prodById.get(sp.product_id)?.stock_uom || 'kg',
      supplier_name: sp.supplier_name,
      current_purchase_uom: sp.purchase_uom,
      current_purchase_uom_label: sp.purchase_uom_label,
      current_conversion_factor: sp.conversion_factor,
      last_purchase_price: sp.last_purchase_price,
      invoice_examples: (evidenceBySp.get(sp.id) || []).map(l => ({
        description: l.xero_description, item_code: l.xero_item_code,
        qty: l.qty, unit: l.unit, unit_price: l.unit_cost, line_total: l.line_total,
      })),
    }));
    try {
      proposals = await askGemini(items);
    } catch (err) {
      console.error('[propose-purchase-units] Gemini failed:', err);
      // Don't mark checked — let a retry pick them up.
      return json({ status: 'error', error: 'Gemini call failed: ' + String(err) }, 502);
    }
  }

  // 5. Apply high-confidence; row the rest. Mark every sp checked.
  let autoApplied = 0, pending = 0;
  for (const sp of inScope) {
    const p = proposals[sp.id];
    if (!p) continue;
    const stockUom = prodById.get(sp.product_id)?.stock_uom || 'kg';
    const newConv = Number(p.conversion_factor);
    if (!Number.isFinite(newConv) || newConv <= 0) continue;

    const curConv = Number(sp.conversion_factor) || 1;
    const convChanged = Math.abs(curConv - newConv) > Math.max(0.001 * Math.abs(newConv), 0.001);
    const uomChanged = (p.purchase_uom || '') && p.purchase_uom !== sp.purchase_uom;
    const skuNew = (p.supplier_sku || '') && !(sp.supplier_sku || '');
    if (!convChanged && !uomChanged && !skuNew) continue; // already correct

    const conf = Number(p.confidence) || 0;
    const autoApply = conf >= threshold && (convChanged || uomChanged);
    const status = autoApply ? 'auto_applied' : 'pending';

    // Upsert the proposal row (one per supplier product).
    await supabase.from('purchase_unit_proposals').upsert({
      id: sp.id,                       // 1 proposal per supplier product — stable PK, no churn on re-run
      supplier_product_id: sp.id,
      product_id: sp.product_id,
      product_name: sp.product_name,
      supplier_name: sp.supplier_name,
      stock_uom: stockUom,
      current_purchase_uom: sp.purchase_uom,
      current_conversion_factor: curConv,
      current_purchase_uom_label: sp.purchase_uom_label,
      current_supplier_sku: sp.supplier_sku,
      proposed_purchase_uom: p.purchase_uom || sp.purchase_uom,
      proposed_conversion_factor: newConv,
      proposed_purchase_uom_label: p.purchase_uom_label || sp.purchase_uom_label,
      proposed_supplier_sku: p.supplier_sku || null,
      confidence: conf,
      reasoning: p.reasoning || '',
      evidence: JSON.stringify((evidenceBySp.get(sp.id) || []).map(l => l.xero_description)).slice(0, 1000),
      status,
      applied_at: autoApply ? now : null,
      updated_date: now,
    }, { onConflict: 'supplier_product_id' });

    if (autoApply) {
      await applyToSupplierProduct(supabase, sp, p, stockUom);
      autoApplied++;
    } else {
      pending++;
    }
  }

  // Mark every sp in the batch checked (in and out of scope) so we advance.
  await supabase.from('supplier_products')
    .update({ purchase_unit_checked_at: now })
    .in('id', sps.map(s => s.id));

  // 6. Continue.
  const { count: remaining } = await supabase
    .from('supplier_products')
    .select('id', { count: 'exact', head: true })
    .eq('active', true)
    .is('purchase_unit_checked_at', null);
  const hasMore = (remaining || 0) > 0;
  if (hasMore) chainNext(FN_NAME, { batchSize, threshold }, 2);

  return json({
    status: hasMore ? 'running' : 'completed',
    processed: sps.length, inScope: inScope.length,
    autoApplied, pending, remaining: remaining || 0, hasMore,
  });
});

async function applyToSupplierProduct(supabase: ReturnType<typeof getSupabase>, sp: any, p: any, stockUom: string) {
  const conv = Number(p.conversion_factor) || 1;
  const yf = Number(sp.yield_factor) || 1;
  const update: Record<string, unknown> = {
    purchase_uom: p.purchase_uom || sp.purchase_uom,
    conversion_factor: conv,
    conversion_uom: stockUom,
    purchase_uom_label: p.purchase_uom_label || sp.purchase_uom_label,
    effective_internal_qty: Math.round(conv * yf * 1000) / 1000,
    updated_date: new Date().toISOString(),
  };
  // Only fill the supplier SKU if we don't already have one (don't clobber).
  if ((p.supplier_sku || '') && !(sp.supplier_sku || '')) update.supplier_sku = p.supplier_sku;
  await supabase.from('supplier_products').update(update).eq('id', sp.id);
}

async function askGemini(items: any[]): Promise<Record<string, any>> {
  const prompt = `You correct the purchasing unit of measure for inventory products, using supplier invoice evidence.

For EACH item below decide how the product is actually bought from that supplier and return the correct values. "conversion_factor" = how many of the product's stock_uom are in ONE purchase unit.

Rules:
- If sold loose per the stock unit (e.g. per kg, stock_uom kg) → conversion_factor = 1.
- A box/bag/case → conversion_factor = the contents in stock_uom. Examples: 10kg bag, stock_uom kg → 10. 800g pack, stock_uom kg → 0.8. 800g pack, stock_uom g → 800. Case of 6 × 2L, stock_uom L → 12.
- Look for pack size in the invoice descriptions, the current label, and the product name (patterns like "10 KG", "800GR", "x 1kg", "Box of 10", "case of 6", "6 x 2L").
- last_purchase_price is the price for ONE purchase unit — use it as a sanity check (a spice/meat line at hundreds of Rand is a box/case, not a single kg).
- purchase_uom: a short unit token — one of kg, g, L, ml, each, bag, box, case, punnet, tray, pack, bunch.
- purchase_uom_label: a human label e.g. "10kg Bag", "Case of 6 × 1kg", "Per kg".
- supplier_sku: the supplier's item code from invoice_examples[].item_code if present, else null.
- confidence 0..1: use >= 0.85 ONLY when the pack size is explicit in the evidence; lower when you are inferring from price or guessing.
- reasoning: one short sentence citing the evidence.

Return ONLY a JSON array, one object per item, no markdown:
[{"id","purchase_uom","conversion_factor","purchase_uom_label","supplier_sku","confidence","reasoning"}]

Items:
${JSON.stringify(items)}`;

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0, maxOutputTokens: 4000, responseMimeType: 'application/json' },
      }),
    },
  );
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text || '[]';
  const cleaned = raw.replace(/^```(?:json)?\n?/m, '').replace(/\n?```$/m, '').trim();
  const arr = JSON.parse(cleaned);
  const out: Record<string, any> = {};
  for (const p of (Array.isArray(arr) ? arr : [])) { if (p?.id) out[p.id] = p; }
  return out;
}

function fourMonthsAgo(): string {
  const d = new Date();
  d.setMonth(d.getMonth() - 4);
  return d.toISOString().slice(0, 10);
}
