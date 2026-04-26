import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * Probe: pull a broader set of PO lines from Cin7 to see the purchase UoM patterns.
 * The SKU on the PO line (e.g. "CON1349-C") tells us what UoM was used for purchase.
 */

const CIN7_BASE = 'https://inventory.dearsystems.com/ExternalApi/v2';

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

async function cin7Fetch(path, accountId, appKey) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(`${CIN7_BASE}${path}`, {
      headers: {
        'Content-Type': 'application/json',
        'api-auth-accountid': accountId,
        'api-auth-applicationkey': appKey,
      },
    });
    if (res.status === 429) {
      await delay((attempt + 1) * 2000);
      continue;
    }
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Cin7 API ${res.status}: ${text.slice(0, 200)}`);
    }
    return res.json();
  }
  throw new Error('Rate limit exceeded');
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Admin access required' }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    const accountId = Deno.env.get('CIN7_ACCOUNT_ID');
    const appKey = Deno.env.get('CIN7_APPLICATION_KEY');

    // Pull all POs and aggregate line-level purchase UoM info per base SKU
    const poLimit = body.po_limit || 20;
    const list = await cin7Fetch(`/purchaselist?Limit=${poLimit}`, accountId, appKey);
    const poList = list.PurchaseList || [];

    const linesByBaseSku = {}; // baseSku → [{ sku, name, qty, price, total, purchaseUom }]

    for (const po of poList) {
      const data = await cin7Fetch(`/Purchase?ID=${po.ID}`, accountId, appKey);
      const invoiceLines = data.Invoice?.Lines || [];
      const orderLines = data.Order?.Lines || [];
      const lines = invoiceLines.length > 0 ? invoiceLines : orderLines;

      for (const l of lines) {
        const sku = l.SKU || '';
        // Extract base SKU (strip -C, -C4, -Kg, -Case of N suffixes)
        const baseSku = sku.replace(/[-](?:C\d*|Kg|KG|kg|L|Case\s+of\s+\d+)$/i, '');
        
        if (!linesByBaseSku[baseSku]) linesByBaseSku[baseSku] = [];
        linesByBaseSku[baseSku].push({
          po: data.OrderNumber,
          ordered_sku: sku,
          name: l.Name,
          qty: l.Quantity,
          price: l.Price,
          total: l.Total,
          is_alt_uom: sku !== baseSku,
        });
      }
      await delay(500);
    }

    // Find products that use alt UoM SKUs on POs
    const altUomUsage = {};
    for (const [baseSku, lines] of Object.entries(linesByBaseSku)) {
      const altLines = lines.filter(l => l.is_alt_uom);
      if (altLines.length > 0) {
        altUomUsage[baseSku] = altLines.slice(0, 3);
      }
    }

    // Also find products with purchase info in their names
    const namePatterns = {};
    for (const [baseSku, lines] of Object.entries(linesByBaseSku)) {
      for (const l of lines) {
        const name = (l.name || '').toUpperCase();
        // Check for weight/pack patterns
        const nxmkg = name.match(/(\d+)\s*[xX]\s*(\d+(?:\.\d+)?)\s*KG/);
        const caseOf = name.match(/CASE\s+(?:of\s+)?(\d+)/i);
        const kgPack = name.match(/[-\s](\d+(?:\.\d+)?)\s*KG\b/);
        
        if (nxmkg || caseOf || kgPack) {
          if (!namePatterns[baseSku]) namePatterns[baseSku] = [];
          namePatterns[baseSku].push({
            name: l.name,
            pattern: nxmkg ? `${nxmkg[1]}x${nxmkg[2]}kg` : caseOf ? `case of ${caseOf[1]}` : `${kgPack[1]}kg`,
          });
        }
      }
    }

    return Response.json({
      pos_checked: poList.length,
      unique_base_skus: Object.keys(linesByBaseSku).length,
      alt_uom_usage: altUomUsage,
      name_patterns: namePatterns,
      // Show all unique SKU → name mappings for manual review
      all_lines_summary: Object.entries(linesByBaseSku).map(([baseSku, lines]) => ({
        base_sku: baseSku,
        ordered_skus: [...new Set(lines.map(l => l.ordered_sku))],
        names: [...new Set(lines.map(l => l.name))],
        sample: lines[0],
      })).slice(0, 50),
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});