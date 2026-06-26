// Shared OpenAI helpers for the AI Review Queue (embeddings + JSON chat).
//
// Cost/accuracy notes baked in here:
//  - Embeddings (text-embedding-3-small) do the heavy semantic matching for a
//    few cents per MILLION tokens; the chat model only adjudicates a tiny
//    grounded shortlist, so it can never invent a product that isn't real.
//  - The chat helper puts the STATIC instructions first so OpenAI's automatic
//    prompt caching kicks in across the many calls of a bulk run.

const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY');

export const EMBED_MODEL = 'text-embedding-3-small'; // 1536-dim, cheap, strong
export const CHAT_MODEL = 'gpt-5-mini';              // matches the rest of the app

export const hasOpenAI = () => !!OPENAI_API_KEY;

/**
 * Embed a batch of strings in ONE request (the endpoint accepts up to 2048
 * inputs). Returns an array of vectors aligned to `inputs`. Throws on failure.
 */
export async function embedBatch(inputs: string[]): Promise<number[][]> {
  if (!OPENAI_API_KEY) throw new Error('OPENAI_API_KEY not configured');
  if (!inputs.length) return [];
  const res = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${OPENAI_API_KEY}` },
    body: JSON.stringify({ model: EMBED_MODEL, input: inputs }),
  });
  if (!res.ok) throw new Error(`OpenAI embeddings ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  // data.data is returned in input order, but sort by index to be safe.
  const rows = (data?.data || []).slice().sort((a: any, b: any) => a.index - b.index);
  return rows.map((r: any) => r.embedding as number[]);
}

/** pgvector literal for a numeric vector: "[0.1,0.2,...]". */
export const toVectorLiteral = (v: number[]) => `[${v.join(',')}]`;

/**
 * Strict-ish JSON chat call. Returns the parsed object, or throws.
 * `system` is the stable prefix (cacheable); `user` carries the per-call data.
 */
export async function chatJSON(system: string, user: string, maxTokens = 4000): Promise<any> {
  if (!OPENAI_API_KEY) throw new Error('OPENAI_API_KEY not configured');
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${OPENAI_API_KEY}` },
    body: JSON.stringify({
      model: CHAT_MODEL,
      reasoning_effort: 'low',           // matching is easy once grounded — keep it cheap/fast
      max_completion_tokens: maxTokens,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    }),
  });
  if (!res.ok) throw new Error(`OpenAI chat ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  const raw = data?.choices?.[0]?.message?.content || '{}';
  const cleaned = raw.replace(/^```(?:json)?\n?/m, '').replace(/\n?```$/m, '').trim();
  return JSON.parse(cleaned);
}
