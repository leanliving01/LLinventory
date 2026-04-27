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
    if (!refreshRes.ok) throw new Error('Token refresh failed: ' + JSON.stringify(refreshData));
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
    const xeroId = body.xero_id || 'c66ef155-be2c-4973-89e0-1a290306578e'; // sample problem PO

    const { accessToken, tenantId } = await getXeroTokens(base44);
    const headers = {
      'Authorization': `Bearer ${accessToken}`,
      'Xero-Tenant-Id': tenantId,
      'Accept': 'application/json',
    };

    // Try as Invoice first
    const invRes = await fetch(`https://api.xero.com/api.xro/2.0/Invoices/${xeroId}`, { headers });
    let result = null;
    let docType = null;

    if (invRes.ok) {
      const invData = await invRes.json();
      const inv = invData.Invoices?.[0];
      if (inv) {
        docType = 'Invoice';
        result = {
          type: docType,
          status: inv.Status,
          invoice_number: inv.InvoiceNumber,
          contact: inv.Contact?.Name,
          date: inv.Date,
          total: inv.Total,
          line_items: inv.LineItems?.map(li => ({
            description: li.Description,
            quantity: li.Quantity,
            unit_amount: li.UnitAmount,
            line_amount: li.LineAmount,
            account_code: li.AccountCode,
            tax_type: li.TaxType,
            item_code: li.ItemCode,
          })),
        };
      }
    }

    if (!result) {
      const poRes = await fetch(`https://api.xero.com/api.xro/2.0/PurchaseOrders/${xeroId}`, { headers });
      if (poRes.ok) {
        const poData = await poRes.json();
        const po = poData.PurchaseOrders?.[0];
        if (po) {
          docType = 'PurchaseOrder';
          result = {
            type: docType,
            status: po.Status,
            po_number: po.PurchaseOrderNumber,
            contact: po.Contact?.Name,
            date: po.Date,
            total: po.Total,
            delivery_date: po.DeliveryDate,
            line_items: po.LineItems?.map(li => ({
              description: li.Description,
              quantity: li.Quantity,
              unit_amount: li.UnitAmount,
              line_amount: li.LineAmount,
              account_code: li.AccountCode,
              tax_type: li.TaxType,
              item_code: li.ItemCode,
            })),
          };
        }
      }
    }

    if (!result) {
      return Response.json({ error: 'Not found in Xero as Invoice or PO', xero_id: xeroId });
    }

    return Response.json(result);
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});