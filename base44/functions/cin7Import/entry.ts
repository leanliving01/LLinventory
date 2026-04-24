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
        const wait = Math.min(2000 * Math.pow(2, attempt), 30000); // 2s, 4s, 8s, 16s, 30s
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
  throw new Error(`Cin7 API rate limit exceeded after 3 retries on ${path}`);
}

// Cin7 category → our Product.type mapping (§5.0.1)
function mapCategoryToType(category, sku, tags) {
  const cat = (category || '').toLowerCase().trim();
  const skuUpper = (sku || '').toUpperCase();
  const tagStr = (tags || []).join(',').toLowerCase();
  
  if (cat === 'raw materials' || cat === 'raw material') return 'raw';
  if (cat === 'raw materials - packaging') return 'packaging';
  if (cat === 'work in progress') return 'wip_bulk';
  if (cat === 'solo serve') return 'solo_serve';
  if (cat === 'supplements') return 'supplement';
  if (cat === 'low calorie sauce' || cat === 'low calorie sauces') return 'sauce';
  if (cat === 'transformation package' || cat === 'bundle' || cat === 'bundles') return 'bundle';
  if (cat === 'service' || cat === 'services') return 'service';
  
  // BYO Meals category = finished_meal (individual portioned meals)
  if (cat === 'byo meals') return 'finished_meal';
  
  // Meals category: check if it's a package SKU (MenLeaMus, MenWeiLos, WomLeaMus, WomWeiLos, SCP)
  if (cat === 'meals') {
    if (/^(MenLeaMus|MenWeiLos|WomLeaMus|WomWeiLos|SCP)\d+$/i.test(skuUpper)) return 'package';
    return 'finished_meal';
  }
  
  // Smart Carb: SCP15/30/60 are packages, individual items are finished_meal
  if (cat === 'smart carb') {
    if (/^SCP\d+$/i.test(skuUpper)) return 'package';
    return 'finished_meal';
  }
  
  // Alt UoM: these are UoM variants of a parent product
  if (cat === 'alt uom' || cat === 'alternative uom') return 'raw'; // will set parent_product_id
  
  return 'raw'; // default fallback
}

function mapStockUom(cin7Unit) {
  const u = (cin7Unit || '').toLowerCase().trim();
  if (u === 'kg' || u === 'kgs') return 'kg';
  if (u === 'g' || u === 'grams' || u === 'gram') return 'g';
  if (u === 'ml' || u === 'millilitre') return 'ml';
  if (u === 'l' || u === 'litre' || u === 'litres') return 'L';
  if (u === 'pcs' || u === 'piece' || u === 'pieces' || u === 'each' || u === 'ea') return 'pcs';
  if (u === 'box' || u === 'boxes' || u === 'case') return 'box';
  return 'pcs';
}

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me();
  if (!user || user.role !== 'admin') {
    return Response.json({ error: 'Admin access required' }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const action = body.action || 'test'; // test, import_products, import_suppliers, import_boms, import_stock

  const accountId = Deno.env.get('CIN7_ACCOUNT_ID');
  const appKey = Deno.env.get('CIN7_APPLICATION_KEY');
  
  if (!accountId || !appKey) {
    return Response.json({ error: 'Cin7 credentials not configured. Set CIN7_ACCOUNT_ID and CIN7_APPLICATION_KEY in environment variables.' }, { status: 400 });
  }

  // ─── TEST CONNECTION ───
  if (action === 'test') {
    const data = await cin7Fetch('/Product?Page=1&Limit=1', accountId, appKey);
    return Response.json({ 
      success: true, 
      message: 'Connected to Cin7 successfully',
      total_products: data.Total || 0,
    });
  }

  // ─── IMPORT PRODUCTS ───
  if (action === 'import_products') {
    // Create import log
    const log = await base44Call(() => base44.asServiceRole.entities.ImportLog.create({
      import_type: 'products',
      status: 'running',
      started_at: new Date().toISOString(),
    }));

    const warnings = [];
    const errors = [];
    let created = 0, updated = 0, skipped = 0, total = 0;
    const details = [];

    // Load existing products for idempotent upsert
    const existingProducts = await base44Call(() => base44.asServiceRole.entities.Product.filter({}));
    const existingBySku = {};
    existingProducts.forEach(p => { existingBySku[p.sku] = p; });
    // Also index by cin7_id
    const existingByCin7Id = {};
    existingProducts.forEach(p => { if (p.cin7_id) existingByCin7Id[p.cin7_id] = p; });

    // Paginate through Cin7 products
    let page = 1;
    let hasMore = true;
    
    while (hasMore) {
      let products;
      try {
        products = await cin7Fetch(`/Product?Page=${page}&Limit=250`, accountId, appKey);
      } catch (err) {
        errors.push(`Page ${page}: ${err.message}`);
        break;
      }

      const productList = products.Products || [];
      if (productList.length === 0) {
        hasMore = false;
        break;
      }

      for (const cin7Product of productList) {
        total++;
        const cin7Id = String(cin7Product.ID || '');
        let sku = (cin7Product.SKU || cin7Product.Code || '').trim();
        
        // Known anomaly: BeeandBea-2 → MWL1 (§4.4)
        if (sku === 'BeeandBea-2') {
          sku = 'MWL1';
          warnings.push(`Mapped BeeandBea-2 → MWL1 (known Cin7 anomaly §4.4)`);
        }

        if (!sku) {
          skipped++;
          warnings.push(`Product id=${cin7Id} has no SKU, skipped`);
          continue;
        }

        const category = cin7Product.Category || '';
        const tags = (cin7Product.Tags || '').split(',').map(t => t.trim()).filter(Boolean);
        const productType = mapCategoryToType(category, sku, tags);
        const stockUom = mapStockUom(cin7Product.UOM || '');

        const productData = {
          sku: sku,
          name: cin7Product.Name || cin7Product.Description || sku,
          barcode: cin7Product.Barcode || '',
          type: productType,
          category: category,
          tags: tags,
          stock_uom: stockUom,
          cost_avg: cin7Product.CostingMethod === 'FIFO' ? (cin7Product.AverageCost || 0) : (cin7Product.AverageCost || cin7Product.CostPrice || 0),
          price: cin7Product.PriceTier1 || cin7Product.DefaultPrice || 0,
          weight_g: cin7Product.Weight ? cin7Product.Weight * 1000 : null,
          description: cin7Product.Description || '',
          status: cin7Product.Status === 'Active' ? 'active' : 'archived',
          cin7_id: cin7Id,
        };

        // Check for existing product (by cin7_id first, then by sku)
        const existing = existingByCin7Id[cin7Id] || existingBySku[sku];
        
        try {
          if (existing) {
            await base44Call(() => base44.asServiceRole.entities.Product.update(existing.id, productData));
            updated++;
            details.push({ sku, action: 'updated', type: productType, category });
          } else {
            const newProd = await base44Call(() => base44.asServiceRole.entities.Product.create(productData));
            created++;
            existingBySku[sku] = newProd;
            existingByCin7Id[cin7Id] = newProd;
            details.push({ sku, action: 'created', type: productType, category });
          }
        } catch (err) {
          errors.push(`SKU ${sku}: ${err.message}`);
        }
        
        // Throttle Base44 writes: pause every 10 records
        if (total % 10 === 0) await delay(1000);
      }

      page++;
      await delay(1100); // Respect Cin7 rate limit: 60 req/min
    }

    // Update import log
    await base44Call(() => base44.asServiceRole.entities.ImportLog.update(log.id, {
      status: errors.length > 0 ? 'completed_with_warnings' : 'completed',
      total_records: total,
      created_count: created,
      updated_count: updated,
      skipped_count: skipped,
      error_count: errors.length,
      warnings: warnings.slice(0, 100),
      errors: errors.slice(0, 50),
      details: JSON.stringify(details.slice(0, 200)),
      finished_at: new Date().toISOString(),
    }));

    return Response.json({
      success: true,
      total, created, updated, skipped,
      warnings: warnings.length,
      errors: errors.length,
      log_id: log.id,
    });
  }

  // ─── IMPORT SUPPLIERS ───
  if (action === 'import_suppliers') {
    const log = await base44Call(() => base44.asServiceRole.entities.ImportLog.create({
      import_type: 'suppliers',
      status: 'running',
      started_at: new Date().toISOString(),
    }));

    const existingSuppliers = await base44Call(() => base44.asServiceRole.entities.Supplier.filter({}));
    const existingByName = {};
    existingSuppliers.forEach(s => { existingByName[s.name?.toLowerCase()] = s; });
    const existingByCin7 = {};
    existingSuppliers.forEach(s => { if (s.cin7_id) existingByCin7[s.cin7_id] = s; });

    let created = 0, updated = 0, total = 0;
    const warnings = [];
    const errors = [];

    let page = 1;
    let hasMore = true;

    while (hasMore) {
      let suppliers;
      try {
        suppliers = await cin7Fetch(`/Supplier?Page=${page}&Limit=250`, accountId, appKey);
      } catch (err) {
        errors.push(`Page ${page}: ${err.message}`);
        break;
      }

      const supplierList = suppliers.SupplierList || [];
      if (supplierList.length === 0) {
        hasMore = false;
        break;
      }

      for (const s of supplierList) {
        total++;
        const cin7Id = String(s.ID || '');
        const name = (s.Name || s.Company || '').trim();
        if (!name) { warnings.push(`Supplier cin7_id=${cin7Id}: no name, skipped`); continue; }

        const supplierData = {
          name,
          contact_name: s.ContactName || '',
          phone: s.Phone || '',
          email: s.Email || '',
          payment_terms: s.PaymentTerm || '',
          billing_address: [s.Address1, s.Address2, s.City, s.State, s.Postcode, s.Country].filter(Boolean).join(', '),
          status: s.Status === 'Active' ? 'active' : 'inactive',
          cin7_id: cin7Id,
        };

        const existing = existingByCin7[cin7Id] || existingByName[name.toLowerCase()];
        try {
          if (existing) {
            await base44Call(() => base44.asServiceRole.entities.Supplier.update(existing.id, supplierData));
            updated++;
          } else {
            await base44Call(() => base44.asServiceRole.entities.Supplier.create(supplierData));
            created++;
          }
        } catch (err) {
          errors.push(`Supplier ${name}: ${err.message}`);
        }
        // Throttle Base44 writes
        if (total % 10 === 0) await delay(1000);
      }

      page++;
      await delay(1100);
    }

    await base44Call(() => base44.asServiceRole.entities.ImportLog.update(log.id, {
      status: errors.length > 0 ? 'completed_with_warnings' : 'completed',
      total_records: total, created_count: created, updated_count: updated,
      error_count: errors.length,
      warnings: warnings.slice(0, 50),
      errors: errors.slice(0, 50),
      finished_at: new Date().toISOString(),
    }));

    return Response.json({ success: true, total, created, updated, errors: errors.length, log_id: log.id });
  }

  // ─── IMPORT STOCK ON HAND (batched — one Cin7 page per call) ───
  if (action === 'import_stock') {
    const cin7Page = body.page || 1;
    const isFirstPage = cin7Page === 1;

    // Only create a log on the first page
    let logId = body.log_id || null;
    if (isFirstPage) {
      const log = await base44Call(() => base44.asServiceRole.entities.ImportLog.create({
        import_type: 'stock',
        status: 'running',
        started_at: new Date().toISOString(),
      }));
      logId = log.id;
    }

    // Load reference data (staggered)
    console.log('Loading products...');
    const products = await base44Call(() => base44.asServiceRole.entities.Product.filter({}));
    console.log(`Loaded ${products.length} products`);
    const productBySku = {};
    products.forEach(p => { productBySku[p.sku] = p; });
    const productByCin7Id = {};
    products.forEach(p => { if (p.cin7_id) productByCin7Id[p.cin7_id] = p; });
    await delay(500);

    console.log('Loading locations...');
    const locations = await base44Call(() => base44.asServiceRole.entities.Location.filter({}));
    console.log(`Loaded ${locations.length} locations`);
    const locationByName = {};
    locations.forEach(l => { locationByName[l.name.toLowerCase()] = l; });
    await delay(500);

    console.log('Loading existing SOH...');
    const existingSoh = await base44Call(() => base44.asServiceRole.entities.StockOnHand.filter({}));
    console.log(`Loaded ${existingSoh.length} SOH records`);
    const sohByKey = {};
    existingSoh.forEach(s => { sohByKey[`${s.product_id}__${s.location_id}`] = s; });

    const defaultLoc = locations.find(l => l.code === 'OTHER') || locations[0];

    let created = 0, total = 0;
    const warnings = [];
    const errors = [];

    // Fetch ONE page from Cin7
    console.log(`Fetching Cin7 stock page ${cin7Page}...`);
    let availability;
    try {
      availability = await cin7Fetch(`/ref/productavailability?Page=${cin7Page}&Limit=50`, accountId, appKey);
    } catch (err) {
      console.log(`Cin7 fetch failed: ${err.message}`);
      return Response.json({ success: false, error: `Cin7 page ${cin7Page}: ${err.message}` }, { status: 500 });
    }

    const stockList = availability.ProductAvailabilityList || [];
    const hasMore = stockList.length >= 50;
    console.log(`Got ${stockList.length} stock items from Cin7, hasMore=${hasMore}`);

    for (const item of stockList) {
      total++;
      const cin7ProductId = String(item.ID || item.ProductID || '');
      const sku = item.SKU || '';
      const product = productByCin7Id[cin7ProductId] || productBySku[sku];

      if (!product) {
        warnings.push(`Stock for unknown product cin7_id=${cin7ProductId} sku=${sku}`);
        continue;
      }

      const qty = item.Available || item.OnHand || 0;
      if (qty === 0) continue;

      // Match location
      const cin7Location = (item.Location || item.Warehouse || '').toLowerCase();
      let location = null;
      if (cin7Location.includes('dry')) location = locationByName['main warehouse: dry storage'];
      else if (cin7Location.includes('cold') || cin7Location.includes('chill')) location = locationByName['main warehouse: cold storage'];
      else if (cin7Location.includes('pack')) location = locationByName['main warehouse: packing storage'];
      else if (cin7Location.includes('freezer') && cin7Location.includes('dispatch')) location = locationByName['main warehouse: dispatch freezer'];
      else if (cin7Location.includes('freezer') || cin7Location.includes('freeze')) location = locationByName['main warehouse: meal freezer'];
      if (!location) location = defaultLoc;

      try {
        await base44Call(() => base44.asServiceRole.entities.StockMovement.create({
          product_id: product.id, product_sku: product.sku, product_name: product.name,
          to_location_id: location.id, qty, uom: product.stock_uom,
          reason: 'receipt', ref_type: 'cin7_import', ref_id: cin7ProductId,
          unit_cost_at_movement: product.cost_avg || 0,
          notes: 'Initial stock from Cin7 import',
        }));

        const sohKey = `${product.id}__${location.id}`;
        const existingRec = sohByKey[sohKey];
        if (existingRec) {
          const newQty = (existingRec.qty_on_hand || 0) + qty;
          await base44Call(() => base44.asServiceRole.entities.StockOnHand.update(existingRec.id, {
            qty_on_hand: newQty,
            qty_available: newQty - (existingRec.qty_committed || 0),
            last_updated_at: new Date().toISOString(),
          }));
          existingRec.qty_on_hand = newQty;
        } else {
          const newSoh = await base44Call(() => base44.asServiceRole.entities.StockOnHand.create({
            product_id: product.id, product_sku: product.sku, product_name: product.name,
            location_id: location.id, location_name: location?.name || 'Unknown',
            qty_on_hand: qty, qty_committed: 0, qty_available: qty,
            uom: product.stock_uom, last_updated_at: new Date().toISOString(),
          }));
          sohByKey[sohKey] = newSoh;
        }
        // Throttle every 3 items
        if (total % 3 === 0) await delay(500);

        created++;
      } catch (err) {
        errors.push(`Stock ${product.sku}: ${err.message}`);
      }
    }

    // Update log when done (last page)
    if (!hasMore && logId) {
      await base44Call(() => base44.asServiceRole.entities.ImportLog.update(logId, {
        status: errors.length > 0 ? 'completed_with_warnings' : 'completed',
        total_records: total, created_count: created,
        error_count: errors.length,
        warnings: warnings.slice(0, 50),
        errors: errors.slice(0, 50),
        finished_at: new Date().toISOString(),
      }));
    }

    return Response.json({
      success: true, page: cin7Page, processed: total, created,
      warnings: warnings.length, errors: errors.length,
      has_more: hasMore, next_page: cin7Page + 1,
      log_id: logId,
    });
  }

  return Response.json({ error: `Unknown action: ${action}` }, { status: 400 });
});