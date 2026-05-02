import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const XERO_TOKEN_URL = 'https://identity.xero.com/connect/token';

async function getXeroTokens(base44) {
  const clientId = Deno.env.get('XERO_CLIENT_ID');
  const clientSecret = Deno.env.get('XERO_CLIENT_SECRET');
  const settings = await base44.asServiceRole.entities.Setting.filter({ key: 'xero_tokens' });
  if (settings.length === 0) throw new Error('Xero not connected.');

  let tokens = JSON.parse(settings[0].value);
  if (Date.now() >= tokens.expires_at - 60000) {
    const refreshRes = await fetch(XERO_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': 'Basic ' + btoa(`${clientId}:${clientSecret}`),
      },
      body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: tokens.refresh_token }),
    });
    const refreshData = await refreshRes.json();
    if (!refreshRes.ok) throw new Error('Xero token refresh failed: ' + JSON.stringify(refreshData));
    tokens = {
      access_token: refreshData.access_token,
      refresh_token: refreshData.refresh_token,
      expires_at: Date.now() + (refreshData.expires_in * 1000),
      token_type: refreshData.token_type,
    };
    await base44.asServiceRole.entities.Setting.update(settings[0].id, { value: JSON.stringify(tokens) });
  }

  const tenantSettings = await base44.asServiceRole.entities.Setting.filter({ key: 'xero_tenant_id' });
  if (tenantSettings.length === 0) throw new Error('Xero tenant ID not found');
  return { accessToken: tokens.access_token, tenantId: tenantSettings[0].value };
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Admin access required' }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    const searchTerm = (body.search || '').toLowerCase();

    const { accessToken, tenantId } = await getXeroTokens(base44);

    // Fetch all supplier contacts from Xero
    const res = await fetch(
      `https://api.xero.com/api.xro/2.0/Contacts?where=IsSupplier%3D%3Dtrue&includeArchived=false`,
      {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Xero-Tenant-Id': tenantId,
          'Accept': 'application/json',
        },
      }
    );
    if (!res.ok) throw new Error(`Xero API error (${res.status}): ${await res.text()}`);
    const data = await res.json();
    const contacts = data.Contacts || [];

    // Filter by search term
    const matches = searchTerm
      ? contacts.filter(c => (c.Name || '').toLowerCase().includes(searchTerm))
      : contacts;

    return Response.json({
      total_supplier_contacts: contacts.length,
      search: searchTerm || '(all)',
      matches: matches.map(c => ({
        name: c.Name,
        contact_id: c.ContactID,
        email: c.EmailAddress || '',
        phone: (c.Phones || []).find(p => p.PhoneNumber)?.PhoneNumber || '',
        status: c.ContactStatus,
        tax_number: c.TaxNumber || '',
        outstanding: c.Balances?.AccountsPayable?.Outstanding || 0,
        overdue: c.Balances?.AccountsPayable?.Overdue || 0,
      })),
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});