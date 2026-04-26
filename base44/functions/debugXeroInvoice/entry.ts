import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * Debug: fetch a single Xero invoice and return raw LineItems data
 * to see exactly what fields Xero provides (Quantity, UnitAmount, UnitOfMeasure, etc.)
 */

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
    if (!refreshRes.ok) throw new Error('Token refresh failed');
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
    const invoiceId = body.invoice_id;
    if (!invoiceId) return Response.json({ error: 'invoice_id required' }, { status: 400 });

    const { accessToken, tenantId } = await getXeroTokens(base44);

    const res = await fetch(`https://api.xero.com/api.xro/2.0/Invoices/${invoiceId}`, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Xero-Tenant-Id': tenantId,
        'Accept': 'application/json',
      },
    });
    if (!res.ok) {
      const err = await res.text();
      return Response.json({ error: `Xero API ${res.status}: ${err}` }, { status: 500 });
    }

    const data = await res.json();
    const invoice = data.Invoices?.[0];

    // Return full line items with all their fields
    return Response.json({
      invoice_number: invoice?.InvoiceNumber,
      contact_name: invoice?.Contact?.Name,
      status: invoice?.Status,
      line_items: (invoice?.LineItems || []).map(li => ({
        Description: li.Description,
        ItemCode: li.ItemCode,
        Quantity: li.Quantity,
        UnitAmount: li.UnitAmount,
        LineAmount: li.LineAmount,
        UnitOfMeasure: li.UnitOfMeasure,
        TaxType: li.TaxType,
        AccountCode: li.AccountCode,
        // Include any other fields
        _raw_keys: Object.keys(li),
      })),
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});