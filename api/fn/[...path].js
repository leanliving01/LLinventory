// Vercel Node.js serverless proxy — forwards edge function calls to Supabase
// so the browser never calls supabase.co directly (avoids CORS/extension blocks).
const SUPABASE_FUNCTIONS_URL = 'https://cpzkmzcohujpybcocipe.supabase.co/functions/v1';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'authorization, x-client-info, apikey, content-type');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  // req.url is e.g. "/api/fn/sync-shopify-products" — strip the prefix to get the function name
  const fnPath = (req.url || '').replace(/^\/api\/fn\/?/, '').split('?')[0];
  const target = `${SUPABASE_FUNCTIONS_URL}/${fnPath}`;

  const headers = { 'Content-Type': 'application/json' };
  if (req.headers['authorization']) headers['Authorization'] = req.headers['authorization'];
  if (req.headers['apikey']) headers['apikey'] = req.headers['apikey'];

  const body = req.method !== 'GET' && req.method !== 'HEAD'
    ? JSON.stringify(req.body)
    : undefined;

  const upstream = await fetch(target, { method: req.method, headers, body });
  const text = await upstream.text();

  res.setHeader('Content-Type', upstream.headers.get('Content-Type') || 'application/json');
  res.status(upstream.status).send(text);
}
