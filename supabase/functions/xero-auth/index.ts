import {
  CLIENT_ID, CLIENT_SECRET, REDIRECT_URI, XERO_TOKEN_URL, XERO_CONNECTIONS_URL,
  getSupabase, getValidTokens, saveTokens, deleteTokens, corsHeaders, json,
} from '../_shared/xero.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders() });

  const { action, code } = await req.json();

  const supabase = getSupabase();

  // ── getAuthUrl ──────────────────────────────────────────────────────────────
  if (action === 'getAuthUrl') {
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: CLIENT_ID,
      redirect_uri: REDIRECT_URI,
      scope: 'openid profile email offline_access accounting.invoices accounting.invoices.read accounting.payments.read accounting.contacts accounting.contacts.read accounting.settings.read accounting.attachments.read',
      state: crypto.randomUUID(),
    });
    return json({ url: `https://login.xero.com/identity/connect/authorize?${params}` });
  }

  // ── exchangeCode ────────────────────────────────────────────────────────────
  if (action === 'exchangeCode') {
    if (!code) return json({ success: false, error: 'No code provided' });

    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: REDIRECT_URI,
    });
    const basic = btoa(`${CLIENT_ID}:${CLIENT_SECRET}`);
    const tokenRes = await fetch(XERO_TOKEN_URL, {
      method: 'POST',
      headers: { 'Authorization': `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });

    if (!tokenRes.ok) {
      const err = await tokenRes.text();
      return json({ success: false, error: `Token exchange failed: ${err}` });
    }

    const tokenData = await tokenRes.json();

    // Get tenant (org) info
    const connRes = await fetch(XERO_CONNECTIONS_URL, {
      headers: { 'Authorization': `Bearer ${tokenData.access_token}`, 'Content-Type': 'application/json' },
    });
    const connections = await connRes.json();
    if (!connections?.length) return json({ success: false, error: 'No Xero organisation found' });

    const tenant = connections[0];
    await saveTokens(supabase, {
      access_token: tokenData.access_token,
      refresh_token: tokenData.refresh_token,
      tenant_id: tenant.tenantId,
      expires_at: Date.now() + tokenData.expires_in * 1000,
    });

    return json({ success: true, tenant: tenant.tenantName });
  }

  // ── testConnection ──────────────────────────────────────────────────────────
  if (action === 'testConnection') {
    const tokens = await getValidTokens(supabase);
    if (!tokens) return json({ connected: false });

    const connRes = await fetch(XERO_CONNECTIONS_URL, {
      headers: { 'Authorization': `Bearer ${tokens.access_token}`, 'Content-Type': 'application/json' },
    });
    if (!connRes.ok) return json({ connected: false, error: 'Could not reach Xero' });

    const connections = await connRes.json();
    const org = connections?.find((c: { tenantId: string }) => c.tenantId === tokens.tenant_id);
    return json({ connected: true, organisation: org?.tenantName || 'Connected' });
  }

  // ── disconnect ──────────────────────────────────────────────────────────────
  if (action === 'disconnect') {
    await deleteTokens(supabase);
    return json({ success: true });
  }

  return json({ error: `Unknown action: ${action}` }, 400);
});
