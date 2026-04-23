import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const CIN7_BASE = 'https://inventory.dearsystems.com/ExternalApi/v2';

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

async function cin7Fetch(path, accountId, appKey) {
  const url = `${CIN7_BASE}${path}`;
  const headers = {
    'Content-Type': 'application/json',
    'api-auth-accountid': accountId,
    'api-auth-applicationkey': appKey,
  };
  
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(url, { headers });
    if (res.status === 429) {
      console.log(`Rate limited, waiting ${(attempt + 1) * 2}s...`);
      await delay((attempt + 1) * 2000);
      continue;
    }
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Cin7 API ${res.status}: ${text.slice(0, 500)}`);
    }
    return await res.json();
  }
  throw new Error('Rate limit exceeded after 3 retries');
}

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me();
  if (!user || user.role !== 'admin') {
    return Response.json({ error: 'Admin access required' }, { status: 403 });
  }

  const accountId = Deno.env.get('CIN7_ACCOUNT_ID');
  const appKey = Deno.env.get('CIN7_APPLICATION_KEY');

  const body = await req.json().catch(() => ({}));
  const action = body.action || 'sample';

  try {
  // ─── SAMPLE: Fetch first page of BOMs to see structure ───
  if (action === 'sample') {
    const data = await cin7Fetch('/BillOfMaterials?page=1&limit=5&onlyProductsWithBOM=true', accountId, appKey);
    const products = data.Products || [];
    
    // Log each product's BOM structure
    const samples = products.map(p => ({
      id: p.ID,
      sku: p.SKU,
      name: p.Name,
      status: p.Status,
      hasBOM: p.BillOfMaterials,
      autoAssembly: p.AutoAssembly,
      autoDisassembly: p.AutoDisassembly,
      qtyToProduce: p.QuantityToProduce,
      componentCount: (p.BOMComponents || []).length,
      serviceCount: (p.BOMServices || []).length,
      components: (p.BOMComponents || []).map(c => ({
        sku: c.SKU,
        name: c.Name,
        qty: c.Quantity,
        wastePct: c.WastagePercent,
        wasteQty: c.WastageQuantity,
      })),
      services: (p.BOMServices || []).map(s => ({
        name: s.Name,
        qty: s.Quantity,
      })),
    }));

    return Response.json({ 
      total_products_with_bom: data.Total,
      page: 1,
      samples 
    });
  }

  // ─── COUNT: Find products with BOMs ───
  if (action === 'count') {
    // Scan pages to find products with BOM
    let productsWithBom = [];
    let total = 0;
    
    for (let page = 1; page <= 3; page++) {
      const data = await cin7Fetch(`/Product?Page=${page}&Limit=250`, accountId, appKey);
      const products = data.Products || [];
      total += products.length;
      
      for (const p of products) {
        if (p.BillOfMaterial === true || (p.BillOfMaterialsProducts && p.BillOfMaterialsProducts.length > 0)) {
          productsWithBom.push({
            sku: p.SKU,
            name: p.Name,
            category: p.Category,
            bomType: p.BOMType,
            qtyToProduce: p.QuantityToProduce,
            autoAssembly: p.AutoAssembly,
            componentCount: (p.BillOfMaterialsProducts || []).length,
            serviceCount: (p.BillOfMaterialsServices || []).length,
            firstComponents: (p.BillOfMaterialsProducts || []).slice(0, 3).map(c => ({
              sku: c.ComponentProductSKU || c.SKU || c.ProductSKU,
              name: c.ComponentProductName || c.Name || c.ProductName,
              qty: c.Quantity,
              // show all keys to understand the structure
              allKeys: Object.keys(c),
            })),
          });
        }
      }
      
      if (products.length < 250) break;
      await delay(1100);
    }
    
    return Response.json({
      total_products_scanned: total,
      products_with_bom: productsWithBom.length,
      samples: productsWithBom.slice(0, 10),
    });
  }

  // ─── SEARCH: Find product detail using SKU filter ───
  if (action === 'search') {
    const sku = body.sku;
    if (!sku) return Response.json({ error: 'sku required' }, { status: 400 });
    
    // Use Product endpoint with SKU filter
    const data = await cin7Fetch(`/Product?SKU=${encodeURIComponent(sku)}`, accountId, appKey);
    const products = data.Products || [];
    if (products.length === 0) return Response.json({ error: `No product found for SKU: ${sku}` });
    
    const p = products[0];
    return Response.json({
      sku: p.SKU,
      name: p.Name,
      category: p.Category,
      hasBOM: p.BillOfMaterial,
      bomType: p.BOMType,
      autoAssembly: p.AutoAssembly,
      qtyToProduce: p.QuantityToProduce,
      bomProducts: p.BillOfMaterialsProducts || [],
      bomServices: p.BillOfMaterialsServices || [],
      suppliers: (p.Suppliers || []).map(s => ({ name: s.SupplierName, sku: s.SupplierProductSKU })),
    });
  }

  // ─── DETAIL: Try to get product detail with BOM ───
  if (action === 'detail') {
    const productId = body.product_id;
    if (!productId) return Response.json({ error: 'product_id required' }, { status: 400 });
    
    const results = {};
    // Try different URL patterns for single product
    const paths = [
      `/Product/${productId}`,
      `/Product?ID=${productId}&IncludeBOM=true`,
      `/Product?ID=${productId}&includeDeprecated=false`,
    ];
    
    for (const path of paths) {
      const url = `${CIN7_BASE}${path}`;
      console.log(`Trying: ${url}`);
      const res = await fetch(url, {
        headers: {
          'Content-Type': 'application/json',
          'api-auth-accountid': accountId,
          'api-auth-applicationkey': appKey,
        },
      });
      const text = await res.text();
      const isJson = text.trim().startsWith('{') || text.trim().startsWith('[');
      if (isJson) {
        const data = JSON.parse(text);
        const p = data.Products?.[0] || data;
        const bomProds = p.BillOfMaterialsProducts || p.BOMComponents || [];
        results[path] = {
          status: res.status,
          sku: p.SKU,
          bomCount: bomProds.length,
          bomSample: bomProds.slice(0, 3),
          allKeys: Object.keys(p).filter(k => k.toLowerCase().includes('bom') || k.toLowerCase().includes('bill') || k.toLowerCase().includes('component')),
        };
      } else {
        results[path] = { status: res.status, error: 'not json', preview: text.slice(0, 100) };
      }
      await delay(1100);
    }
    return Response.json(results);
  }

  // ─── ENDPOINTS: Try various BOM-related endpoints ───
  if (action === 'endpoints') {
    const results = {};
    const paths = [
      '/Product?Page=1&Limit=1&IncludeBOM=true',
      '/Product?Page=1&Limit=1&includeBillOfMaterials=true',
      '/product?Page=1&Limit=1&ID=' + (body.product_id || ''),
    ];
    
    for (const path of paths) {
      const url = `${CIN7_BASE}${path}`;
      console.log(`Trying: ${url}`);
      const res = await fetch(url, {
        headers: {
          'Content-Type': 'application/json',
          'api-auth-accountid': accountId,
          'api-auth-applicationkey': appKey,
        },
      });
      const text = await res.text();
      const isJson = text.trim().startsWith('{') || text.trim().startsWith('[');
      if (isJson) {
        const data = JSON.parse(text);
        const p = data.Products?.[0];
        if (p) {
          const bomProds = p.BillOfMaterialsProducts || [];
          results[path] = {
            sku: p.SKU,
            bomProductsCount: bomProds.length,
            bomProducts: bomProds.slice(0, 2),
          };
        } else {
          results[path] = { keys: Object.keys(data).slice(0, 5) };
        }
      } else {
        results[path] = { error: 'not json' };
      }
      await delay(1100);
    }
    return Response.json(results);
  }
  
  // ─── FULL: Get a specific product by ID with full details ───
  if (action === 'full') {
    const productId = body.product_id;
    if (!productId) return Response.json({ error: 'product_id required' }, { status: 400 });
    
    // Try fetching by ID parameter
    const data = await cin7Fetch(`/Product?ID=${encodeURIComponent(productId)}`, accountId, appKey);
    const products = data.Products || [];
    if (products.length === 0) return Response.json({ error: 'Product not found' });
    
    const p = products[0];
    return Response.json({
      sku: p.SKU,
      name: p.Name,
      bomType: p.BOMType,
      hasBOM: p.BillOfMaterial,
      bomProducts: p.BillOfMaterialsProducts || [],
      bomServices: p.BillOfMaterialsServices || [],
    });
  }

  return Response.json({ error: `Unknown action: ${action}` }, { status: 400 });
  } catch (error) {
    console.error('BOM Probe error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});