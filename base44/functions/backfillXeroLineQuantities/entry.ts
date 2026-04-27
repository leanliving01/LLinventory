import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * Backfills correct quantities on PO lines from Xero.
 * 
 * Root cause: Xero's list endpoints don't always include Quantity on line items.
 * Our sync defaulted to 1 (bills) or 0 (POs). This function re-fetches each
 * bill/PO individually from Xero (detail endpoint has full LineItems) and
 * updates our records with the correct quantities.
 *
 * Matches lines by Description (product_name) since we don't store Xero line IDs.
 * Processes in batches to avoid Xero rate limits.
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

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Admin access required' }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    const batchSize = body.batch_size || 25;
    const dryRun = body.dry_run === true;

    const { accessToken, tenantId } = await getXeroTokens(base44);

    // 1. Load all Xero-sourced POs
    const allPOs = await base44.asServiceRole.entities.PurchaseOrder.filter(
      { source: 'xero' }, '-created_date', 2000
    );

    // 2. Load all PO lines
    let allLines = [];
    let offset = 0;
    while (true) {
      const batch = await base44.asServiceRole.entities.PurchaseOrderLine.filter(
        {}, 'created_date', 500, offset
      );
      allLines = allLines.concat(batch);
      if (batch.length < 500) break;
      offset += 500;
    }

    // 3. Find POs that have lines with suspicious qty (ordered_qty <= 1 AND line_total > 30)
    const linesByPO = {};
    allLines.forEach(l => {
      if (!linesByPO[l.purchase_order_id]) linesByPO[l.purchase_order_id] = [];
      linesByPO[l.purchase_order_id].push(l);
    });

    const posToFix = allPOs.filter(po => {
      if (!po.xero_po_id) return false;
      const poLines = linesByPO[po.id] || [];
      // Has at least one suspicious line
      return poLines.some(l => l.ordered_qty <= 1 && (l.line_total || 0) > 30);
    });

    console.log(`POs needing qty fix: ${posToFix.length} out of ${allPOs.length}`);

    if (dryRun) {
      return Response.json({
        dry_run: true,
        total_xero_pos: allPOs.length,
        pos_needing_fix: posToFix.length,
        sample: posToFix.slice(0, 10).map(po => ({
          po_number: po.po_number,
          xero_id: po.xero_po_id,
          lines: (linesByPO[po.id] || []).filter(l => l.ordered_qty <= 1 && (l.line_total || 0) > 30).map(l => ({
            name: l.product_name,
            qty: l.ordered_qty,
            unit_cost: l.unit_cost,
            line_total: l.line_total,
          })),
        })),
      });
    }

    // 4. Process a batch
    const batch = posToFix.slice(0, batchSize);
    let processed = 0;
    let linesUpdated = 0;
    const errors = [];
    const fixDetails = [];

    for (const po of batch) {
      try {
        // Rate limit: pause every 8 API calls
        if (processed > 0 && processed % 8 === 0) {
          await new Promise(r => setTimeout(r, 3000));
        }

        // Try as Invoice first, then as PurchaseOrder
        let xeroLineItems = null;

        const invRes = await fetch(
          `https://api.xero.com/api.xro/2.0/Invoices/${po.xero_po_id}`,
          {
            headers: {
              'Authorization': `Bearer ${accessToken}`,
              'Xero-Tenant-Id': tenantId,
              'Accept': 'application/json',
            },
          }
        );
        if (invRes.ok) {
          const invData = await invRes.json();
          xeroLineItems = invData.Invoices?.[0]?.LineItems;
        }

        if (!xeroLineItems) {
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
            xeroLineItems = poData.PurchaseOrders?.[0]?.LineItems;
          }
        }

        if (!xeroLineItems || xeroLineItems.length === 0) {
          errors.push({ po_number: po.po_number, error: 'No line items found in Xero' });
          processed++;
          continue;
        }

        // Match our lines to Xero lines by Description
        const ourLines = linesByPO[po.id] || [];
        for (const ourLine of ourLines) {
          // Only fix suspicious lines (qty ≤ 1 with high total)
          if (ourLine.ordered_qty > 1 || (ourLine.line_total || 0) <= 30) continue;

          // Find matching Xero line by description
          const xeroMatch = xeroLineItems.find(xl =>
            (xl.Description || '').toLowerCase().trim() === (ourLine.product_name || '').toLowerCase().trim()
          );

          if (xeroMatch && xeroMatch.Quantity != null && xeroMatch.Quantity !== ourLine.ordered_qty) {
            const newQty = xeroMatch.Quantity;
            const newUnitCost = xeroMatch.UnitAmount || ourLine.unit_cost;
            const newLineTotal = Math.round(newQty * newUnitCost * 100) / 100;
            const updates = {
              ordered_qty: newQty,
              received_qty: newQty,  // Bills are already received — set received = ordered
              unit_cost: newUnitCost,
              line_total: newLineTotal,
            };

            await base44.asServiceRole.entities.PurchaseOrderLine.update(ourLine.id, updates);
            fixDetails.push({
              po: po.po_number,
              name: ourLine.product_name,
              old_qty: ourLine.ordered_qty,
              new_qty: xeroMatch.Quantity,
              old_unit_cost: ourLine.unit_cost,
              new_unit_cost: xeroMatch.UnitAmount,
              line_total: ourLine.line_total,
            });
            linesUpdated++;
          }
        }
        processed++;
      } catch (e) {
        errors.push({ po_number: po.po_number, error: e.message });
        processed++;
      }
    }

    const remaining = posToFix.length - processed;
    console.log(`Processed: ${processed} POs, Lines updated: ${linesUpdated}, Remaining: ${remaining}`);

    return Response.json({
      success: true,
      processed_pos: processed,
      lines_updated: linesUpdated,
      remaining_pos: remaining,
      errors: errors.slice(0, 10),
      fix_details: fixDetails.slice(0, 50),
      message: remaining > 0
        ? `Fixed ${linesUpdated} lines across ${processed} POs. ${remaining} POs remaining — run again.`
        : `Done! Fixed ${linesUpdated} lines across ${processed} POs.`,
    });
  } catch (error) {
    console.error('backfillXeroLineQuantities error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});