// embed-products — embed the active catalogue into products.match_embedding so
// the review-queue matcher can rank by MEANING (e.g. "lemon loose" -> Lemons,
// "brinjal" -> Eggplant), not brittle string overlap.
//
// Rules-cheap: only embeds products whose embedding is missing or whose
// embedding_text changed since last time. Chains itself in batches. Embeddings
// are ~$0.02 / million tokens, so a full catalogue re-embed costs ~nothing.
//
// Body: { batchSize?, reembedAll? }   (reembedAll nulls embedded_at first)

import { getSupabase, corsHeaders, json } from '../_shared/xero.ts';
import { chainNext } from '../_shared/chain.ts';
import { embedBatch, toVectorLiteral, hasOpenAI } from '../_shared/openai.ts';

const FN_NAME = 'embed-products';
const DEFAULT_BATCH = 200;   // products per invocation
const EMBED_CHUNK = 100;     // inputs per OpenAI embeddings request

// The text we embed for a product: name carries most signal; type/subcategory
// add disambiguating context (e.g. "Lemon" the fruit vs a cleaning product).
function embeddingText(p: any): string {
  return [p.name, p.type, p.subcategory].map(s => (s || '').trim()).filter(Boolean).join(' • ');
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders() });
  if (!hasOpenAI()) return json({ status: 'error', error: 'OPENAI_API_KEY not configured' }, 500);

  let body: { batchSize?: number; reembedAll?: boolean; noChain?: boolean } = {};
  try { body = await req.json(); } catch { /* empty ok */ }
  const batchSize = Math.max(1, Math.min(500, body.batchSize || DEFAULT_BATCH));
  const supabase = getSupabase();
  const now = new Date().toISOString();

  if (body.reembedAll) {
    await supabase.from('products').update({ embedded_at: null }).eq('status', 'active');
  }

  // Pull a batch of active products that still need embedding.
  const { data: prods, error } = await supabase
    .from('products')
    .select('id, name, sku, type, subcategory, embedding_text')
    .eq('status', 'active')
    .is('embedded_at', null)
    .order('id', { ascending: true })
    .limit(batchSize);
  if (error) return json({ status: 'error', error: error.message }, 500);
  if (!prods || prods.length === 0) return json({ status: 'completed', processed: 0, hasMore: false });

  let processed = 0;
  for (let i = 0; i < prods.length; i += EMBED_CHUNK) {
    const chunk = prods.slice(i, i + EMBED_CHUNK);
    const texts = chunk.map(embeddingText);
    let vectors: number[][];
    try {
      vectors = await embedBatch(texts);
    } catch (e) {
      console.error(`[${FN_NAME}] embed failed:`, e);
      return json({ status: 'error', error: String(e), processed }, 502);
    }
    // Update each product with its vector (stored as a pgvector literal string).
    await Promise.all(chunk.map((p, idx) =>
      supabase.from('products').update({
        match_embedding: toVectorLiteral(vectors[idx]),
        embedding_text: texts[idx],
        embedded_at: now,
      }).eq('id', p.id)
    ));
    processed += chunk.length;
  }

  const { count: remaining } = await supabase.from('products')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'active').is('embedded_at', null);
  const hasMore = (remaining || 0) > 0;
  if (hasMore && !body.noChain) chainNext(FN_NAME, { batchSize }, 1);

  return json({ status: hasMore ? 'running' : 'completed', processed, remaining: remaining || 0, hasMore });
});
