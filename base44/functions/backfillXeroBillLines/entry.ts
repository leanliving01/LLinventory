import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * Backfills line items for Xero-sourced POs/bills that are missing them.
 * Fetches each bill individually from Xero (the detail endpoint includes LineItems).
 * Processes in batches to avoid timeouts.
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

function parseUomFromDescription(description) {
  if (!description) return null;
  const d = description.toUpperCase();
  if (/P\/KG|\/KG|PER\s*KG|PER\s*KILO/i.test(d)) return 'kg';
  if (/P\/G\b|\/G\b|PER\s*GRAM/i.test(d)) return 'g';
  if (/P\/L\b|\/L\b|PER\s*LIT/i.test(d)) return 'L';
  if (/P\/ML|\/ML|PER\s*ML/i.test(d)) return 'ml';
  if (/\bEACH\b/i.test(d)) return 'pcs';
  if (/\d+\s*[xX]\s*\d+\s*(kg|g|l|ml)\b/i.test(d)) return 'box';
  return null;
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Admin access required' }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    const batchSize = body.batch_size || 40; // How many bills to process per call

    const { accessToken, tenantId } = await getXeroTokens(base44);

    // 1. Find Xero-sourced POs that have no line items
    const allPOs = await base44.asServiceRole.entities.PurchaseOrder.filter(
      { source: 'xero' }, '-created_date', 2000
    );
    const allLines = await base44.asServiceRole.entities.PurchaseOrderLine.list('-created_date', 5000);

    // Build set of PO IDs that already have lines
    const posWithLines = new Set();
    allLines.forEach(l => posWithLines.add(l.purchase_order_id));

    const missingPOs = allPOs.filter(po => po.xero_po_id && !posWithLines.has(po.id));
    console.log(`Total Xero POs: ${allPOs.length}, Missing lines: ${missingPOs.length}`);

    if (missingPOs.length === 0) {
      return Response.json({ success: true, message: 'All bills already have line items.', processed: 0, remaining: 0 });
    }

    // 2. Process a batch
    const batch = missingPOs.slice(0, batchSize);
    let processed = 0;
    let linesCreated = 0;
    const errors = [];

    for (const po of batch) {
      try {
        // Rate-limit: small delay between Xero API calls (Xero allows ~60/min)
        if (processed > 0 && processed % 10 === 0) {
          await new Promise(r => setTimeout(r, 1500));
        }

        // Fetch individual invoice/bill from Xero (includes LineItems)
        const res = await fetch(
          `https://api.xero.com/api.xro/2.0/Invoices/${po.xero_po_id}`,
          {
            headers: {
              'Authorization': `Bearer ${accessToken}`,
              'Xero-Tenant-Id': tenantId,
              'Accept': 'application/json',
            },
          }
        );

        if (!res.ok) {
          // Might be a PurchaseOrder, not an Invoice
          const poRes = await fetch(
            `https://api.xero.com/api.xro/2.0/PurchaseOrders/${po.xero_po_id}`,
            {
              headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Xero-Tenant-Id': tenantId,
                'Accept': 'application/json',
              },
            }
          );
          if (poRes.ok) {
            const poData = await poRes.json();
            const xpo = poData.PurchaseOrders?.[0];
            if (xpo?.LineItems?.length > 0) {
              const lineRecords = xpo.LineItems.map(xl => ({
                purchase_order_id: po.id,
                product_id: 'unmatched',
                product_name: xl.Description || xl.ItemCode || 'Unknown',
                product_sku: xl.ItemCode || '',
                ordered_qty: xl.Quantity || 0,
                received_qty: 0,
                unit_cost: xl.UnitAmount || 0,
                uom: xl.UnitOfMeasure || parseUomFromDescription(xl.Description) || 'pcs',
                line_total: xl.LineAmount || 0,
                tax_rule: xl.TaxType || '',
              }));
              for (let i = 0; i < lineRecords.length; i += 25) {
                await base44.asServiceRole.entities.PurchaseOrderLine.bulkCreate(lineRecords.slice(i, i + 25));
              }
              linesCreated += lineRecords.length;
            }
          } else {
            errors.push({ po_number: po.po_number, error: `Not found in Xero (${res.status})` });
          }
          processed++;
          continue;
        }

        const data = await res.json();
        const invoice = data.Invoices?.[0];
        if (!invoice?.LineItems?.length) {
          processed++;
          continue;
        }

        const lineRecords = invoice.LineItems.map(xl => ({
          purchase_order_id: po.id,
          product_id: 'unmatched',
          product_name: xl.Description || xl.ItemCode || 'Unknown',
          product_sku: xl.ItemCode || '',
          ordered_qty: xl.Quantity || 1,
          received_qty: 0,
          unit_cost: xl.UnitAmount || 0,
          uom: xl.UnitOfMeasure || parseUomFromDescription(xl.Description) || 'pcs',
          line_total: xl.LineAmount || 0,
          tax_rule: xl.TaxType || '',
        }));

        for (let i = 0; i < lineRecords.length; i += 25) {
          await base44.asServiceRole.entities.PurchaseOrderLine.bulkCreate(lineRecords.slice(i, i + 25));
        }
        linesCreated += lineRecords.length;
        processed++;
      } catch (e) {
        errors.push({ po_number: po.po_number, error: e.message });
        processed++;
      }
    }

    const remaining = missingPOs.length - processed;
    console.log(`Processed: ${processed}, Lines created: ${linesCreated}, Remaining: ${remaining}`);

    return Response.json({
      success: true,
      processed,
      lines_created: linesCreated,
      remaining,
      errors: errors.slice(0, 10),
      message: remaining > 0
        ? `Processed ${processed} bills (${linesCreated} lines). ${remaining} remaining — run again to continue.`
        : `Done! Processed ${processed} bills (${linesCreated} lines). All bills now have line items.`,
    });
  } catch (error) {
    console.error('backfillXeroBillLines error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});