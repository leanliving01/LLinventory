import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * Probe: check what attachments exist on Xero invoices for our POs.
 * Also downloads the first PDF and uploads it to get a file_url for extraction.
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
    const { accessToken, tenantId } = await getXeroTokens(base44);

    // If a specific invoice_id is provided, probe that one
    if (body.invoice_id) {
      const attRes = await fetch(
        `https://api.xero.com/api.xro/2.0/Invoices/${body.invoice_id}/Attachments`,
        {
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Xero-Tenant-Id': tenantId,
            'Accept': 'application/json',
          },
        }
      );
      if (!attRes.ok) {
        return Response.json({ error: `Attachments API ${attRes.status}: ${await attRes.text()}` });
      }
      const attData = await attRes.json();
      const attachments = attData.Attachments || [];

      // If requested, download and upload the first PDF
      let extracted = null;
      if (body.download_first && attachments.length > 0) {
        const pdf = attachments.find(a => a.MimeType === 'application/pdf') || attachments[0];
        const dlUrl = `https://api.xero.com/api.xro/2.0/Invoices/${body.invoice_id}/Attachments/${pdf.FileName}`;
        const dlRes = await fetch(dlUrl, {
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Xero-Tenant-Id': tenantId,
          },
        });
        if (dlRes.ok) {
          const fileBlob = await dlRes.blob();
          const file = new File([fileBlob], pdf.FileName, { type: pdf.MimeType });
          const { file_url } = await base44.asServiceRole.integrations.Core.UploadFile({ file });
          extracted = { file_url, filename: pdf.FileName, mime: pdf.MimeType, size: pdf.ContentLength };
        }
      }

      return Response.json({
        invoice_id: body.invoice_id,
        attachment_count: attachments.length,
        attachments: attachments.map(a => ({
          FileName: a.FileName,
          MimeType: a.MimeType,
          ContentLength: a.ContentLength,
          Url: a.Url,
        })),
        uploaded_pdf: extracted,
      });
    }

    // Otherwise, sample a few POs that have qty=1 high-value lines
    const samplePOs = await base44.asServiceRole.entities.PurchaseOrder.filter(
      { source: 'xero' }, '-total', body.limit || 5
    );

    const results = [];
    for (const po of samplePOs) {
      if (!po.xero_po_id) continue;
      
      // Try as Invoice first, then as PurchaseOrder
      let attRes = await fetch(
        `https://api.xero.com/api.xro/2.0/Invoices/${po.xero_po_id}/Attachments`,
        {
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Xero-Tenant-Id': tenantId,
            'Accept': 'application/json',
          },
        }
      );
      
      let endpoint = 'Invoices';
      if (!attRes.ok) {
        attRes = await fetch(
          `https://api.xero.com/api.xro/2.0/PurchaseOrders/${po.xero_po_id}/Attachments`,
          {
            headers: {
              'Authorization': `Bearer ${accessToken}`,
              'Xero-Tenant-Id': tenantId,
              'Accept': 'application/json',
            },
          }
        );
        endpoint = 'PurchaseOrders';
      }

      if (attRes.ok) {
        const attData = await attRes.json();
        const attachments = attData.Attachments || [];
        results.push({
          po_number: po.po_number,
          supplier: po.supplier_name,
          total: po.total,
          xero_id: po.xero_po_id,
          endpoint,
          attachment_count: attachments.length,
          attachments: attachments.map(a => ({
            FileName: a.FileName,
            MimeType: a.MimeType,
            ContentLength: a.ContentLength,
          })),
        });
      } else {
        results.push({
          po_number: po.po_number,
          supplier: po.supplier_name,
          total: po.total,
          xero_id: po.xero_po_id,
          error: `${attRes.status}`,
        });
      }
    }

    return Response.json({ sampled: results.length, results });
  } catch (error) {
    console.error('probeXeroAttachments error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});