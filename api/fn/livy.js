// Vercel Node.js serverless proxy → the Livy (Hermes) agent API server.
//
// The browser calls /__fn/livy (rewritten to /api/fn/livy). This function injects
// the API_SERVER_KEY server-side so the secret NEVER reaches the browser, then
// forwards an OpenAI-compatible chat request to Livy's public endpoint.
//
// Required Vercel env var:  LIVY_API_KEY   = Livy's API_SERVER_KEY (from the VM .env)
// Optional Vercel env var:  LIVY_API_URL   = override endpoint
//                                            (default: https://livy.leanliving.co.za/v1/chat/completions)
//
// NOTE: Livy is READ-ONLY over the ERP — it can answer/draft but cannot change data.

export const config = { maxDuration: 60 }; // tool-calling replies can take >10s

const LIVY_URL =
  process.env.LIVY_API_URL || 'https://livy.leanliving.co.za/v1/chat/completions';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'content-type');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'POST only' });
    return;
  }

  const key = process.env.LIVY_API_KEY;
  if (!key) {
    res.status(500).json({ error: 'LIVY_API_KEY is not configured in Vercel env' });
    return;
  }

  try {
    const body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body || {});
    const upstream = await fetch(LIVY_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
      },
      body,
    });
    const text = await upstream.text();
    res.setHeader('Content-Type', upstream.headers.get('Content-Type') || 'application/json');
    res.status(upstream.status).send(text);
  } catch (err) {
    res.status(502).json({ error: String(err?.message || err) });
  }
}
