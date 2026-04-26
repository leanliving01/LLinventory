import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * Syncs purchase orders AND bills (Accounts Payable invoices) from Xero —
 * ONLY for suppliers that exist in our system.
 * Also enriches supplier contact details (name, phone, email, outstanding balance).
 *
 * Matching: exact name first, then fuzzy (normalised word-set overlap ≥ 60%).
 * Bills date range: 2026-01-01 onwards (configurable via payload).
 */

const XERO_TOKEN_URL = 'https://identity.xero.com/connect/token';

// ─── Fuzzy matching ───
function normaliseWords(name) {
  return (name || '')
    .toLowerCase()
    .replace(/\(pty\)\s*ltd/gi, '')
    .replace(/\bpty\b/gi, '')
    .replace(/\bltd\b/gi, '')
    .replace(/\bcc\b/gi, '')
    .replace(/\bedms\b/gi, '')
    .replace(/\bbpk\b/gi, '')
    .replace(/\bt\/a\b/gi, '')
    .replace(/[^a-z0-9\s]/g, '')
    .split(/\s+/)
    .filter(w => w.length > 1)
    .sort();
}

function fuzzyScore(a, b) {
  const wordsA = normaliseWords(a);
  const wordsB = normaliseWords(b);
  if (wordsA.length === 0 || wordsB.length === 0) return 0;
  const setA = new Set(wordsA);
  const setB = new Set(wordsB);
  let overlap = 0;
  for (const w of setA) { if (setB.has(w)) overlap++; }
  // Jaccard-like: overlap / union
  const union = new Set([...setA, ...setB]).size;
  return overlap / union;
}

// ─── UoM parsing from description ───
function parseUomFromDescription(description) {
  if (!description) return null;
  const d = description;
  const D = d.toUpperCase();

  // Skip: packaging, admin debits, numeric codes, labels, tape
  if (/^\d+\s+off\s+\d/i.test(d)) return null;
  if (/Admin debit/i.test(d)) return null;
  if (/^[\d]+$/.test(d.trim())) return null;
  if (/TAPE|LABEL|STICKER|CARTON|OUTER|PRINTED|LIDS|SIDES|TOPS|BOTTOMS/i.test(D)) return null;

  // "EACH" means pcs — check FIRST
  if (/\bEACH\b/i.test(D)) return 'pcs';

  // Explicit per-unit patterns
  if (/P['\u2019\/]KG|P\/KG|\/KG\b|PER\s*KG|PER\s*KILO/i.test(D)) return 'kg';
  if (/P\/G\b|\/G\b|PER\s*GRAM/i.test(D)) return 'g';
  if (/P\/L\b|\/L\b|PER\s*LIT/i.test(D)) return 'L';
  if (/P\/ML|\/ML|PER\s*ML/i.test(D)) return 'ml';

  // Bulk box patterns
  if (/\d+\s*[xX]\s*\d+\s*(KG|G|L|ML)\b/i.test(D)) return 'box';

  // Volume: litres
  if (/\d+\s*LT\b|\d+\s*LITRE/i.test(D)) return 'L';

  // Weight in description
  if (/\b\d+(\.\d+)?\s*KG\b/i.test(D)) return 'kg';
  if (/\b\d+\s*GR\b/i.test(D)) return 'kg';

  // Meat keywords
  const MEAT = ['MINCE','RUMP','SIRLOIN','FILLET','STEAK','BEEF','STIRFRY','STIR FRY','TRINCHADO','BRISKET','TOPSIDE','SILVERSIDE','CHICKEN BREAST','CHICKEN THIGH','CHICKEN DRUM','CHICKEN STRIP','CHICKEN DICED','CHICKEN B/L','HAKE','SALMON','FISH','CALAMARI','PRAWN','SHRIMP','LAMB','PORK','BACON','BILTONG','BOEREWORS','OSTRICH'];
  for (const kw of MEAT) { if (D.includes(kw)) return 'kg'; }

  // Produce keywords
  const PRODUCE = ['BRINGAL','BRINJAL','AUBERGINE','EGGPLANT','MUSHROOM','BABY MARROW','COURGETTE','ZUCCHINI','SWEET POTATO','BUTTERNUT','PUMPKIN','CABBAGE','LETTUCE','SPINACH','KALE','TOMATO','CHERRY TOM','GINGER','GARLIC PEELED','CORIANDER','GREEN BEANS','MANGE TOUT','SNAP PEAS','CAULIFLOWER','BROCCOLI','CELERY','CORN'];
  for (const kw of PRODUCE) { if (D.includes(kw)) return 'kg'; }

  if (/\bLOOSE\b/i.test(D)) return 'kg';
  if (/\b(ONION|POTATO|RED ONION)\b.*BAG/i.test(D)) return 'kg';

  // Bulk weight keywords
  const BULK = ['SPICE','SEASONING','PREMIX','PAPRIKA','CUMIN','TURMERIC','CINNAMON','CHILLI FLAKE','PEANUT BUTTER','MAYONNAISE','MAYO','TOMATO PASTE','TOMATO PUREE','COCONUT CREAM','COCONUT MILK','STOCK','BOUILLON','CHEESE','CREAM CHEESE','FETA','MOZZARELLA','CHEDDAR','PARMESAN','YOGHURT','YOGURT','BUTTER UNSALTED','BUTTER SALTED','MARGARINE','HONEY','FLOUR','RICE','PASTA','SPAGHETTI','NOODLE','MACARONI','PENNE','FUSILLI','LENTIL','CHICKPEA','CHICK PEA','KIDNEY','QUINOA','COUSCOUS','BULGUR','OATS'];
  for (const kw of BULK) { if (D.includes(kw)) return 'kg'; }

  if (/TINNED|CANNED|TIN\b/i.test(D)) return 'kg';

  // Sauces/condiments in litres
  const SAUCE = ['SOY SAUCE','SOYA LIGHT','SOYA HONEY','WORCESTER','TABASCO','HOT SAUCE','SWEET CHILLI','SRIRACHA','BBQ SAUCE','BARBEQUE SAUCE','VINEGAR','BALSAMIC','TOPPING VERSATIE','STEAKHOUSE','DRESSING SALAD','FRENCH DRESSING','JUICE LEMON','MILK LONG LIFE'];
  for (const kw of SAUCE) { if (D.includes(kw)) return 'L'; }

  if (/\bOIL\b/i.test(D)) return 'L';
  if (/PEPPADEW|PIQUANTE/i.test(D)) return 'kg';
  if (/\bBOX\b/i.test(D)) return 'box';
  if (/POLY\s*\d/i.test(D)) return 'kg';

  return null;
}

// ─── Status mapping ───
function mapXeroStatus(xeroPO) {
  const s = (xeroPO.Status || '').toUpperCase();
  if (s === 'DELETED') return 'cancelled';
  if (s === 'DRAFT') return 'draft';
  if (s === 'SUBMITTED') return 'confirmed';
  if (s === 'AUTHORISED') return 'confirmed';
  if (s === 'BILLED') return 'invoiced';
  return 'draft';
}

function mapXeroBillStatus(bill) {
  const s = (bill.Status || '').toUpperCase();
  if (s === 'DRAFT') return 'draft';
  if (s === 'SUBMITTED') return 'confirmed';
  if (s === 'AUTHORISED') {
    // Check if fully paid
    if ((bill.AmountDue || 0) === 0 && (bill.Total || 0) > 0) return 'paid';
    return 'invoiced';
  }
  if (s === 'PAID') return 'paid';
  if (s === 'VOIDED' || s === 'DELETED') return 'cancelled';
  return 'draft';
}

function mapBillPaymentStatus(bill) {
  const s = (bill.Status || '').toUpperCase();
  if (s === 'PAID') return 'paid';
  if (s === 'AUTHORISED' && (bill.AmountDue || 0) === 0 && (bill.Total || 0) > 0) return 'paid';
  if (bill.IsOverdue) return 'overdue';
  return 'unpaid';
}

// ─── Xero helpers ───
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
    const sinceDate = body.since || '2026-01-01'; // Default: all of 2026
    const FUZZY_THRESHOLD = 0.5; // 50% word overlap required

    const { accessToken, tenantId } = await getXeroTokens(base44);

    // 1. Load our suppliers
    const ourSuppliers = await base44.asServiceRole.entities.Supplier.filter({}, 'name', 500);
    if (ourSuppliers.length === 0) {
      return Response.json({ error: 'No suppliers in the system.' }, { status: 400 });
    }

    // 2. Fetch Xero Contacts (suppliers only, include balances)
    const contactsData = await xeroGet(
      `https://api.xero.com/api.xro/2.0/Contacts?where=IsSupplier%3D%3Dtrue&includeArchived=false`,
      accessToken, tenantId
    );
    const xeroContacts = contactsData.Contacts || [];
    console.log(`Xero: ${xeroContacts.length} supplier contacts`);

    // 3. Match: exact name first, then fuzzy
    const supplierByNameExact = {};
    ourSuppliers.forEach(s => { supplierByNameExact[s.name.toLowerCase().trim()] = s; });

    const matchedContacts = []; // { xeroContact, ourSupplier, matchType }
    const unmatchedXero = [];
    const fuzzyMatches = []; // for reporting

    for (const xc of xeroContacts) {
      const xName = (xc.Name || '').toLowerCase().trim();
      // Exact match
      const exact = supplierByNameExact[xName];
      if (exact) {
        matchedContacts.push({ xeroContact: xc, ourSupplier: exact, matchType: 'exact' });
        continue;
      }
      // Fuzzy match — find best scoring supplier
      let bestScore = 0;
      let bestSupplier = null;
      for (const s of ourSuppliers) {
        // Skip already-matched suppliers (by xero_contact_id or exact)
        if (matchedContacts.some(m => m.ourSupplier.id === s.id)) continue;
        const score = fuzzyScore(xc.Name, s.name);
        if (score > bestScore) {
          bestScore = score;
          bestSupplier = s;
        }
      }
      if (bestScore >= FUZZY_THRESHOLD && bestSupplier) {
        matchedContacts.push({ xeroContact: xc, ourSupplier: bestSupplier, matchType: 'fuzzy' });
        fuzzyMatches.push({ xero: xc.Name, ours: bestSupplier.name, score: Math.round(bestScore * 100) + '%' });
      } else {
        unmatchedXero.push(xc.Name);
      }
    }

    console.log(`Matched: ${matchedContacts.length} (${fuzzyMatches.length} fuzzy), Unmatched: ${unmatchedXero.length}`);

    // 4. Update supplier details from Xero
    let suppliersUpdated = 0;
    for (const { xeroContact, ourSupplier } of matchedContacts) {
      const updates = {};
      if (ourSupplier.xero_contact_id !== xeroContact.ContactID) updates.xero_contact_id = xeroContact.ContactID;

      const persons = xeroContact.ContactPersons || [];
      if (persons.length > 0) {
        const p = persons[0];
        const fullName = [p.FirstName, p.LastName].filter(Boolean).join(' ');
        if (fullName && fullName !== ourSupplier.contact_name) updates.contact_name = fullName;
        if (p.EmailAddress && p.EmailAddress !== ourSupplier.email) updates.email = p.EmailAddress;
      }
      if (!updates.email && xeroContact.EmailAddress && xeroContact.EmailAddress !== ourSupplier.email) {
        updates.email = xeroContact.EmailAddress;
      }

      const phones = xeroContact.Phones || [];
      const mainPhone = phones.find(p => p.PhoneType === 'DEFAULT') || phones.find(p => p.PhoneNumber);
      if (mainPhone?.PhoneNumber && mainPhone.PhoneNumber !== ourSupplier.phone) {
        updates.phone = [mainPhone.PhoneCountryCode, mainPhone.PhoneAreaCode, mainPhone.PhoneNumber].filter(Boolean).join(' ').trim();
      }

      if (xeroContact.TaxNumber && xeroContact.TaxNumber !== ourSupplier.tax_id) updates.tax_id = xeroContact.TaxNumber;

      const outstanding = xeroContact.Balances?.AccountsPayable?.Outstanding || 0;
      const overdue = xeroContact.Balances?.AccountsPayable?.Overdue || 0;
      if (outstanding !== (ourSupplier.outstanding_balance || 0)) updates.outstanding_balance = outstanding;
      if (overdue !== (ourSupplier.overdue_balance || 0)) updates.overdue_balance = overdue;

      const pt = xeroContact.PaymentTerms?.Bills;
      if (pt?.Day && pt?.Type) {
        const termStr = `${pt.Day}d ${pt.Type}`;
        if (termStr !== ourSupplier.payment_terms) updates.payment_terms = termStr;
      }

      if (Object.keys(updates).length > 0) {
        await base44.asServiceRole.entities.Supplier.update(ourSupplier.id, updates);
        suppliersUpdated++;
      }
    }

    // 5. Build lookup maps
    const matchedContactIds = new Set(matchedContacts.map(m => m.xeroContact.ContactID));
    const supplierByContactId = {};
    matchedContacts.forEach(m => { supplierByContactId[m.xeroContact.ContactID] = m.ourSupplier; });

    // Load existing POs for dedup
    const existingPOs = await base44.asServiceRole.entities.PurchaseOrder.filter({}, '-created_date', 2000);
    const existingByXeroId = {};
    existingPOs.forEach(po => { if (po.xero_po_id) existingByXeroId[po.xero_po_id] = po; });

    let posCreated = 0;
    let posUpdated = 0;
    let linesCreated = 0;

    // 6. Fetch Xero POs (paginated)
    let page = 1;
    let allXeroPOs = [];
    while (true) {
      const poData = await xeroGet(
        `https://api.xero.com/api.xro/2.0/PurchaseOrders?page=${page}&order=DateString%20DESC&DateFrom=${sinceDate}`,
        accessToken, tenantId
      );
      const pos = poData.PurchaseOrders || [];
      allXeroPOs = allXeroPOs.concat(pos);
      if (pos.length < 100) break;
      page++;
    }

    const relevantPOs = allXeroPOs.filter(po => po.Contact?.ContactID && matchedContactIds.has(po.Contact.ContactID));
    console.log(`POs: ${allXeroPOs.length} total, ${relevantPOs.length} matched`);

    for (const xpo of relevantPOs) {
      const supplier = supplierByContactId[xpo.Contact.ContactID];
      if (!supplier) continue;
      const existing = existingByXeroId[xpo.PurchaseOrderID];
      const ourStatus = mapXeroStatus(xpo);
      const poNumber = xpo.PurchaseOrderNumber || `XPO-${xpo.PurchaseOrderID.substring(0, 8)}`;

      if (existing) {
        const updates = {};
        if (existing.status !== ourStatus) updates.status = ourStatus;
        if (existing.subtotal !== (xpo.SubTotal || 0)) updates.subtotal = xpo.SubTotal || 0;
        if (existing.tax !== (xpo.TotalTax || 0)) updates.tax = xpo.TotalTax || 0;
        if (existing.total !== (xpo.Total || 0)) updates.total = xpo.Total || 0;
        if (Object.keys(updates).length > 0) {
          await base44.asServiceRole.entities.PurchaseOrder.update(existing.id, updates);
          posUpdated++;
        }
      } else {
        const newPO = await base44.asServiceRole.entities.PurchaseOrder.create({
          po_number: poNumber,
          supplier_id: supplier.id,
          supplier_name: supplier.name,
          status: ourStatus,
          order_date: xpo.DateString?.substring(0, 10) || null,
          expected_date: xpo.DeliveryDateString?.substring(0, 10) || null,
          subtotal: xpo.SubTotal || 0,
          tax: xpo.TotalTax || 0,
          total: xpo.Total || 0,
          currency: xpo.CurrencyCode || 'ZAR',
          payment_status: 'unpaid',
          xero_po_id: xpo.PurchaseOrderID,
          source: 'xero',
        });
        posCreated++;
        const xLines = xpo.LineItems || [];
        if (xLines.length > 0) {
          const batch = xLines.map(xl => ({
            purchase_order_id: newPO.id,
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
          for (let i = 0; i < batch.length; i += 25) {
            await base44.asServiceRole.entities.PurchaseOrderLine.bulkCreate(batch.slice(i, i + 25));
          }
          linesCreated += batch.length;
        }
      }
    }

    // 7. Fetch Xero Bills (Accounts Payable invoices) — paginated
    let billPage = 1;
    let allBills = [];
    const billWhere = encodeURIComponent(`Type=="ACCPAY"&&Date>=DateTime(${sinceDate.replace(/-/g, ',')})`);
    while (true) {
      const billData = await xeroGet(
        `https://api.xero.com/api.xro/2.0/Invoices?where=${billWhere}&page=${billPage}&order=DateString%20DESC`,
        accessToken, tenantId
      );
      const bills = billData.Invoices || [];
      allBills = allBills.concat(bills);
      if (bills.length < 100) break;
      billPage++;
    }

    const relevantBills = allBills.filter(b => b.Contact?.ContactID && matchedContactIds.has(b.Contact.ContactID));
    console.log(`Bills: ${allBills.length} total, ${relevantBills.length} matched`);

    let billsCreated = 0;
    let billsUpdated = 0;
    let billLinesCreated = 0;

    // Separate new vs existing bills
    const newBills = [];
    const updateBills = [];
    for (const bill of relevantBills) {
      const supplier = supplierByContactId[bill.Contact.ContactID];
      if (!supplier) continue;
      const existing = existingByXeroId[bill.InvoiceID];
      if (existing) {
        updateBills.push({ bill, existing, supplier });
      } else {
        newBills.push({ bill, supplier });
      }
    }

    // Batch-update existing bills
    for (const { bill, existing } of updateBills) {
      const ourStatus = mapXeroBillStatus(bill);
      const payStatus = mapBillPaymentStatus(bill);
      const updates = {};
      if (existing.status !== ourStatus) updates.status = ourStatus;
      if (existing.payment_status !== payStatus) updates.payment_status = payStatus;
      if (existing.subtotal !== (bill.SubTotal || 0)) updates.subtotal = bill.SubTotal || 0;
      if (existing.tax !== (bill.TotalTax || 0)) updates.tax = bill.TotalTax || 0;
      if (existing.total !== (bill.Total || 0)) updates.total = bill.Total || 0;
      if (bill.InvoiceNumber && existing.supplier_invoice_number !== bill.InvoiceNumber) {
        updates.supplier_invoice_number = bill.InvoiceNumber;
      }
      if (Object.keys(updates).length > 0) {
        await base44.asServiceRole.entities.PurchaseOrder.update(existing.id, updates);
        billsUpdated++;
      }
    }

    // Bulk-create new bills (batches of 25) then fetch line items individually
    for (let i = 0; i < newBills.length; i += 25) {
      const chunk = newBills.slice(i, i + 25);
      const poRecords = chunk.map(({ bill, supplier }) => ({
        po_number: bill.InvoiceNumber || `XBILL-${bill.InvoiceID.substring(0, 8)}`,
        supplier_id: supplier.id,
        supplier_name: supplier.name,
        status: mapXeroBillStatus(bill),
        order_date: bill.DateString?.substring(0, 10) || null,
        expected_date: bill.DueDateString?.substring(0, 10) || null,
        subtotal: bill.SubTotal || 0,
        tax: bill.TotalTax || 0,
        total: bill.Total || 0,
        currency: bill.CurrencyCode || 'ZAR',
        payment_status: mapBillPaymentStatus(bill),
        supplier_invoice_number: bill.InvoiceNumber || '',
        xero_po_id: bill.InvoiceID,
        source: 'xero',
        notes: bill.Reference || '',
      }));
      const created = await base44.asServiceRole.entities.PurchaseOrder.bulkCreate(poRecords);
      billsCreated += created.length;

      for (const newPO of created) {
        existingByXeroId[newPO.xero_po_id] = newPO;
      }

      // Fetch line items for each new bill (individual endpoint includes LineItems)
      for (const newPO of created) {
        try {
          const invRes = await xeroGet(
            `https://api.xero.com/api.xro/2.0/Invoices/${newPO.xero_po_id}`,
            accessToken, tenantId
          );
          const inv = invRes.Invoices?.[0];
          if (inv?.LineItems?.length > 0) {
            const lineRecords = inv.LineItems.map(xl => ({
              purchase_order_id: newPO.id,
              product_id: 'unmatched',
              product_name: xl.Description || xl.ItemCode || 'Unknown',
              product_sku: xl.ItemCode || '',
              ordered_qty: xl.Quantity ?? 1,
              received_qty: 0,
              unit_cost: xl.UnitAmount || 0,
              uom: xl.UnitOfMeasure || parseUomFromDescription(xl.Description) || 'pcs',
              line_total: xl.LineAmount || 0,
              tax_rule: xl.TaxType || '',
            }));
            await base44.asServiceRole.entities.PurchaseOrderLine.bulkCreate(lineRecords);
            billLinesCreated += lineRecords.length;
          }
        } catch (e) {
          console.warn(`Failed to fetch lines for ${newPO.po_number}: ${e.message}`);
        }
      }
    }

    return Response.json({
      success: true,
      summary: {
        xero_contacts_found: xeroContacts.length,
        suppliers_matched: matchedContacts.length,
        suppliers_updated: suppliersUpdated,
        fuzzy_matches: fuzzyMatches,
        unmatched_xero_contacts: unmatchedXero.slice(0, 30),
        since_date: sinceDate,
        purchase_orders: { total: allXeroPOs.length, relevant: relevantPOs.length, created: posCreated, updated: posUpdated },
        bills: { total: allBills.length, relevant: relevantBills.length, created: billsCreated, updated: billsUpdated },
        lines_created: linesCreated + billLinesCreated,
      },
    });
  } catch (error) {
    console.error('syncXeroPurchaseOrders error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});