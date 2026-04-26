import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const CIN7_BASE = 'https://inventory.dearsystems.com/ExternalApi/v2';

async function cin7Get(endpoint) {
  const accountId = Deno.env.get('CIN7_ACCOUNT_ID');
  const appKey = Deno.env.get('CIN7_APPLICATION_KEY');
  
  const resp = await fetch(`${CIN7_BASE}/${endpoint}`, {
    headers: {
      'api-auth-accountid': accountId,
      'api-auth-applicationkey': appKey,
      'Content-Type': 'application/json',
    },
  });
  
  const text = await resp.text();
  if (!resp.ok) {
    return { error: `${resp.status}: ${text.substring(0, 300)}` };
  }
  try {
    return JSON.parse(text);
  } catch {
    return { error: `Non-JSON response: ${text.substring(0, 300)}` };
  }
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { section } = await req.json();

    if (section === 'accounts') {
      return Response.json(await cin7Get('ref/account'));
    }
    if (section === 'tax') {
      return Response.json(await cin7Get('ref/taxrule'));
    }
    if (section === 'categories') {
      return Response.json(await cin7Get('ref/category'));
    }
    if (section === 'uom') {
      return Response.json(await cin7Get('ref/unitofmeasure'));
    }
    if (section === 'brands') {
      return Response.json(await cin7Get('ref/brand'));
    }
    if (section === 'paymentterms') {
      return Response.json(await cin7Get('ref/paymentterm'));
    }
    if (section === 'locations') {
      return Response.json(await cin7Get('ref/location'));
    }
    if (section === 'product_sample') {
      return Response.json(await cin7Get('product?Page=1&Limit=2'));
    }

    // Default: summary of all
    const [locations, categories, tax, accounts, uom, brands] = await Promise.all([
      cin7Get('ref/location'),
      cin7Get('ref/category'),
      cin7Get('ref/taxrule'),
      cin7Get('ref/account'),
      cin7Get('ref/unitofmeasure'),
      cin7Get('ref/brand'),
    ]);

    return Response.json({
      locations_count: locations.Total || locations.LocationList?.length,
      categories_count: categories.Total || categories.CategoryList?.length,
      tax_rules_count: tax.Total || tax.TaxRuleList?.length,
      accounts_count: accounts.Total || accounts.AccountList?.length,
      uom_count: uom.Total || uom.UnitOfMeasureList?.length,
      brands_count: brands.Total || brands.BrandList?.length,
      location_names: (locations.LocationList || []).map(l => l.Name),
      category_names: (categories.CategoryList || []).map(c => c.Name),
      tax_rule_names: (tax.TaxRuleList || []).map(t => t.Name),
      uom_names: (uom.UnitOfMeasureList || []).map(u => u.Name),
    });
  } catch (error) {
    console.error('cin7SettingsAudit error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});