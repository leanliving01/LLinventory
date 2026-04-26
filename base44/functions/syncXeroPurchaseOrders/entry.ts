import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * Syncs purchase orders from Xero — ONLY for suppliers that exist in our system.
 * Also enriches supplier contact details (name, phone, email, outstanding balance).
 *
 * Flow:
 * 1. Load our Suppliers
 * 2. Refresh Xero tokens if needed
 * 3. Fetch Xero Contacts, match by name to our Suppliers
 * 4. Update supplier contact details from Xero
 * 5. Fetch Xero POs only for matched contacts
 * 6. Map Xero PO statuses → our statuses, upsert POs + lines
 */

const XERO_TOKEN_URL = 'https://identity.xero.com/connect/token';

// Xero PO Status → Our status
function mapXeroStatus(xeroPO) {
  const s = (xeroPO.Status || '').toUpperCase();
  // DELETED in Xero = cancelled for us
  if (s === 'DELETED') return 'cancelled';
  // DRAFT
  if (s === 'DRAFT') return 'draft';
  // SUBMITTED = confirmed (sent to supplier)
  if (s === 'SUBMITTED') return 'confirmed';
  // AUTHORISED = confirmed/open
  if (s === 'AUTHORISED') return 'confirmed';
  // BILLED = we've received invoice
  if (s === 'BILLED') return 'invoiced';
  return 'draft';
}

async function getXeroTokens(base44) {
  const clientId = Deno.env.get('XERO_CLIENT_ID');
  const clientSecret = Deno.env.get('XERO_CLIENT_SECRET');

  const settings = await base44.asServiceRole.entities.Setting.filter({ key: 'xero_tokens' });
  if (settings.length === 0) throw new Error('Xero not connected. Go to Settings → Connect to Xero first.');

  let tokens = JSON.parse(settings[0].value);

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

    const { accessToken, tenantId } = await getXeroTokens(base44);

    // 1. Load our suppliers
    const ourSuppliers = await base44.asServiceRole.entities.Supplier.filter({}, 'name', 500);
    if (ourSuppliers.length === 0) {
      return Response.json({ error: 'No suppliers in the system. Add suppliers first.' }, { status: 400 });
    }

    // Build name → supplier lookup (lowercase for fuzzy matching)
    const supplierByName = {};
    ourSuppliers.forEach(s => {
      supplierByName[s.name.toLowerCase().trim()] = s;
    });

    // 2. Fetch Xero Contacts (Suppliers only)
    // includeArchived=false, where=IsSupplier==true
    const contactsData = await xeroGet(
      `https://api.xero.com/api.xro/2.0/Contacts?where=IsSupplier%3D%3Dtrue&includeArchived=false`,
      accessToken, tenantId
    );
    const xeroContacts = contactsData.Contacts || [];
    console.log(`Xero returned ${xeroContacts.length} supplier contacts`);

    // 3. Match Xero contacts to our suppliers
    const matchedContacts = []; // { xeroContact, ourSupplier }
    const unmatchedXero = [];

    for (const xc of xeroContacts) {
      const xName = (xc.Name || '').toLowerCase().trim();
      const match = supplierByName[xName];
      if (match) {
        matchedContacts.push({ xeroContact: xc, ourSupplier: match });
      } else {
        unmatchedXero.push(xc.Name);
      }
    }

    console.log(`Matched ${matchedContacts.length} suppliers, ${unmatchedXero.length} unmatched Xero contacts`);

    // 4. Update supplier contact details from Xero
    let suppliersUpdated = 0;
    for (const { xeroContact, ourSupplier } of matchedContacts) {
      const updates = {};

      // Xero Contact ID for future lookups
      if (ourSupplier.xero_contact_id !== xeroContact.ContactID) {
        updates.xero_contact_id = xeroContact.ContactID;
      }

      // Contact person
      const persons = xeroContact.ContactPersons || [];
      if (persons.length > 0) {
        const primary = persons[0];
        const fullName = [primary.FirstName, primary.LastName].filter(Boolean).join(' ');
        if (fullName && fullName !== ourSupplier.contact_name) updates.contact_name = fullName;
        if (primary.EmailAddress && primary.EmailAddress !== ourSupplier.email) updates.email = primary.EmailAddress;
      }
      // Fallback to contact-level email
      if (!updates.email && xeroContact.EmailAddress && xeroContact.EmailAddress !== ourSupplier.email) {
        updates.email = xeroContact.EmailAddress;
      }

      // Phone numbers
      const phones = xeroContact.Phones || [];
      const mainPhone = phones.find(p => p.PhoneType === 'DEFAULT') || phones.find(p => p.PhoneNumber);
      if (mainPhone?.PhoneNumber && mainPhone.PhoneNumber !== ourSupplier.phone) {
        updates.phone = [mainPhone.PhoneCountryCode, mainPhone.PhoneAreaCode, mainPhone.PhoneNumber].filter(Boolean).join(' ').trim();
      }

      // Tax number
      if (xeroContact.TaxNumber && xeroContact.TaxNumber !== ourSupplier.tax_id) {
        updates.tax_id = xeroContact.TaxNumber;
      }

      // Outstanding / overdue balances from Xero
      const outstanding = xeroContact.Balances?.AccountsPayable?.Outstanding || 0;
      const overdue = xeroContact.Balances?.AccountsPayable?.Overdue || 0;
      if (outstanding !== (ourSupplier.outstanding_balance || 0)) updates.outstanding_balance = outstanding;
      if (overdue !== (ourSupplier.overdue_balance || 0)) updates.overdue_balance = overdue;

      // Payment terms
      const paymentTerms = xeroContact.PaymentTerms?.Bills;
      if (paymentTerms?.Day && paymentTerms?.Type) {
        const termStr = `${paymentTerms.Day}d ${paymentTerms.Type}`;
        if (termStr !== ourSupplier.payment_terms) updates.payment_terms = termStr;
      }

      if (Object.keys(updates).length > 0) {
        await base44.asServiceRole.entities.Supplier.update(ourSupplier.id, updates);
        suppliersUpdated++;
      }
    }

    // 5. Fetch POs from Xero for matched contacts only
    // Fetch all non-deleted POs, then filter by contact
    const matchedContactIds = new Set(matchedContacts.map(m => m.xeroContact.ContactID));
    const supplierByContactId = {};
    matchedContacts.forEach(m => {
      supplierByContactId[m.xeroContact.ContactID] = m.ourSupplier;
    });

    // Paginate Xero POs (max 100 per page)
    let page = 1;
    let allXeroPOs = [];
    while (true) {
      const poData = await xeroGet(
        `https://api.xero.com/api.xro/2.0/PurchaseOrders?page=${page}&order=DateString%20DESC`,
        accessToken, tenantId
      );
      const pos = poData.PurchaseOrders || [];
      allXeroPOs = allXeroPOs.concat(pos);
      if (pos.length < 100) break;
      page++;
    }
    console.log(`Xero returned ${allXeroPOs.length} total POs`);

    // Filter to only our matched suppliers
    const relevantPOs = allXeroPOs.filter(po => po.Contact?.ContactID && matchedContactIds.has(po.Contact.ContactID));
    console.log(`${relevantPOs.length} POs match our suppliers`);

    // Load existing POs with xero_po_id for dedup
    const existingPOs = await base44.asServiceRole.entities.PurchaseOrder.filter({}, '-created_date', 2000);
    const existingByXeroId = {};
    existingPOs.forEach(po => {
      if (po.xero_po_id) existingByXeroId[po.xero_po_id] = po;
    });

    let posCreated = 0;
    let posUpdated = 0;
    let linesCreated = 0;

    for (const xpo of relevantPOs) {
      const supplier = supplierByContactId[xpo.Contact.ContactID];
      if (!supplier) continue;

      const ourStatus = mapXeroStatus(xpo);
      const poNumber = xpo.PurchaseOrderNumber || `XPO-${xpo.PurchaseOrderID.substring(0, 8)}`;
      const subtotal = xpo.SubTotal || 0;
      const tax = xpo.TotalTax || 0;
      const total = xpo.Total || 0;
      const orderDate = xpo.DateString ? xpo.DateString.substring(0, 10) : null;
      const expectedDate = xpo.DeliveryDateString ? xpo.DeliveryDateString.substring(0, 10) : null;

      const existing = existingByXeroId[xpo.PurchaseOrderID];

      if (existing) {
        // Update status and amounts if changed
        const updates = {};
        if (existing.status !== ourStatus) updates.status = ourStatus;
        if (existing.subtotal !== subtotal) updates.subtotal = subtotal;
        if (existing.tax !== tax) updates.tax = tax;
        if (existing.total !== total) updates.total = total;
        if (expectedDate && existing.expected_date !== expectedDate) updates.expected_date = expectedDate;
        if (Object.keys(updates).length > 0) {
          await base44.asServiceRole.entities.PurchaseOrder.update(existing.id, updates);
          posUpdated++;
        }
      } else {
        // Create new PO
        const newPO = await base44.asServiceRole.entities.PurchaseOrder.create({
          po_number: poNumber,
          supplier_id: supplier.id,
          supplier_name: supplier.name,
          status: ourStatus,
          order_date: orderDate,
          expected_date: expectedDate,
          subtotal,
          tax,
          total,
          currency: xpo.CurrencyCode || 'ZAR',
          payment_status: 'unpaid',
          xero_po_id: xpo.PurchaseOrderID,
          source: 'xero',
        });
        posCreated++;

        // Create PO lines
        const xeroLines = xpo.LineItems || [];
        const linesToCreate = [];
        for (const xl of xeroLines) {
          linesToCreate.push({
            purchase_order_id: newPO.id,
            product_id: 'unmatched',
            product_name: xl.Description || xl.ItemCode || 'Unknown',
            product_sku: xl.ItemCode || '',
            ordered_qty: xl.Quantity || 0,
            received_qty: 0,
            unit_cost: xl.UnitAmount || 0,
            uom: xl.UnitOfMeasure || 'pcs',
            line_total: xl.LineAmount || 0,
            tax_rule: xl.TaxType || '',
          });
        }
        if (linesToCreate.length > 0) {
          for (let i = 0; i < linesToCreate.length; i += 25) {
            await base44.asServiceRole.entities.PurchaseOrderLine.bulkCreate(linesToCreate.slice(i, i + 25));
          }
          linesCreated += linesToCreate.length;
        }
      }
    }

    return Response.json({
      success: true,
      summary: {
        xero_contacts_found: xeroContacts.length,
        suppliers_matched: matchedContacts.length,
        suppliers_updated: suppliersUpdated,
        unmatched_xero_contacts: unmatchedXero.slice(0, 20),
        xero_pos_total: allXeroPOs.length,
        relevant_pos: relevantPOs.length,
        pos_created: posCreated,
        pos_updated: posUpdated,
        lines_created: linesCreated,
      },
    });
  } catch (error) {
    console.error('syncXeroPurchaseOrders error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});