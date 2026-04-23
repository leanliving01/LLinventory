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

  // ─── PREVIEW: Scan for BOMs ───
  if (action === 'preview') {
    // Assembly BOMs come from the Product list (BillOfMaterial=true)
    const assembly = [];
    let page = 1;
    let hasMore = true;
    while (hasMore) {
      const data = await cin7Fetch(`/Product?Page=${page}&Limit=250`, accountId, appKey);
      const productList = data.Products || [];
      if (productList.length === 0) { hasMore = false; break; }
      for (const p of productList) {
        if (p.BillOfMaterial) assembly.push({ sku: p.SKU, name: p.Name, cin7Id: p.ID, bomType: p.BOMType });
      }
      if (productList.length < 250) hasMore = false;
      else { page++; await delay(1100); }
    }

    // Production BOMs: probe finished_meal and wip_bulk products via Production BOM endpoint
    // (Cin7 doesn't flag these in the Product list)
    const productionCandidates = products.filter(p => 
      p.cin7_id && (p.type === 'finished_meal' || p.type === 'wip_bulk' || p.type === 'solo_serve')
    );
    
    let productionWithBom = 0;
    let productionSamples = [];
    // Sample first 5 to confirm
    for (const p of productionCandidates.slice(0, 5)) {
      try {
        const bom = await cin7Fetch(`/production/productionbom?ProductID=${p.cin7_id}`, accountId, appKey);
        const hasBom = (bom.ProductionBoms || []).length > 0;
        if (hasBom) {
          productionWithBom++;
          const ops = bom.ProductionBoms[0].Operations || [];
          const totalComponents = ops.reduce((sum, op) => sum + (op.Components || []).length, 0);
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

  // ─── IMPORT: Batched BOM import ───
  // batch: 'assembly' (pack BOMs), 'production' (cook+portion BOMs), or 'all' (both in sequence)
  if (action === 'import' || action === 'import_assembly' || action === 'import_production') {
    const importAssembly = action === 'import' || action === 'import_assembly';
    const importProduction = action === 'import' || action === 'import_production';
    const batchOffset = body.offset || 0;
    const batchSize = body.batch_size || 40; // Process 40 at a time to stay under timeout

    const log = await base44.asServiceRole.entities.ImportLog.create({
      import_type: 'boms',
      status: 'running',
      started_at: new Date().toISOString(),
    });

    const warnings = [];
    const errors = [];
    let bomsCreated = 0, bomsUpdated = 0, componentsCreated = 0, opsCreated = 0;

    // ────────────────────────────────────────────────
    // STEP 1: Build product lists
    // ────────────────────────────────────────────────
    const assemblyProducts = [];
    if (importAssembly) {
      let page = 1;
      let hasMore = true;
      while (hasMore) {
        const data = await cin7Fetch(`/Product?Page=${page}&Limit=250`, accountId, appKey);
        const productList = data.Products || [];
        if (productList.length === 0) { hasMore = false; break; }
        for (const p of productList) {
          if (p.BillOfMaterial && p.BOMType === 'Assembly') {
            assemblyProducts.push({ cin7Id: p.ID, sku: p.SKU, name: p.Name });
          }
        }
        if (productList.length < 250) hasMore = false;
        else { page++; await delay(1100); }
      }
    }

    const productionProducts = importProduction
      ? products
          .filter(p => p.cin7_id && (p.type === 'finished_meal' || p.type === 'wip_bulk' || p.type === 'solo_serve'))
          .map(p => ({ cin7Id: p.cin7_id, sku: p.sku, name: p.name }))
      : [];

    // Combine into single list with type tag
    const allItems = [
      ...assemblyProducts.map(p => ({ ...p, _type: 'assembly' })),
      ...productionProducts.map(p => ({ ...p, _type: 'production' })),
    ];
    
    // Apply batch window
    const batch = allItems.slice(batchOffset, batchOffset + batchSize);
    const hasMore2 = batchOffset + batchSize < allItems.length;
    console.log(`Processing batch: offset=${batchOffset}, size=${batch.length}, total=${allItems.length}, hasMore=${hasMore2}`);

    console.log(`Found ${assemblyProducts.length} assembly BOMs, ${productionProducts.length} production BOMs`);

    // ────────────────────────────────────────────────
    // STEP 2: Import Assembly BOMs (Pack layer)
    // ────────────────────────────────────────────────
    for (const ap of assemblyProducts) {
      const ourProduct = productByCin7Id[ap.cin7Id] || productBySku[ap.sku];
      if (!ourProduct) {
        warnings.push(`Assembly BOM: product ${ap.sku} not found in our DB`);
        continue;
      }

      // Fetch full product with BOM components
      let cin7Product;
      try {
        const data = await cin7Fetch(`/Product?ID=${ap.cin7Id}&IncludeBOM=true`, accountId, appKey);
        cin7Product = (data.Products || [])[0];
      } catch (err) {
        errors.push(`Assembly ${ap.sku}: ${err.message}`);
        continue;
      }

      if (!cin7Product) { warnings.push(`Assembly ${ap.sku}: no data returned`); continue; }

      const components = cin7Product.BillOfMaterialsProducts || [];
      if (components.length === 0) { warnings.push(`Assembly ${ap.sku}: 0 components`); continue; }

      // Determine BOM type from product type
      const bomType = 'pack';
      const cin7BomId = `assembly_${ap.cin7Id}`;

      // Create or update the BOM
      const existing = existingBomByCin7Id[cin7BomId];
      let bomRecord;
      const bomData = {
        product_id: ourProduct.id,
        product_name: ourProduct.name,
        product_sku: ourProduct.sku,
        bom_type: bomType,
        yield_qty: 1,
        yield_uom: ourProduct.stock_uom,
        version: 1,
        is_active: true,
        cin7_id: cin7BomId,
      };

      try {
        if (existing) {
          await base44.asServiceRole.entities.Bom.update(existing.id, bomData);
          bomRecord = { ...existing, ...bomData };
          bomsUpdated++;
        } else {
          bomRecord = await base44.asServiceRole.entities.Bom.create(bomData);
          existingBomByCin7Id[cin7BomId] = bomRecord;
          bomsCreated++;
        }
      } catch (err) {
        errors.push(`BOM create ${ap.sku}: ${err.message}`);
        continue;
      }

      // Delete old components for this BOM (clean replace)
      const oldComponents = await base44.asServiceRole.entities.BomComponent.filter({ bom_id: bomRecord.id });
      for (const oc of oldComponents) {
        await base44.asServiceRole.entities.BomComponent.delete(oc.id);
      }

      // Create components
      for (const c of components) {
        const inputProduct = productByCin7Id[c.ComponentProductID] || productBySku[c.ProductCode];
        if (!inputProduct) {
          warnings.push(`Pack ${ap.sku}: component ${c.ProductCode} not found`);
          continue;
        }

        try {
          await base44.asServiceRole.entities.BomComponent.create({
            bom_id: bomRecord.id,
            input_product_id: inputProduct.id,
            input_product_name: inputProduct.name,
            input_product_sku: inputProduct.sku,
            qty: c.Quantity || 1,
            uom: inputProduct.stock_uom,
            is_consumable: false,
          });
          componentsCreated++;
        } catch (err) {
          errors.push(`Component ${c.ProductCode} for ${ap.sku}: ${err.message}`);
        }
      }

      await delay(500); // Throttle
    }

    // ────────────────────────────────────────────────
    // STEP 3: Import Production BOMs (Cook + Portion layers)
    // ────────────────────────────────────────────────
    for (const pp of productionProducts) {
      const ourProduct = productByCin7Id[pp.cin7Id] || productBySku[pp.sku];
      if (!ourProduct) {
        warnings.push(`Production BOM: product ${pp.sku} not found in our DB`);
        continue;
      }

      // Determine BOM layer from product type
      let bomType;
      if (ourProduct.type === 'wip_bulk') {
        bomType = 'cook';
      } else if (ourProduct.type === 'finished_meal' || ourProduct.type === 'solo_serve') {
        bomType = 'portion';
      } else {
        bomType = 'portion'; // default for production BOMs
        warnings.push(`Production BOM ${pp.sku}: product type '${ourProduct.type}' defaulting to portion`);
      }

      // Fetch production BOM
      let cin7Bom;
      try {
        cin7Bom = await cin7Fetch(`/production/productionbom?ProductID=${pp.cin7Id}`, accountId, appKey);
      } catch (err) {
        // 404 or similar means no production BOM — just skip silently
        await delay(1100);
        continue;
      }

      const productionBoms = cin7Bom.ProductionBoms || [];
      if (productionBoms.length === 0) {
        // No production BOM for this product — normal, skip silently
        await delay(1100);
        continue;
      }

      // Use the default BOM (or first)
      const defaultBom = productionBoms.find(b => b.IsDefault) || productionBoms[0];
      const cin7BomId = defaultBom.BomID;

      // Create or update the BOM
      const existing = existingBomByCin7Id[cin7BomId];
      let bomRecord;
      const bomData = {
        product_id: ourProduct.id,
        product_name: ourProduct.name,
        product_sku: ourProduct.sku,
        bom_type: bomType,
        yield_qty: defaultBom.OutputQuantity || 1,
        yield_uom: ourProduct.stock_uom,
        version: defaultBom.Version || 1,
        is_active: true,
        cin7_id: cin7BomId,
      };

      try {
        if (existing) {
          await base44.asServiceRole.entities.Bom.update(existing.id, bomData);
          bomRecord = { ...existing, ...bomData };
          bomsUpdated++;
        } else {
          bomRecord = await base44.asServiceRole.entities.Bom.create(bomData);
          existingBomByCin7Id[cin7BomId] = bomRecord;
          bomsCreated++;
        }
      } catch (err) {
        errors.push(`BOM create ${pp.sku}: ${err.message}`);
        await delay(1100);
        continue;
      }

      // Delete old components and operations for this BOM (clean replace)
      const [oldComponents, oldOps] = await Promise.all([
        base44.asServiceRole.entities.BomComponent.filter({ bom_id: bomRecord.id }),
        base44.asServiceRole.entities.BomOperation.filter({ bom_id: bomRecord.id }),
      ]);
      for (const oc of oldComponents) { await base44.asServiceRole.entities.BomComponent.delete(oc.id); }
      for (const oo of oldOps) { await base44.asServiceRole.entities.BomOperation.delete(oo.id); }

      // Process operations and their components
      const operations = defaultBom.Operations || [];
      for (const op of operations) {
        // Map Cin7 work center to our station enum
        let station = 'cook';
        const wcName = (op.WorkCenterName || op.Name || '').toLowerCase();
        if (wcName.includes('prep')) station = 'prep';
        else if (wcName.includes('portion')) station = 'portion';
        else if (wcName.includes('cook') || wcName.includes('kitchen')) station = 'cook';
        else if (wcName.includes('sleeve') || wcName.includes('pack')) station = 'portion';

        try {
          await base44.asServiceRole.entities.BomOperation.create({
            bom_id: bomRecord.id,
            step_no: op.Order || 1,
            name: op.Name || 'Step',
            station: station,
            cycle_time_min: op.CycleTime ? Math.round(op.CycleTime / 60) : null,
            notes: op.WorkCenterName || '',
          });
          opsCreated++;
        } catch (err) {
          errors.push(`Operation ${op.Name} for ${pp.sku}: ${err.message}`);
        }

        // Create components for this operation
        const components = op.Components || [];
        for (const c of components) {
          const inputProduct = productByCin7Id[c.ProductID] || productBySku[c.ProductSku];
          if (!inputProduct) {
            warnings.push(`${bomType} ${pp.sku}: component ${c.ProductSku} not found`);
            continue;
          }

          // Detect consumables (packaging, sleeves, plates)
          const isConsumable = inputProduct.type === 'packaging' ||
            (inputProduct.name || '').toLowerCase().includes('sleeve') ||
            (inputProduct.name || '').toLowerCase().includes('plate') ||
            (inputProduct.name || '').toLowerCase().includes('lid');

          try {
            await base44.asServiceRole.entities.BomComponent.create({
              bom_id: bomRecord.id,
              input_product_id: inputProduct.id,
              input_product_name: inputProduct.name,
              input_product_sku: inputProduct.sku,
              qty: c.Quantity || 0,
              uom: inputProduct.stock_uom,
              is_consumable: isConsumable,
            });
            componentsCreated++;
          } catch (err) {
            errors.push(`Component ${c.ProductSku} for ${pp.sku}: ${err.message}`);
          }
        }
      }

      await delay(1100); // Respect Cin7 rate limit
    }

    // ─── Update import log ───
    const status = errors.length > 0 ? 'completed_with_warnings' : 'completed';
    await base44.asServiceRole.entities.ImportLog.update(log.id, {
      status,
      total_records: assemblyProducts.length + productionProducts.length,
      created_count: bomsCreated,
      updated_count: bomsUpdated,
      error_count: errors.length,
      warnings: warnings.slice(0, 100),
      errors: errors.slice(0, 50),
      details: JSON.stringify({
        assembly_count: assemblyProducts.length,
        production_count: productionProducts.length,
        components_created: componentsCreated,
        operations_created: opsCreated,
      }),
      finished_at: new Date().toISOString(),
    });

    return Response.json({
      success: true,
      boms_created: bomsCreated,
      boms_updated: bomsUpdated,
      components_created: componentsCreated,
      operations_created: opsCreated,
      warnings: warnings.length,
      errors: errors.length,
      log_id: log.id,
    });
  }

  return Response.json({ error: `Unknown action: ${action}` }, { status: 400 });
});