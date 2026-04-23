import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

async function withRetry(fn, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try { return await fn(); } catch (err) {
      if ((err.status === 429 || err.message?.includes('429')) && i < retries - 1) {
        await delay((i + 1) * 3000);
      } else { throw err; }
    }
  }
}

function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') { inQuotes = !inQuotes; continue; }
    if (ch === ',' && !inQuotes) { result.push(current.trim()); current = ''; continue; }
    current += ch;
  }
  result.push(current.trim());
  return result;
}

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me();
  if (!user || user.role !== 'admin') {
    return Response.json({ error: 'Admin access required' }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const fileUrl = body.file_url;
  if (!fileUrl) {
    return Response.json({ error: 'Provide file_url of the CSV' }, { status: 400 });
  }

  // Fetch and parse CSV directly
  const csvResponse = await fetch(fileUrl);
  const csvText = await csvResponse.text();
  const lines = csvText.split('\n').filter(l => l.trim());

  // Parse header
  const header = parseCSVLine(lines[0]);
  const skuIdx = header.indexOf('SKU');
  const supplierIdx = header.indexOf('Supplier');
  const supplierSkuIdx = header.indexOf('SupplierSKU');

  if (skuIdx === -1 || supplierIdx === -1) {
    return Response.json({ error: 'CSV missing SKU or Supplier columns' }, { status: 400 });
  }

  // Parse data rows
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = parseCSVLine(lines[i]);
    if (cols.length < Math.max(skuIdx, supplierIdx) + 1) continue;
    rows.push({
      sku: cols[skuIdx] || '',
      supplier: cols[supplierIdx] || '',
      supplierSku: supplierSkuIdx >= 0 ? (cols[supplierSkuIdx] || '') : '',
    });
  }
  console.log(`Parsed ${rows.length} rows from CSV`);

  // Load products and suppliers
  const [products, suppliers] = await Promise.all([
    withRetry(() => base44.asServiceRole.entities.Product.filter({})),
    withRetry(() => base44.asServiceRole.entities.Supplier.filter({})),
  ]);

  const productBySku = {};
  products.forEach(p => { productBySku[p.sku] = p; });
  // BeeandBea-2 → MWL1 anomaly
  if (productBySku['MWL1'] && !productBySku['BeeandBea-2']) {
    productBySku['BeeandBea-2'] = productBySku['MWL1'];
  }

  const supplierByName = {};
  suppliers.forEach(s => { supplierByName[s.name.toLowerCase().trim()] = s; });

  const warnings = [];
  let linked = 0, suppliersCreated = 0;
  const processed = new Set();

  for (const row of rows) {
    const sku = row.sku.trim();
    const supplierName = row.supplier.trim();
    const supplierSku = row.supplierSku.trim();
    if (!sku || !supplierName) continue;

    // Use first supplier per SKU only
    if (processed.has(sku)) {
      warnings.push(`${sku}: extra supplier "${supplierName}" skipped (using first)`);
      continue;
    }
    processed.add(sku);

    const product = productBySku[sku];
    if (!product) {
      warnings.push(`${sku}: product not found`);
      continue;
    }

    let supplier = supplierByName[supplierName.toLowerCase().trim()];
    if (!supplier) {
      console.log(`Creating supplier: ${supplierName}`);
      supplier = await withRetry(() => base44.asServiceRole.entities.Supplier.create({
        name: supplierName, status: 'active',
      }));
      supplierByName[supplierName.toLowerCase().trim()] = supplier;
      suppliersCreated++;
      await delay(300);
    }

    const updateData = { supplier_id: supplier.id };
    if (supplierSku) updateData.supplier_sku = supplierSku;

    await withRetry(() => base44.asServiceRole.entities.Product.update(product.id, updateData));
    linked++;
    if (linked % 20 === 0) await delay(500);
  }

  return Response.json({
    success: true,
    csv_rows: rows.length,
    products_linked: linked,
    suppliers_created: suppliersCreated,
    warnings_count: warnings.length,
    warnings: warnings.slice(0, 50),
  });
});