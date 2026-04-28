import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const XERO_TOKEN_URL = 'https://identity.xero.com/connect/token';

/**
 * Fetches Xero Chart of Accounts and Tax Rates for dropdown population.
 * Returns { accounts: [...], taxRates: [...] }
 * Handles token refresh automatically.
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const clientId = Deno.env.get('XERO_CLIENT_ID');
    const clientSecret = Deno.env.get('XERO_CLIENT_SECRET');
    if (!clientId || !clientSecret) {
      return Response.json({ error: 'Xero credentials not configured' }, { status: 500 });
    }

    // Retrieve stored tokens
    const tokenSettings = await base44.asServiceRole.entities.Setting.filter({ key: 'xero_tokens' });
    if (tokenSettings.length === 0) {
      return Response.json({ error: 'Xero not connected. Please connect in Settings first.' }, { status: 400 });
    }

    let tokens = JSON.parse(tokenSettings[0].value);

    // Refresh if expired (with 60s buffer)
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
        return Response.json({ error: 'Xero token refresh failed. Please reconnect in Settings.', details: refreshData }, { status: 401 });
      }

      tokens = {
        access_token: refreshData.access_token,
        refresh_token: refreshData.refresh_token,
        expires_at: Date.now() + (refreshData.expires_in * 1000),
        token_type: refreshData.token_type,
      };

      await base44.asServiceRole.entities.Setting.update(tokenSettings[0].id, { value: JSON.stringify(tokens) });
    }

    // Get tenant ID
    const tenantSettings = await base44.asServiceRole.entities.Setting.filter({ key: 'xero_tenant_id' });
    if (tenantSettings.length === 0) {
      return Response.json({ error: 'Xero tenant ID not found. Please reconnect in Settings.' }, { status: 400 });
    }
    const tenantId = tenantSettings[0].value;

    const headers = {
      'Authorization': `Bearer ${tokens.access_token}`,
      'Xero-Tenant-Id': tenantId,
      'Accept': 'application/json',
    };

    // Fetch accounts and tax rates in parallel
    const [accountsRes, taxRatesRes] = await Promise.all([
      fetch('https://api.xero.com/api.xro/2.0/Accounts', { headers }),
      fetch('https://api.xero.com/api.xro/2.0/TaxRates', { headers }),
    ]);

    if (!accountsRes.ok) {
      const errData = await accountsRes.json();
      console.error('Xero accounts fetch failed:', JSON.stringify(errData));
      return Response.json({ error: 'Failed to fetch Xero accounts', details: errData }, { status: 502 });
    }

    if (!taxRatesRes.ok) {
      const errData = await taxRatesRes.json();
      console.error('Xero tax rates fetch failed:', JSON.stringify(errData));
      return Response.json({ error: 'Failed to fetch Xero tax rates', details: errData }, { status: 502 });
    }

    const accountsData = await accountsRes.json();
    const taxRatesData = await taxRatesRes.json();

    // Map accounts — include code, name, type, class for filtering
    const accounts = (accountsData.Accounts || [])
      .filter(a => a.Status === 'ACTIVE')
      .map(a => ({
        code: a.Code,
        name: a.Name,
        type: a.Type,
        class: a.Class,
      }))
      .sort((a, b) => a.code.localeCompare(b.code));

    // Map tax rates — include name, type, effective rate
    const taxRates = (taxRatesData.TaxRates || [])
      .filter(t => t.Status === 'ACTIVE')
      .map(t => ({
        name: t.Name,
        taxType: t.TaxType,
        rate: t.EffectiveRate,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    return Response.json({ accounts, taxRates });
  } catch (error) {
    console.error('getXeroChartData error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});