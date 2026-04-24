import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const XERO_AUTH_URL = 'https://login.xero.com/identity/connect/authorize';
const XERO_TOKEN_URL = 'https://identity.xero.com/connect/token';
const REDIRECT_URI = 'https://preview-sandbox--69e3a2c87f6ad3cb731372b6.base44.app/XeroCallback';
const SCOPES = 'openid profile email offline_access accounting.invoices accounting.contacts accounting.settings.read';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    let user = null;
    try { user = await base44.auth.me(); } catch (_) { /* popup may not be authenticated */ }

    const { action, code } = await req.json();

    const clientId = Deno.env.get('XERO_CLIENT_ID');
    const clientSecret = Deno.env.get('XERO_CLIENT_SECRET');

    if (!clientId || !clientSecret) {
      return Response.json({ error: 'Xero credentials not configured' }, { status: 500 });
    }

    // exchangeCode is called from the OAuth popup where the user may not be
    // authenticated (separate browser window). Validate using the Xero auth
    // code itself — skip the admin check for this action only.
    if (action !== 'exchangeCode') {
      if (!user || user.role !== 'admin') {
        return Response.json({ error: 'Admin access required' }, { status: 403 });
      }
    }

    // Step 1: Generate the authorization URL
    if (action === 'getAuthUrl') {
      const params = new URLSearchParams({
        response_type: 'code',
        client_id: clientId,
        redirect_uri: REDIRECT_URI,
        scope: SCOPES,
        state: 'xero_auth_lean_living',
      });
      return Response.json({ url: `${XERO_AUTH_URL}?${params.toString()}` });
    }

    // Step 2: Exchange authorization code for tokens
    if (action === 'exchangeCode') {
      if (!code) {
        return Response.json({ error: 'Authorization code is required' }, { status: 400 });
      }

      const tokenResponse = await fetch(XERO_TOKEN_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Authorization': 'Basic ' + btoa(`${clientId}:${clientSecret}`),
        },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code,
          redirect_uri: REDIRECT_URI,
        }),
      });

      const tokenData = await tokenResponse.json();

      if (!tokenResponse.ok) {
        console.error('Xero token error:', JSON.stringify(tokenData));
        return Response.json({ error: 'Token exchange failed', details: tokenData }, { status: 400 });
      }

      // Store tokens in a Setting entity
      const settings = await base44.asServiceRole.entities.Setting.filter({ key: 'xero_tokens' });
      const tokenPayload = JSON.stringify({
        access_token: tokenData.access_token,
        refresh_token: tokenData.refresh_token,
        expires_at: Date.now() + (tokenData.expires_in * 1000),
        token_type: tokenData.token_type,
      });

      if (settings.length > 0) {
        await base44.asServiceRole.entities.Setting.update(settings[0].id, { value: tokenPayload });
      } else {
        await base44.asServiceRole.entities.Setting.create({
          key: 'xero_tokens',
          value: tokenPayload,
          group: 'org',
          label: 'Xero OAuth Tokens',
        });
      }

      // Also fetch and store the tenant ID
      const connectionsRes = await fetch('https://api.xero.com/connections', {
        headers: { 'Authorization': `Bearer ${tokenData.access_token}` },
      });
      const connections = await connectionsRes.json();

      if (connections.length > 0) {
        const tenantSettings = await base44.asServiceRole.entities.Setting.filter({ key: 'xero_tenant_id' });
        const tenantId = connections[0].tenantId;
        if (tenantSettings.length > 0) {
          await base44.asServiceRole.entities.Setting.update(tenantSettings[0].id, { value: tenantId });
        } else {
          await base44.asServiceRole.entities.Setting.create({
            key: 'xero_tenant_id',
            value: tenantId,
            group: 'org',
            label: 'Xero Tenant ID',
          });
        }
      }

      return Response.json({ 
        success: true, 
        message: 'Xero connected successfully',
        tenant: connections.length > 0 ? connections[0].tenantName : 'Unknown',
      });
    }

    // Step 3: Test connection by refreshing token and calling API
    if (action === 'testConnection') {
      const settings = await base44.asServiceRole.entities.Setting.filter({ key: 'xero_tokens' });
      if (settings.length === 0) {
        return Response.json({ connected: false, error: 'No Xero tokens stored' });
      }

      let tokens = JSON.parse(settings[0].value);

      // Refresh if expired
      if (Date.now() >= tokens.expires_at - 60000) {
        const refreshRes = await fetch(XERO_TOKEN_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Authorization': 'Basic ' + btoa(`${clientId}:${clientSecret}`),
          },
          body: new URLSearchParams({
            grant_type: 'refresh_token',
            refresh_token: tokens.refresh_token,
          }),
        });

        const refreshData = await refreshRes.json();
        if (!refreshRes.ok) {
          return Response.json({ connected: false, error: 'Token refresh failed', details: refreshData });
        }

        tokens = {
          access_token: refreshData.access_token,
          refresh_token: refreshData.refresh_token,
          expires_at: Date.now() + (refreshData.expires_in * 1000),
          token_type: refreshData.token_type,
        };

        await base44.asServiceRole.entities.Setting.update(settings[0].id, { value: JSON.stringify(tokens) });
      }

      // Get tenant ID
      const tenantSettings = await base44.asServiceRole.entities.Setting.filter({ key: 'xero_tenant_id' });
      if (tenantSettings.length === 0) {
        return Response.json({ connected: false, error: 'No Xero tenant ID stored' });
      }

      // Test with org endpoint
      const orgRes = await fetch('https://api.xero.com/api.xro/2.0/Organisation', {
        headers: {
          'Authorization': `Bearer ${tokens.access_token}`,
          'Xero-Tenant-Id': tenantSettings[0].value,
          'Accept': 'application/json',
        },
      });

      const orgData = await orgRes.json();
      if (!orgRes.ok) {
        return Response.json({ connected: false, error: 'API call failed', details: orgData });
      }

      const org = orgData.Organisations?.[0];
      return Response.json({ 
        connected: true, 
        organisation: org?.Name,
        country: org?.CountryCode,
        currency: org?.BaseCurrency,
      });
    }

    return Response.json({ error: 'Invalid action' }, { status: 400 });
  } catch (error) {
    console.error('xeroAuth error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});