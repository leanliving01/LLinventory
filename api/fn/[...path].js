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

  // Prefer the [...path] catch-all query param (most reliable regardless of rewrites).
  // Fall back to stripping the prefix from req.url for any path prefix variant.
  const rawPath = req.query.path;
  let fnPath;
  if (rawPath) {
    fnPath = (Array.isArray(rawPath) ? rawPath.join('/') : String(rawPath)).replace(/^\/+/, '');
  } else {
    fnPath = (req.url || '').replace(/^\/+(?:api\/fn|__fn)\/+/, '').split('?')[0].replace(/^\/+/, '');
  }

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
