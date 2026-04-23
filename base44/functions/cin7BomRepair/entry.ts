import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const CIN7_BASE = 'https://inventory.dearsystems.com/ExternalApi/v2';

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

async function withRetry(fn, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try { return await fn(); } catch (err) {
      if ((err.status === 429 || err.message?.includes('429')) && i < retries - 1) {
        console.log(`Base44 rate limit, waiting ${(i + 1) * 3}s...`);
        await delay((i + 1) * 3000);
      } else { throw err; }
    }
  }
}

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
      console.log(`Rate limited on ${path}, waiting ${(attempt + 1) * 3}s...`);
      await delay((attempt + 1) * 3000);
      continue;
    }
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Cin7 API ${res.status}: ${text.slice(0, 200)}`);
    }
    return await res.json();
  }
  throw new Error(`Cin7 rate limit exceeded on ${path}`);
}

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me();
  if (!user || user.role !== 'admin') {
    return Response.json({ error: 'Admin access required' }, { status: 403 });
  }

  const accountId = Deno.env.get('CIN7_ACCOUNT_ID');
  const appKey = Deno.env.get('CIN7_APPLICATION_KEY');
  if (!accountId || !appKey) {
    return Response.json({ error: 'Cin7 credentials not configured' }, { status: 400 });
  }

  const body = await req.json().catch(() => ({}));
  // Accept a list of SKUs to repair
  const skus = body.skus || [];
  if (skus.length === 0) {
    return Response.json({ error: 'Provide "skus" array of product SKUs to repair' }, { status: 400 });
  }

  // Load products with retry
  const products = await withRetry(() => base44.asServiceRole.entities.Product.filter({}));
  const productBySku = {};
  const productByCin7Id = {};
  products.forEach(p => {
    productBySku[p.sku] = p;
    if (p.cin7_id) productByCin7Id[p.cin7_id] = p;
  });

  // Load existing BOMs with retry
  const existingBoms = await withRetry(() => base44.asServiceRole.entities.Bom.filter({}));
  const existingBomByCin7Id = {};
  existingBoms.forEach(b => { if (b.cin7_id) existingBomByCin7Id[b.cin7_id] = b; });

  const results = [];
  const errors = [];

  for (const sku of skus) {
    const product = productBySku[sku];
    if (!product) {
      errors.push(`${sku}: product not found in DB`);
      continue;
    }
    if (!product.cin7_id) {
      errors.push(`${sku}: no cin7_id`);
      continue;
    }

    console.log(`Repairing ${sku} (${product.type})...`);

    // Determine if this is assembly (pack) or production (cook/portion)
    const isPackage = product.type === 'package' || product.type === 'bundle';

    if (isPackage) {
      // Assembly BOM (Pack layer)
      let cin7Product;
      try {
        const data = await cin7Fetch(`/Product?ID=${product.cin7_id}&IncludeBOM=true`, accountId, appKey);
        cin7Product = (data.Products || [])[0];
      } catch (err) {
        errors.push(`${sku}: ${err.message}`);
        await delay(1200);
        continue;
      }

      if (!cin7Product) { errors.push(`${sku}: no data from Cin7`); await delay(1200); continue; }
      const components = cin7Product.BillOfMaterialsProducts || [];
      if (components.length === 0) { errors.push(`${sku}: 0 components in Cin7`); await delay(1200); continue; }

      const cin7BomId = `assembly_${product.cin7_id}`;
      const existing = existingBomByCin7Id[cin7BomId];
      let bomRecord;
      const bomData = {
        product_id: product.id, product_name: product.name, product_sku: product.sku,
        bom_type: 'pack', yield_qty: 1, yield_uom: product.stock_uom,
        version: 1, is_active: true, cin7_id: cin7BomId,
      };

      if (existing) {
        await withRetry(() => base44.asServiceRole.entities.Bom.update(existing.id, bomData));
        bomRecord = { ...existing, ...bomData };
      } else {
        bomRecord = await withRetry(() => base44.asServiceRole.entities.Bom.create(bomData));
      }

      // Clean replace components
      const oldComps = await withRetry(() => base44.asServiceRole.entities.BomComponent.filter({ bom_id: bomRecord.id }));
      for (const oc of oldComps) { await withRetry(() => base44.asServiceRole.entities.BomComponent.delete(oc.id)); await delay(200); }

      let compCount = 0;
      for (const c of components) {
        const inp = productByCin7Id[c.ComponentProductID] || productBySku[c.ProductCode];
        if (!inp) { errors.push(`${sku}: component ${c.ProductCode} not found`); continue; }
        await withRetry(() => base44.asServiceRole.entities.BomComponent.create({
          bom_id: bomRecord.id, input_product_id: inp.id,
          input_product_name: inp.name, input_product_sku: inp.sku,
          qty: c.Quantity || 1, uom: inp.stock_uom, is_consumable: false,
        }));
        compCount++;
        await delay(200);
      }
      results.push({ sku, type: 'pack', components: compCount, status: existing ? 'updated' : 'created' });

    } else {
      // Production BOM (Cook or Portion)
      const bomType = product.type === 'wip_bulk' ? 'cook' : 'portion';

      let cin7Bom;
      try {
        cin7Bom = await cin7Fetch(`/production/productionbom?ProductID=${product.cin7_id}`, accountId, appKey);
      } catch (err) {
        errors.push(`${sku}: ${err.message}`);
        await delay(1200);
        continue;
      }

      const prodBoms = cin7Bom.ProductionBoms || [];
      if (prodBoms.length === 0) { errors.push(`${sku}: no production BOM in Cin7`); await delay(1200); continue; }

      const defaultBom = prodBoms.find(b => b.IsDefault) || prodBoms[0];
      const cin7BomId = defaultBom.BomID;
      const existing = existingBomByCin7Id[cin7BomId];
      let bomRecord;
      const bomData = {
        product_id: product.id, product_name: product.name, product_sku: product.sku,
        bom_type: bomType, yield_qty: defaultBom.OutputQuantity || 1,
        yield_uom: product.stock_uom, version: defaultBom.Version || 1,
        is_active: true, cin7_id: cin7BomId,
      };

      if (existing) {
        await withRetry(() => base44.asServiceRole.entities.Bom.update(existing.id, bomData));
        bomRecord = { ...existing, ...bomData };
      } else {
        bomRecord = await withRetry(() => base44.asServiceRole.entities.Bom.create(bomData));
      }

      // Clean replace components + operations
      const [oldComps, oldOps] = await Promise.all([
        withRetry(() => base44.asServiceRole.entities.BomComponent.filter({ bom_id: bomRecord.id })),
        withRetry(() => base44.asServiceRole.entities.BomOperation.filter({ bom_id: bomRecord.id })),
      ]);
      for (const oc of oldComps) { await withRetry(() => base44.asServiceRole.entities.BomComponent.delete(oc.id)); await delay(200); }
      for (const oo of oldOps) { await withRetry(() => base44.asServiceRole.entities.BomOperation.delete(oo.id)); await delay(200); }

      let compCount = 0, opsCount = 0;
      for (const op of (defaultBom.Operations || [])) {
        let station = 'cook';
        const wc = (op.WorkCenterName || op.Name || '').toLowerCase();
        if (wc.includes('prep')) station = 'prep';
        else if (wc.includes('portion')) station = 'portion';
        else if (wc.includes('sleeve') || wc.includes('pack')) station = 'portion';

        await withRetry(() => base44.asServiceRole.entities.BomOperation.create({
          bom_id: bomRecord.id, step_no: op.Order || 1, name: op.Name || 'Step',
          station, cycle_time_min: op.CycleTime ? Math.round(op.CycleTime / 60) : null,
          notes: op.WorkCenterName || '',
        }));
        opsCount++;
        await delay(200);

        for (const c of (op.Components || [])) {
          const inp = productByCin7Id[c.ProductID] || productBySku[c.ProductSku];
          if (!inp) { errors.push(`${sku}: component ${c.ProductSku} not found`); continue; }
          const isConsumable = inp.type === 'packaging' ||
            (inp.name || '').toLowerCase().includes('sleeve') ||
            (inp.name || '').toLowerCase().includes('plate') ||
            (inp.name || '').toLowerCase().includes('lid');
          await withRetry(() => base44.asServiceRole.entities.BomComponent.create({
            bom_id: bomRecord.id, input_product_id: inp.id,
            input_product_name: inp.name, input_product_sku: inp.sku,
            qty: c.Quantity || 0, uom: inp.stock_uom, is_consumable: isConsumable,
          }));
          compCount++;
          await delay(200);
        }
      }
      results.push({ sku, type: bomType, components: compCount, operations: opsCount, status: existing ? 'updated' : 'created' });
    }

    await delay(1200); // Rate limit between products
  }

  return Response.json({ success: true, repaired: results, errors });
});