// Vercel serverless proxy — forwards edge function calls to Supabase
// so the browser never calls supabase.co directly (avoids CORS/extension blocks).
const SUPABASE_FUNCTIONS_URL = 'https://cpzkmzcohujpybcocipe.supabase.co/functions/v1';

export const config = { runtime: 'edge' };

export default async function handler(req) {
  const url = new URL(req.url);
  // Strip the /api/fn prefix to get the function path
  const fnPath = url.pathname.replace(/^\/api\/fn\/?/, '');

  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
      },
    });
  }

  const target = `${SUPABASE_FUNCTIONS_URL}/${fnPath}`;

  // Forward authorization and apikey from the incoming request
  const headers = new Headers();
  headers.set('Content-Type', 'application/json');
  const auth = req.headers.get('authorization');
  const apikey = req.headers.get('apikey');
  if (auth) headers.set('Authorization', auth);
  if (apikey) headers.set('apikey', apikey);

  const body = req.method !== 'GET' && req.method !== 'HEAD' ? await req.text() : undefined;

  const upstream = await fetch(target, { method: req.method, headers, body });
  const text = await upstream.text();

  return new Response(text, {
    status: upstream.status,
    headers: {
      'Content-Type': upstream.headers.get('Content-Type') || 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  });
}
