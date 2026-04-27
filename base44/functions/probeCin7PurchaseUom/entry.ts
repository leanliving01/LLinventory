import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * Probe: Inspect exactly what Cin7 returns for a product, focusing on
 * purchase UoM, supplier info, and additional attributes.
 * This is a diagnostic tool to understand the data structure.
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
      throw new Error(`Cin7 API ${res.status}: ${text.slice(0, 300)}`);
    }
    return res.json();
  }
  throw new Error('Cin7 rate limit exceeded');
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

    // Fetch a few raw material products from Cin7 with full detail
    // The /Product endpoint with ID returns full detail including suppliers
    const skusToCheck = body.skus || ['CHB01', 'BFM01', 'RCB01', 'OLV01', 'GLC01'];

    // First get product list to find their Cin7 IDs
    const results = [];

    for (const sku of skusToCheck) {
      const searchData = await cin7Fetch(
        `/Product?SKU=${encodeURIComponent(sku)}&IncludeSuppliers=true&IncludeAttachments=false`,
        accountId, appKey
      );
      await delay(1200);

      const products = searchData.Products || [];
      if (products.length === 0) {
        results.push({ sku, found: false });
        continue;
      }

      const p = products[0];

      // Extract all fields that might contain purchase UoM info
      results.push({
        sku: p.SKU,
        name: p.Name,
        found: true,
        // Standard fields
        UOM: p.UOM,
        Category: p.Category,
        // Supplier info (this is where purchase UoM often lives)
        Suppliers: (p.Suppliers || []).map(s => ({
          SupplierName: s.SupplierName || s.ContactName,
          SupplierSKU: s.SupplierProductCode || s.SKU,
          UnitOfMeasure: s.UnitOfMeasure,
          PackSize: s.PackSize,
          Cost: s.Cost,
          MinQty: s.MinOrderQuantity || s.MinQty,
          // Dump all supplier fields to see what's available
          _allFields: s,
        })),
        // Additional attributes
        AdditionalAttributes: p.AdditionalAttributes || p.AttributeSet || p.Attributes,
        // Weight fields
        Weight: p.Weight,
        WeightUnits: p.WeightUnits,
        // Purchase-related
        DefaultPurchasePrice: p.DefaultPurchasePrice,
        PurchaseAccount: p.PurchaseAccount,
        PurchaseTaxRule: p.PurchaseTaxRule,
        // Any other fields with "UOM" or "Unit" in the name
        _topLevelKeys: Object.keys(p),
      });
    }

    return Response.json({
      products_checked: results.length,
      results,
    });
  } catch (error) {
    console.error('probeCin7PurchaseUom error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});