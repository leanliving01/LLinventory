import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const CIN7_BASE = 'https://inventory.dearsystems.com/ExternalApi/v2';

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

// Retry wrapper for Base44 entity calls (handles 429 rate limits)
async function base44Call(fn, maxRetries = 5) {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const is429 = err?.message?.includes('429') || err?.message?.includes('Rate limit');
      if (is429 && attempt < maxRetries - 1) {
        const wait = Math.min(2000 * Math.pow(2, attempt), 30000);
        console.log(`Base44 rate limited, retry ${attempt + 1}/${maxRetries} in ${wait}ms`);
        await delay(wait);
        continue;
      }
      throw err;
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
      console.log(`Rate limited on ${path}, waiting ${(attempt + 1) * 2}s...`);
      await delay((attempt + 1) * 2000);
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
  const action = body.action || 'preview';

  // ─── Load all products for matching ───
  const products = await base44.asServiceRole.entities.Product.filter({});
  const productByCin7Id = {};
  const productBySku = {};
  products.forEach(p => {
    if (p.cin7_id) productByCin7Id[p.cin7_id] = p;
    productBySku[p.sku] = p;
  });
  console.log(`Loaded ${products.length} products for matching`);

  // ─── Load existing BOMs for idempotent upsert ───
  const existingBoms = await base44.asServiceRole.entities.Bom.filter({});
  const existingBomByCin7Id = {};
  existingBoms.forEach(b => { if (b.cin7_id) existingBomByCin7Id[b.cin7_id] = b; });

  // ─── Helper: scan Cin7 for assembly product list ───
  async function getAssemblyProducts() {
    const result = [];
    let page = 1;
    let hasMore = true;
    while (hasMore) {
      const data = await cin7Fetch(`/Product?Page=${page}&Limit=250`, accountId, appKey);
      const list = data.Products || [];
      if (list.length === 0) break;
      for (const p of list) {
        if (p.BillOfMaterial && p.BOMType === 'Assembly') {
          result.push({ cin7Id: p.ID, sku: p.SKU, name: p.Name });
        }
      }
      if (list.length < 250) hasMore = false;
      else { page++; await delay(1100); }
    }
    return result;
  }

  // ─── Helper: get production product list from our DB ───
  function getProductionProducts() {
    return products
      .filter(p => p.cin7_id && (p.type === 'finished_meal' || p.type === 'wip_bulk' || p.type === 'solo_serve'))
      .map(p => ({ cin7Id: p.cin7_id, sku: p.sku, name: p.name }));
  }

  // ─── PREVIEW ───
  if (action === 'preview') {
    const assembly = await getAssemblyProducts();

    const productionCandidates = products.filter(p =>
      p.cin7_id && (p.type === 'finished_meal' || p.type === 'wip_bulk' || p.type === 'solo_serve')
    );
    let productionWithBom = 0;
    const productionSamples = [];
    for (const p of productionCandidates.slice(0, 5)) {
      try {
        const bom = await cin7Fetch(`/production/productionbom?ProductID=${p.cin7_id}`, accountId, appKey);
        if ((bom.ProductionBoms || []).length > 0) {
          productionWithBom++;
          const ops = bom.ProductionBoms[0].Operations || [];
          const totalComponents = ops.reduce((s, o) => s + (o.Components || []).length, 0);
          productionSamples.push({ sku: p.sku, name: p.name, type: p.type, operations: ops.length, components: totalComponents });
        }
      } catch (_) { /* skip */ }
      await delay(1100);
    }

    return Response.json({
      success: true,
      assembly_boms: assembly.length,
      assembly_samples: assembly.slice(0, 5),
      production_candidates: productionCandidates.length,
      production_sampled: Math.min(5, productionCandidates.length),
      production_with_bom: productionWithBom,
      production_samples: productionSamples,
    });
  }

  // ─── IMPORT (batched) ───
  // Supports: action='import' (both), 'import_assembly', 'import_production'
  // Optional: body.offset (default 0), body.batch_size (default 30)
  if (action === 'import' || action === 'import_assembly' || action === 'import_production') {
    const doAssembly = action === 'import' || action === 'import_assembly';
    const doProduction = action === 'import' || action === 'import_production';
    const batchOffset = body.offset || 0;
    const batchSize = body.batch_size || 30;

    const log = await base44Call(() => base44.asServiceRole.entities.ImportLog.create({
      import_type: 'boms',
      status: 'running',
      started_at: new Date().toISOString(),
    }));

    const warnings = [];
    const errors = [];
    let bomsCreated = 0, bomsUpdated = 0, componentsCreated = 0, opsCreated = 0;

    // Build combined list
    const assemblyList = doAssembly ? await getAssemblyProducts() : [];
    const productionList = doProduction ? getProductionProducts() : [];

    const allItems = [
      ...assemblyList.map(p => ({ ...p, _kind: 'assembly' })),
      ...productionList.map(p => ({ ...p, _kind: 'production' })),
    ];

    const batch = allItems.slice(batchOffset, batchOffset + batchSize);
    const hasMore = batchOffset + batchSize < allItems.length;
    console.log(`Batch: offset=${batchOffset}, size=${batch.length}, total=${allItems.length}, hasMore=${hasMore}`);

    for (const item of batch) {
      const ourProduct = productByCin7Id[item.cin7Id] || productBySku[item.sku];
      if (!ourProduct) {
        warnings.push(`${item._kind} ${item.sku}: product not found in DB`);
        continue;
      }

      // ── ASSEMBLY (Pack layer) ──
      if (item._kind === 'assembly') {
        let cin7Product;
        try {
          const data = await cin7Fetch(`/Product?ID=${item.cin7Id}&IncludeBOM=true`, accountId, appKey);
          cin7Product = (data.Products || [])[0];
        } catch (err) { errors.push(`Assembly ${item.sku}: ${err.message}`); await delay(1100); continue; }

        if (!cin7Product) { warnings.push(`Assembly ${item.sku}: no data`); await delay(1100); continue; }
        const components = cin7Product.BillOfMaterialsProducts || [];
        if (components.length === 0) { warnings.push(`Assembly ${item.sku}: 0 components`); await delay(1100); continue; }

        const cin7BomId = `assembly_${item.cin7Id}`;
        const existing = existingBomByCin7Id[cin7BomId];
        let bomRecord;
        const bomData = {
          product_id: ourProduct.id, product_name: ourProduct.name, product_sku: ourProduct.sku,
          bom_type: 'pack', yield_qty: 1, yield_uom: ourProduct.stock_uom,
          version: 1, is_active: true, cin7_id: cin7BomId,
        };

        try {
          if (existing) {
            await base44Call(() => base44.asServiceRole.entities.Bom.update(existing.id, bomData));
            bomRecord = { ...existing, ...bomData };
            bomsUpdated++;
          } else {
            bomRecord = await base44Call(() => base44.asServiceRole.entities.Bom.create(bomData));
            existingBomByCin7Id[cin7BomId] = bomRecord;
            bomsCreated++;
          }
        } catch (err) { errors.push(`BOM ${item.sku}: ${err.message}`); await delay(1100); continue; }

        // Clean replace components
        const oldComps = await base44Call(() => base44.asServiceRole.entities.BomComponent.filter({ bom_id: bomRecord.id }));
        for (const oc of oldComps) {
          await base44Call(() => base44.asServiceRole.entities.BomComponent.delete(oc.id));
          await delay(200);
        }

        for (const c of components) {
          const inp = productByCin7Id[c.ComponentProductID] || productBySku[c.ProductCode];
          if (!inp) { warnings.push(`Pack ${item.sku}: component ${c.ProductCode} not found`); continue; }
          try {
            await base44Call(() => base44.asServiceRole.entities.BomComponent.create({
              bom_id: bomRecord.id, input_product_id: inp.id,
              input_product_name: inp.name, input_product_sku: inp.sku,
              qty: c.Quantity || 1, uom: inp.stock_uom, is_consumable: false,
            }));
            componentsCreated++;
            await delay(200);
          } catch (err) { errors.push(`Comp ${c.ProductCode} for ${item.sku}: ${err.message}`); }
        }

      // ── PRODUCTION (Cook or Portion layer) ──
      } else {
        const bomType = ourProduct.type === 'wip_bulk' ? 'cook' : 'portion';

        let cin7Bom;
        try {
          cin7Bom = await cin7Fetch(`/production/productionbom?ProductID=${item.cin7Id}`, accountId, appKey);
        } catch (_) { await delay(1100); continue; }

        const prodBoms = cin7Bom.ProductionBoms || [];
        if (prodBoms.length === 0) { await delay(1100); continue; }

        const defaultBom = prodBoms.find(b => b.IsDefault) || prodBoms[0];
        const cin7BomId = defaultBom.BomID;
        const existing = existingBomByCin7Id[cin7BomId];
        let bomRecord;
        const bomData = {
          product_id: ourProduct.id, product_name: ourProduct.name, product_sku: ourProduct.sku,
          bom_type: bomType, yield_qty: defaultBom.OutputQuantity || 1,
          yield_uom: ourProduct.stock_uom, version: defaultBom.Version || 1,
          is_active: true, cin7_id: cin7BomId,
        };

        try {
          if (existing) {
            await base44Call(() => base44.asServiceRole.entities.Bom.update(existing.id, bomData));
            bomRecord = { ...existing, ...bomData };
            bomsUpdated++;
          } else {
            bomRecord = await base44Call(() => base44.asServiceRole.entities.Bom.create(bomData));
            existingBomByCin7Id[cin7BomId] = bomRecord;
            bomsCreated++;
          }
        } catch (err) { errors.push(`BOM ${item.sku}: ${err.message}`); await delay(1100); continue; }

        // Clean replace
        const oldComps2 = await base44Call(() => base44.asServiceRole.entities.BomComponent.filter({ bom_id: bomRecord.id }));
        const oldOps = await base44Call(() => base44.asServiceRole.entities.BomOperation.filter({ bom_id: bomRecord.id }));
        for (const oc of oldComps2) {
          await base44Call(() => base44.asServiceRole.entities.BomComponent.delete(oc.id));
          await delay(200);
        }
        for (const oo of oldOps) {
          await base44Call(() => base44.asServiceRole.entities.BomOperation.delete(oo.id));
          await delay(200);
        }

        for (const op of (defaultBom.Operations || [])) {
          let station = 'cook';
          const wc = (op.WorkCenterName || op.Name || '').toLowerCase();
          if (wc.includes('prep')) station = 'prep';
          else if (wc.includes('portion')) station = 'portion';
          else if (wc.includes('sleeve') || wc.includes('pack')) station = 'portion';

          try {
            await base44Call(() => base44.asServiceRole.entities.BomOperation.create({
              bom_id: bomRecord.id, step_no: op.Order || 1, name: op.Name || 'Step',
              station, cycle_time_min: op.CycleTime ? Math.round(op.CycleTime / 60) : null,
              notes: op.WorkCenterName || '',
            }));
            opsCreated++;
            await delay(200);
          } catch (err) { errors.push(`Op ${op.Name} for ${item.sku}: ${err.message}`); }

          for (const c of (op.Components || [])) {
            const inp = productByCin7Id[c.ProductID] || productBySku[c.ProductSku];
            if (!inp) { warnings.push(`${bomType} ${item.sku}: component ${c.ProductSku} not found`); continue; }
            const isConsumable = inp.type === 'packaging' ||
              (inp.name || '').toLowerCase().includes('sleeve') ||
              (inp.name || '').toLowerCase().includes('plate') ||
              (inp.name || '').toLowerCase().includes('lid');
            try {
              await base44Call(() => base44.asServiceRole.entities.BomComponent.create({
                bom_id: bomRecord.id, input_product_id: inp.id,
                input_product_name: inp.name, input_product_sku: inp.sku,
                qty: c.Quantity || 0, uom: inp.stock_uom, is_consumable: isConsumable,
              }));
              componentsCreated++;
              await delay(200);
            } catch (err) { errors.push(`Comp ${c.ProductSku} for ${item.sku}: ${err.message}`); }
          }
        }
      }

      await delay(1100); // Cin7 rate limit
    }

    // Update log
    const status = errors.length > 0 ? 'completed_with_warnings' : 'completed';
    await base44Call(() => base44.asServiceRole.entities.ImportLog.update(log.id, {
      status,
      total_records: batch.length,
      created_count: bomsCreated,
      updated_count: bomsUpdated,
      error_count: errors.length,
      warnings: warnings.slice(0, 100),
      errors: errors.slice(0, 50),
      details: JSON.stringify({ batch_offset: batchOffset, batch_size: batch.length, total_items: allItems.length, components_created: componentsCreated, operations_created: opsCreated }),
      finished_at: new Date().toISOString(),
    }));

    return Response.json({
      success: true,
      boms_created: bomsCreated,
      boms_updated: bomsUpdated,
      components_created: componentsCreated,
      operations_created: opsCreated,
      warnings: warnings.length,
      errors: errors.length,
      log_id: log.id,
      batch_offset: batchOffset,
      batch_processed: batch.length,
      total_items: allItems.length,
      has_more: hasMore,
      next_offset: batchOffset + batchSize,
    });
  }

  return Response.json({ error: `Unknown action: ${action}` }, { status: 400 });
});