// Fire-and-forget self-chaining helper for Supabase Edge Functions.
//
// IMPORTANT: We do NOT await the fetch response — only wait long enough
// (~1.5s) to ensure the HTTP request is actually sent before the parent
// worker shuts down. The new worker is then independent.
//
// Awaiting the fetch response is a trap: with recursive self-chains, each
// parent would stay alive for the entire downstream chain duration, blowing
// past the wall-clock budget after 2-3 pages.

export function chainNext(
  functionName: string,
  body: Record<string, unknown>,
  delaySeconds = 1,
): Promise<void> {
  return (async () => {
    if (delaySeconds > 0) {
      await new Promise(r => setTimeout(r, delaySeconds * 1000));
    }

    const url = `${Deno.env.get('SUPABASE_URL')}/functions/v1/${functionName}`;
    const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    // Kick off the fetch without awaiting its response
    const fetchPromise = fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    }).catch(err => {
      console.error(`chainNext to ${functionName} failed:`, err);
    });

    // Race the fetch against a 3s grace period — gives the request enough
    // time to be sent over the wire and accepted by the next Edge Function
    // worker (cold starts can take ~2s), then we let the parent worker shut down.
    await Promise.race([
      fetchPromise,
      new Promise(r => setTimeout(r, 3000)),
    ]);
  })();
}
