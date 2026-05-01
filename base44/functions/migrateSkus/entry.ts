import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * migrateSkus — Full SKU migration for the 15 MWL meals.
 *
 * Bulk-fetches ALL records from each entity, filters in-memory for old SKUs,
 * then batch-updates only the affected records. This avoids 15×12 = 180 filter
 * calls and instead does ~12 paginated fetches + targeted writes.
 *
 * Accepts { dry_run: true } to preview without writing.
 */

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function withRetry(fn, maxRetries = 5) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try { return await fn(); }
    catch (err) {
      const msg = (err.message || '').toLowerCase();
      if ((msg.includes('rate limit') || err.status === 429) && attempt < maxRetries) {
        await sleep(3000 * attempt);
        continue;
      }
      throw err;
    }
  }
}

async function fetchAll(entity, sortField = 'id', pageSize = 500) {
  const all = [];
  let skip = 0;
  while (true) {
    const batch = await withRetry(() => entity.list(sortField, pageSize, skip));
    if (!batch || batch.length === 0) break;
    all.push(...batch);
    if (batch.length < pageSize) break;
    skip += pageSize;
    await sleep(500);
  }
  return all;
}

// The 15 SKU mappings from Shopify probe
const SKU_MAP = {
  'BeeandBea-2':                        { newSku: 'MWL1',  variantId: '49806529462551' },
  'BeeTri':                             { newSku: 'MWL2',  variantId: '46502655197463' },
  'ChiBreSwePotandMixVeg':              { newSku: 'MWL3',  variantId: '46502849184023' },
  'ChiBreButandStialowitaSweandSouSau': { newSku: 'MWL4',  variantId: '46502816219415' },
  'ChiBreCouandMixVeg':                 { newSku: 'MWL5',  variantId: '46502827196695' },
  'ChiBrePotWedandCreSpi':              { newSku: 'MWL6',  variantId: '46502839550231' },
  'ChiCur':                             { newSku: 'MWL7',  variantId: '46502858457367' },
  'CotPie':                             { newSku: 'MWL8',  variantId: '46502869893399' },
  'KetButChi':                          { newSku: 'MWL9',  variantId: '46502877364503' },
  'LeaMinPasSheandCor':                 { newSku: 'MWL10', variantId: '46502890340631' },
  'LeaMinWhiBasRicandBro':              { newSku: 'MWL11', variantId: '46502901711127' },
  'LeaMinWhiBasRicandGreBea':           { newSku: 'MWL12', variantId: '46502911410455' },
  'SteBroRicandCar':                    { newSku: 'MWL13', variantId: '46502922158359' },
  'SteSwePotandBro':                    { newSku: 'MWL14', variantId: '46502930284823' },
  'SweChiChi':                          { newSku: 'MWL15', variantId: '46502944342295' },
};

const oldSkuSet = new Set(Object.keys(SKU_MAP));

Deno.serve(async (req) => {
  const startTime = Date.now();
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me();
  if (!user || user.role !== 'admin') {
    return Response.json({ error: 'Forbidden' }, { status: 403 });
  }

  let body = {};
  try { body = await req.json(); } catch {}
  const dryRun = body.dry_run === true;

  const log = [];
  const errors = [];
  const db = base44.asServiceRole.entities;
  const BATCH = 3; // conservative batch size for writes

  async function batchWrite(entityRef, updates, label) {
    let count = 0;
    for (let i = 0; i < updates.length; i += BATCH) {
      const slice = updates.slice(i, i + BATCH);
      await Promise.all(slice.map(async ({ id, data }) => {
        try {
          await withRetry(() => entityRef.update(id, data));
          count++;
        } catch (err) {
          errors.push(`${label} ${id}: ${err.message}`);
        }
      }));
      if (i + BATCH < updates.length) await sleep(800);
    }
    return count;
  }

  // ═══════════════════════════════════════════════════════════
  // 1. PRODUCT — update sku + shopify_variant_id
  // ═══════════════════════════════════════════════════════════
  log.push('--- Step 1: Product ---');
  const allProducts = await fetchAll(db.Product, 'sku');
  const productUpdates = allProducts
    .filter(p => oldSkuSet.has(p.sku))
    .map(p => ({
      id: p.id,
      data: {
        sku: SKU_MAP[p.sku].newSku,
        shopify_variant_id: SKU_MAP[p.sku].variantId,
        external_id: SKU_MAP[p.sku].variantId,
      }
    }));
  log.push(`  Found ${productUpdates.length} products to update`);
  const productCount = dryRun ? productUpdates.length : await batchWrite(db.Product, productUpdates, 'Product');
  log.push(`  Products updated: ${productCount}`);

  // ═══════════════════════════════════════════════════════════
  // 2. PackBom — component_skus, disabled_skus, sku_overrides
  // ═══════════════════════════════════════════════════════════
  log.push('--- Step 2: PackBom ---');
  const allPackBoms = await fetchAll(db.PackBom, 'package_sku');
  const packBomUpdates = [];

  for (const bom of allPackBoms) {
    let changed = false;
    const newComponents = (bom.component_skus || []).map(s => {
      if (SKU_MAP[s]) { changed = true; return SKU_MAP[s].newSku; }
      return s;
    });
    const newDisabled = (bom.disabled_skus || []).map(s => {
      if (SKU_MAP[s]) { changed = true; return SKU_MAP[s].newSku; }
      return s;
    });
    let overrides = {};
    try { overrides = JSON.parse(bom.sku_overrides || '{}'); } catch {}
    const newOverrides = {};
    for (const [k, v] of Object.entries(overrides)) {
      if (SKU_MAP[k]) { changed = true; newOverrides[SKU_MAP[k].newSku] = v; }
      else { newOverrides[k] = v; }
    }
    if (changed) {
      packBomUpdates.push({
        id: bom.id,
        data: {
          component_skus: newComponents,
          disabled_skus: newDisabled,
          sku_overrides: JSON.stringify(newOverrides),
        },
      });
    }
  }
  log.push(`  Found ${packBomUpdates.length} PackBoms to update`);
  const packBomCount = dryRun ? packBomUpdates.length : await batchWrite(db.PackBom, packBomUpdates, 'PackBom');
  log.push(`  PackBoms updated: ${packBomCount}`);

  // ═══════════════════════════════════════════════════════════
  // 3. SalesOrderLine — sku
  // ═══════════════════════════════════════════════════════════
  log.push('--- Step 3: SalesOrderLine ---');
  const allSOL = await fetchAll(db.SalesOrderLine, 'id');
  const solUpdates = allSOL
    .filter(l => oldSkuSet.has(l.sku))
    .map(l => ({ id: l.id, data: { sku: SKU_MAP[l.sku].newSku } }));
  log.push(`  Found ${solUpdates.length} SalesOrderLines to update`);
  const solCount = dryRun ? solUpdates.length : await batchWrite(db.SalesOrderLine, solUpdates, 'SOL');
  log.push(`  SalesOrderLines updated: ${solCount}`);

  // ═══════════════════════════════════════════════════════════
  // 4. StockOnHand — product_sku
  // ═══════════════════════════════════════════════════════════
  log.push('--- Step 4: StockOnHand ---');
  const allSOH = await fetchAll(db.StockOnHand, 'product_sku');
  const sohUpdates = allSOH
    .filter(s => oldSkuSet.has(s.product_sku))
    .map(s => ({ id: s.id, data: { product_sku: SKU_MAP[s.product_sku].newSku } }));
  log.push(`  Found ${sohUpdates.length} StockOnHand to update`);
  const sohCount = dryRun ? sohUpdates.length : await batchWrite(db.StockOnHand, sohUpdates, 'SOH');
  log.push(`  StockOnHand updated: ${sohCount}`);

  // ═══════════════════════════════════════════════════════════
  // 5. StockMovement — product_sku
  // ═══════════════════════════════════════════════════════════
  log.push('--- Step 5: StockMovement ---');
  const allSM = await fetchAll(db.StockMovement, 'id');
  const smUpdates = allSM
    .filter(m => oldSkuSet.has(m.product_sku))
    .map(m => ({ id: m.id, data: { product_sku: SKU_MAP[m.product_sku].newSku } }));
  log.push(`  Found ${smUpdates.length} StockMovements to update`);
  const smCount = dryRun ? smUpdates.length : await batchWrite(db.StockMovement, smUpdates, 'SM');
  log.push(`  StockMovements updated: ${smCount}`);

  // ═══════════════════════════════════════════════════════════
  // 6. Bom — product_sku
  // ═══════════════════════════════════════════════════════════
  log.push('--- Step 6: Bom ---');
  const allBom = await fetchAll(db.Bom, 'id');
  const bomUpdates = allBom
    .filter(b => oldSkuSet.has(b.product_sku))
    .map(b => ({ id: b.id, data: { product_sku: SKU_MAP[b.product_sku].newSku } }));
  log.push(`  Found ${bomUpdates.length} Boms to update`);
  const bomCount = dryRun ? bomUpdates.length : await batchWrite(db.Bom, bomUpdates, 'Bom');
  log.push(`  Boms updated: ${bomCount}`);

  // ═══════════════════════════════════════════════════════════
  // 7. BomComponent — input_product_sku
  // ═══════════════════════════════════════════════════════════
  log.push('--- Step 7: BomComponent ---');
  const allBC = await fetchAll(db.BomComponent, 'id');
  const bcUpdates = allBC
    .filter(c => oldSkuSet.has(c.input_product_sku))
    .map(c => ({ id: c.id, data: { input_product_sku: SKU_MAP[c.input_product_sku].newSku } }));
  log.push(`  Found ${bcUpdates.length} BomComponents to update`);
  const bcCount = dryRun ? bcUpdates.length : await batchWrite(db.BomComponent, bcUpdates, 'BC');
  log.push(`  BomComponents updated: ${bcCount}`);

  // ═══════════════════════════════════════════════════════════
  // 8. ProductionRunLine — product_sku
  // ═══════════════════════════════════════════════════════════
  log.push('--- Step 8: ProductionRunLine ---');
  const allPRL = await fetchAll(db.ProductionRunLine, 'id');
  const prlUpdates = allPRL
    .filter(l => oldSkuSet.has(l.product_sku))
    .map(l => ({ id: l.id, data: { product_sku: SKU_MAP[l.product_sku].newSku } }));
  log.push(`  Found ${prlUpdates.length} ProductionRunLines to update`);
  const prlCount = dryRun ? prlUpdates.length : await batchWrite(db.ProductionRunLine, prlUpdates, 'PRL');
  log.push(`  ProductionRunLines updated: ${prlCount}`);

  // ═══════════════════════════════════════════════════════════
  // 9. ProductionTask — product_sku
  // ═══════════════════════════════════════════════════════════
  log.push('--- Step 9: ProductionTask ---');
  const allPT = await fetchAll(db.ProductionTask, 'id');
  const ptUpdates = allPT
    .filter(t => oldSkuSet.has(t.product_sku))
    .map(t => ({ id: t.id, data: { product_sku: SKU_MAP[t.product_sku].newSku } }));
  log.push(`  Found ${ptUpdates.length} ProductionTasks to update`);
  const ptCount = dryRun ? ptUpdates.length : await batchWrite(db.ProductionTask, ptUpdates, 'PT');
  log.push(`  ProductionTasks updated: ${ptCount}`);

  // ═══════════════════════════════════════════════════════════
  // 10. DecomposedLine — meal_sku
  // ═══════════════════════════════════════════════════════════
  log.push('--- Step 10: DecomposedLine ---');
  const allDL = await fetchAll(db.DecomposedLine, 'id');
  const dlUpdates = allDL
    .filter(d => oldSkuSet.has(d.meal_sku))
    .map(d => ({ id: d.id, data: { meal_sku: SKU_MAP[d.meal_sku].newSku } }));
  log.push(`  Found ${dlUpdates.length} DecomposedLines to update`);
  const dlCount = dryRun ? dlUpdates.length : await batchWrite(db.DecomposedLine, dlUpdates, 'DL');
  log.push(`  DecomposedLines updated: ${dlCount}`);

  // ═══════════════════════════════════════════════════════════
  // 11. CommittedDemand — sku_id
  // ═══════════════════════════════════════════════════════════
  log.push('--- Step 11: CommittedDemand ---');
  const allCD = await fetchAll(db.CommittedDemand, 'id');
  const cdUpdates = allCD
    .filter(c => oldSkuSet.has(c.sku_id))
    .map(c => ({ id: c.id, data: { sku_id: SKU_MAP[c.sku_id].newSku } }));
  log.push(`  Found ${cdUpdates.length} CommittedDemand to update`);
  const cdCount = dryRun ? cdUpdates.length : await batchWrite(db.CommittedDemand, cdUpdates, 'CD');
  log.push(`  CommittedDemand updated: ${cdCount}`);

  // ═══════════════════════════════════════════════════════════
  // 12. ParLevel — sku_id
  // ═══════════════════════════════════════════════════════════
  log.push('--- Step 12: ParLevel ---');
  const allPL = await fetchAll(db.ParLevel, 'id');
  const plUpdates = allPL
    .filter(p => oldSkuSet.has(p.sku_id))
    .map(p => ({ id: p.id, data: { sku_id: SKU_MAP[p.sku_id].newSku } }));
  log.push(`  Found ${plUpdates.length} ParLevels to update`);
  const plCount = dryRun ? plUpdates.length : await batchWrite(db.ParLevel, plUpdates, 'PL');
  log.push(`  ParLevels updated: ${plCount}`);

  // ═══════════════════════════════════════════════════════════
  // AUDIT LOG
  // ═══════════════════════════════════════════════════════════
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  const summary = {
    products: productCount, pack_boms: packBomCount,
    sales_order_lines: solCount, stock_on_hand: sohCount,
    stock_movements: smCount, boms: bomCount,
    bom_components: bcCount, production_run_lines: prlCount,
    production_tasks: ptCount, decomposed_lines: dlCount,
    committed_demand: cdCount, par_levels: plCount,
  };
  const totalUpdated = Object.values(summary).reduce((a, b) => a + b, 0);

  if (!dryRun) {
    try {
      await db.AuditLog.create({
        action: 'sku_migration',
        entity_type: 'Product',
        description: `MWL SKU migration: ${totalUpdated} records updated across 12 entities in ${elapsed}s. ` +
          Object.entries(summary).map(([k, v]) => `${k}=${v}`).join(', '),
      });
    } catch {}
  }

  log.push(`\n=== ${dryRun ? 'DRY RUN' : 'MIGRATION'} COMPLETE in ${elapsed}s ===`);
  log.push(`Total records ${dryRun ? 'would be' : ''} updated: ${totalUpdated}`);

  return Response.json({
    status: dryRun ? 'dry_run_complete' : (errors.length > 0 ? 'completed_with_errors' : 'completed'),
    elapsed_seconds: parseFloat(elapsed),
    dry_run: dryRun,
    summary,
    total_updated: totalUpdated,
    errors,
    log,
  });
});