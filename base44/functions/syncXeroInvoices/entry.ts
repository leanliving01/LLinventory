import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * Syncs ACCPAY bills from Xero into PurchaseInvoice + PurchaseInvoiceLine.
 * Auto-matches lines to SupplierProduct via xero_item_code.
 * Dedup key: xero_bill_id on PurchaseInvoice.
 */

const XERO_TOKEN_URL = 'https://identity.xero.com/connect/token';

async function getXeroTokens(base44) {
  const clientId = Deno.env.get('XERO_CLIENT_ID');
  const clientSecret = Deno.env.get('XERO_CLIENT_SECRET');
  const settings = await base44.asServiceRole.entities.Setting.filter({ key: 'xero_tokens' });
  if (settings.length === 0) throw new Error('Xero not connected. Go to Settings → Connect to Xero first.');

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

async function xeroGet(url, accessToken, tenantId) {
  const res = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Xero-Tenant-Id': tenantId,
      'Accept': 'application/json',
    },
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Xero API error (${res.status}): ${err}`);
  }
  return res.json();
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Admin access required' }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    const sinceDate = body.since || '2026-01-01';

    const { accessToken, tenantId } = await getXeroTokens(base44);

    // 1. Load our suppliers (match by xero_contact_id)
    const ourSuppliers = await base44.asServiceRole.entities.Supplier.filter({}, 'name', 500);
    const supplierByXeroContact = {};
    ourSuppliers.forEach(s => {
      if (s.xero_contact_id) supplierByXeroContact[s.xero_contact_id] = s;
    });
    // Also build name lookup for fallback
    const supplierByNameLower = {};
    ourSuppliers.forEach(s => { supplierByNameLower[s.name.toLowerCase().trim()] = s; });

    // 2. Load supplier products for auto-matching
    const allSPs = await base44.asServiceRole.entities.SupplierProduct.filter({ active: true }, 'product_name', 2000);
    // Build lookup: xero_item_code → SupplierProduct (per supplier)
    const spByXeroCode = {}; // key: `${supplier_id}::${xero_item_code_lower}`
    const spByDescription = {}; // key: `${supplier_id}::${description_lower}`
    allSPs.forEach(sp => {
      if (sp.xero_item_code) {
        spByXeroCode[`${sp.supplier_id}::${sp.xero_item_code.toLowerCase().trim()}`] = sp;
      }
      if (sp.supplier_description) {
        spByDescription[`${sp.supplier_id}::${sp.supplier_description.toLowerCase().trim()}`] = sp;
      }
    });

    // 3. Load existing invoices for dedup
    const existingInvoices = await base44.asServiceRole.entities.PurchaseInvoice.list('-created_date', 2000);
    const existingByXeroBillId = {};
    existingInvoices.forEach(inv => { if (inv.xero_bill_id) existingByXeroBillId[inv.xero_bill_id] = inv; });

    // 4. Fetch Xero ACCPAY bills (paginated)
    let page = 1;
    let allBills = [];
    const billWhere = encodeURIComponent(`Type=="ACCPAY"&&Date>=DateTime(${sinceDate.replace(/-/g, ',')})`);
    while (true) {
      const billData = await xeroGet(
        `https://api.xero.com/api.xro/2.0/Invoices?where=${billWhere}&page=${page}&order=DateString%20DESC`,
        accessToken, tenantId
      );
      const bills = billData.Invoices || [];
      allBills = allBills.concat(bills);
      if (bills.length < 100) break;
      page++;
    }

    console.log(`Xero: ${allBills.length} ACCPAY bills since ${sinceDate}`);

    let created = 0;
    let updated = 0;
    let linesCreated = 0;
    let autoMatched = 0;
    let unmatched = 0;
    const skipped = [];

    for (const bill of allBills) {
      const contactId = bill.Contact?.ContactID;
      // Match supplier
      let supplier = contactId ? supplierByXeroContact[contactId] : null;
      if (!supplier) {
        // Fallback: match by name
        const xName = (bill.Contact?.Name || '').toLowerCase().trim();
        supplier = supplierByNameLower[xName];
      }
      if (!supplier) {
        skipped.push(bill.Contact?.Name || bill.InvoiceNumber || 'Unknown');
        continue;
      }

      const existing = existingByXeroBillId[bill.InvoiceID];
      const paymentStatus = bill.Status === 'PAID' ? 'paid'
        : (bill.AmountDue === 0 && bill.Total > 0) ? 'paid'
        : bill.AmountPaid > 0 ? 'partially_paid' : 'unpaid';

      if (existing) {
        // Update status/totals
        const updates = {};
        if (existing.subtotal !== (bill.SubTotal || 0)) updates.subtotal = bill.SubTotal || 0;
        if (existing.tax_amount !== (bill.TotalTax || 0)) updates.tax_amount = bill.TotalTax || 0;
        if (existing.total !== (bill.Total || 0)) updates.total = bill.Total || 0;
        if (existing.payment_status !== paymentStatus) updates.payment_status = paymentStatus;
        if (Object.keys(updates).length > 0) {
          await base44.asServiceRole.entities.PurchaseInvoice.update(existing.id, updates);
          updated++;
        }
        continue;
      }

      // Fetch individual bill for line items
      let lineItems = bill.LineItems || [];
      if (lineItems.length === 0) {
        const detail = await xeroGet(
          `https://api.xero.com/api.xro/2.0/Invoices/${bill.InvoiceID}`,
          accessToken, tenantId
        );
        lineItems = detail.Invoices?.[0]?.LineItems || [];
      }

      // Count unmatched for the invoice
      let unmatchedCount = 0;

      // Create PurchaseInvoice
      const inv = await base44.asServiceRole.entities.PurchaseInvoice.create({
        invoice_number: bill.InvoiceNumber || `XBILL-${bill.InvoiceID.substring(0, 8)}`,
        supplier_id: supplier.id,
        supplier_name: supplier.name,
        xero_bill_id: bill.InvoiceID,
        xero_contact_id: contactId || '',
        source: 'xero_sync',
        status: 'pending_match',
        invoice_date: bill.DateString?.substring(0, 10) || null,
        due_date: bill.DueDateString?.substring(0, 10) || null,
        subtotal: bill.SubTotal || 0,
        tax_amount: bill.TotalTax || 0,
        total: bill.Total || 0,
        currency: bill.CurrencyCode || 'ZAR',
        payment_status: paymentStatus,
      });
      created++;

      // Create PurchaseInvoiceLines with auto-matching
      if (lineItems.length > 0) {
        const lineRecords = [];
        for (const xl of lineItems) {
          const itemCode = (xl.ItemCode || '').toLowerCase().trim();
          const desc = (xl.Description || '').toLowerCase().trim();

          // Try auto-match: xero_item_code first, then supplier_description
          let matchedSP = null;
          let matchStatus = 'unmatched';

          if (itemCode) {
            matchedSP = spByXeroCode[`${supplier.id}::${itemCode}`];
          }
          if (!matchedSP && desc) {
            matchedSP = spByDescription[`${supplier.id}::${desc}`];
          }

          if (matchedSP) {
            matchStatus = 'auto_matched';
            autoMatched++;
          } else {
            unmatchedCount++;
            unmatched++;
          }

          lineRecords.push({
            invoice_id: inv.id,
            xero_line_item_id: xl.LineItemID || '',
            xero_item_code: xl.ItemCode || '',
            xero_description: xl.Description || '',
            supplier_product_id: matchedSP?.id || '',
            product_id: matchedSP?.product_id || '',
            product_name: matchedSP?.product_name || '',
            product_sku: matchedSP?.product_sku || '',
            qty: xl.Quantity ?? 1,
            unit_cost: xl.UnitAmount || 0,
            tax_rule: xl.TaxType || '',
            line_total: xl.LineAmount || 0,
            match_status: matchStatus,
            account_code: xl.AccountCode || '',
          });
        }

        for (let i = 0; i < lineRecords.length; i += 25) {
          await base44.asServiceRole.entities.PurchaseInvoiceLine.bulkCreate(lineRecords.slice(i, i + 25));
        }
        linesCreated += lineRecords.length;
      }

      // Update invoice with match status
      const finalStatus = unmatchedCount === 0 ? 'matched' : 'pending_match';
      await base44.asServiceRole.entities.PurchaseInvoice.update(inv.id, {
        status: finalStatus,
        unmatched_line_count: unmatchedCount,
      });
    }

    return Response.json({
      success: true,
      summary: {
        since_date: sinceDate,
        xero_bills_found: allBills.length,
        invoices_created: created,
        invoices_updated: updated,
        lines_created: linesCreated,
        auto_matched_lines: autoMatched,
        unmatched_lines: unmatched,
        skipped_suppliers: skipped.slice(0, 20),
      },
    });
  } catch (error) {
    console.error('syncXeroInvoices error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});