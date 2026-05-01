import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * migrateSkus — Phased SKU migration for the 15 MWL meals.
 *
 * Call with { step: 1 } through { step: 7 } to run each phase sequentially.
 * Each phase handles a subset of entities to stay within timeout/rate limits.
 *
 * Step 1: Product (15) + PackBom (3) + Bom (14) + BomComponent (42)
 * Step 2: StockOnHand (41) + StockMovement (148)
 * Step 3: SalesOrderLine batch 1 (first 300)
 * Step 4: SalesOrderLine batch 2 (next 300)
 * Step 5: SalesOrderLine batch 3 (remaining)
 * Step 6: ProductionRunLine (22) + ProductionTask (5) + DecomposedLine + CommittedDemand (34) + ParLevel
 * Step 7: Verification — check all entities for any remaining old SKUs
 *
 * Use { step: N, dry_run: true } to preview.
 */

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function withRetry(fn, maxRetries = 6) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try { return await fn(); }
    catch (err) {
      const msg = (err.message || '').toLowerCase();
      if ((msg.includes('rate limit') || err.status === 429) && attempt < maxRetries) {
        const backoff = 4000 * attempt;
        console.log(`Rate limited, backoff ${backoff}ms (attempt ${attempt})`);
        await sleep(backoff);
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
    await sleep(600);
  }
  return all;
}

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

const OLD_SKUS = new Set(Object.keys(SKU_MAP));

Deno.serve(async (req) => {
  const startTime = Date.now();
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me();
  if (!user || user.role !== 'admin') {
    return Response.json({ error: 'Forbidden' }, { status: 403 });
  }

  let body = {};
  try { body = await req.json(); } catch {}
  const step = body.step || 1;
  const dryRun = body.dry_run === true;

  const log = [];
  const errors = [];
  const db = base44.asServiceRole.entities;

  async function batchWrite(entityRef, updates, label) {
    let count = 0;
    // Sequential with generous delays to avoid rate limits on large sets
    for (let i = 0; i < updates.length; i++) {
      const { id, data } = updates[i];
      if (dryRun) { count++; continue; }
      try {
        await withRetry(() => entityRef.update(id, data));
        count++;
      } catch (err) {
        errors.push(`${label} ${id}: ${err.message}`);
      }
      // Throttle: 1 write per 400ms = ~150/min, well under rate limits
      if (i < updates.length - 1) await sleep(400);
    }
    return count;
  }

  // ── STEP 1: Product + PackBom + Bom + BomComponent (~74 writes) ──
  if (step === 1) {
    log.push('=== STEP 1: Product + PackBom + Bom + BomComponent ===');

    // Products
    const allProducts = await fetchAll(db.Product, 'sku');
    const productUpdates = allProducts.filter(p => OLD_SKUS.has(p.sku)).map(p => ({
      id: p.id, data: { sku: SKU_MAP[p.sku].newSku, shopify_variant_id: SKU_MAP[p.sku].variantId, external_id: SKU_MAP[p.sku].variantId }
    }));
    const pc = await batchWrite(db.Product, productUpdates, 'Product');
    log.push(`Products: ${pc}/${productUpdates.length}`);

    // PackBoms
    const allPB = await fetchAll(db.PackBom, 'package_sku');
    const pbUpdates = [];
    for (const bom of allPB) {
      let changed = false;
      const nc = (bom.component_skus || []).map(s => { if (SKU_MAP[s]) { changed = true; return SKU_MAP[s].newSku; } return s; });
      const nd = (bom.disabled_skus || []).map(s => { if (SKU_MAP[s]) { changed = true; return SKU_MAP[s].newSku; } return s; });
      let ov = {}; try { ov = JSON.parse(bom.sku_overrides || '{}'); } catch {}
      const no = {};
      for (const [k, v] of Object.entries(ov)) { if (SKU_MAP[k]) { changed = true; no[SKU_MAP[k].newSku] = v; } else { no[k] = v; } }
      if (changed) pbUpdates.push({ id: bom.id, data: { component_skus: nc, disabled_skus: nd, sku_overrides: JSON.stringify(no) } });
    }
    const pbc = await batchWrite(db.PackBom, pbUpdates, 'PackBom');
    log.push(`PackBoms: ${pbc}/${pbUpdates.length}`);

    // Boms
    const allBom = await fetchAll(db.Bom, 'id');
    const bomUpdates = allBom.filter(b => OLD_SKUS.has(b.product_sku)).map(b => ({ id: b.id, data: { product_sku: SKU_MAP[b.product_sku].newSku } }));
    const bc = await batchWrite(db.Bom, bomUpdates, 'Bom');
    log.push(`Boms: ${bc}/${bomUpdates.length}`);

    // BomComponents
    const allBC = await fetchAll(db.BomComponent, 'id');
    const bcUpdates = allBC.filter(c => OLD_SKUS.has(c.input_product_sku)).map(c => ({ id: c.id, data: { input_product_sku: SKU_MAP[c.input_product_sku].newSku } }));
    const bcc = await batchWrite(db.BomComponent, bcUpdates, 'BomComp');
    log.push(`BomComponents: ${bcc}/${bcUpdates.length}`);
  }

  // ── STEP 2: StockOnHand only ──
  if (step === 2) {
    log.push('=== STEP 2: StockOnHand ===');
    const allSOH = await fetchAll(db.StockOnHand, 'product_sku');
    const sohUpdates = allSOH.filter(s => OLD_SKUS.has(s.product_sku)).map(s => ({ id: s.id, data: { product_sku: SKU_MAP[s.product_sku].newSku } }));
    const sc = await batchWrite(db.StockOnHand, sohUpdates, 'SOH');
    log.push(`StockOnHand: ${sc}/${sohUpdates.length}`);
  }

  // ── STEP 2b: StockMovement (can be large) ──
  if (step === 20) {
    log.push('=== STEP 2b: StockMovement ===');
    const allSM = await fetchAll(db.StockMovement, 'id');
    const smUpdates = allSM.filter(m => OLD_SKUS.has(m.product_sku)).map(m => ({ id: m.id, data: { product_sku: SKU_MAP[m.product_sku].newSku } }));
    log.push(`StockMovements to update: ${smUpdates.length}`);
    const smc = await batchWrite(db.StockMovement, smUpdates, 'SM');
    log.push(`StockMovements: ${smc}/${smUpdates.length}`);
  }

  // ── STEP 3-5: SalesOrderLine (pass step=3,4,5 — each does up to 150) ──
  if (step >= 3 && step <= 5) {
    log.push(`=== STEP ${step}: SalesOrderLine batch ===`);
    const allSOL = await fetchAll(db.SalesOrderLine, 'id');
    const solUpdates = allSOL.filter(l => OLD_SKUS.has(l.sku)).map(l => ({ id: l.id, data: { sku: SKU_MAP[l.sku].newSku } }));
    log.push(`Remaining SOL with old SKUs: ${solUpdates.length}`);
    const batch = solUpdates.slice(0, 150);
    const sc = await batchWrite(db.SalesOrderLine, batch, 'SOL');
    log.push(`Updated: ${sc}/${batch.length} (${Math.max(0, solUpdates.length - batch.length)} still remaining)`);
  }

  // ── STEP 6: ProductionRunLine + ProductionTask + DecomposedLine + CommittedDemand + ParLevel ──
  if (step === 6) {
    log.push('=== STEP 6: Remaining entities ===');

    const allPRL = await fetchAll(db.ProductionRunLine, 'id');
    const prlUpdates = allPRL.filter(l => OLD_SKUS.has(l.product_sku)).map(l => ({ id: l.id, data: { product_sku: SKU_MAP[l.product_sku].newSku } }));
    const prlc = await batchWrite(db.ProductionRunLine, prlUpdates, 'PRL');
    log.push(`ProductionRunLines: ${prlc}/${prlUpdates.length}`);

    const allPT = await fetchAll(db.ProductionTask, 'id');
    const ptUpdates = allPT.filter(t => OLD_SKUS.has(t.product_sku)).map(t => ({ id: t.id, data: { product_sku: SKU_MAP[t.product_sku].newSku } }));
    const ptc = await batchWrite(db.ProductionTask, ptUpdates, 'PT');
    log.push(`ProductionTasks: ${ptc}/${ptUpdates.length}`);

    const allDL = await fetchAll(db.DecomposedLine, 'id');
    const dlUpdates = allDL.filter(d => OLD_SKUS.has(d.meal_sku)).map(d => ({ id: d.id, data: { meal_sku: SKU_MAP[d.meal_sku].newSku } }));
    const dlc = await batchWrite(db.DecomposedLine, dlUpdates, 'DL');
    log.push(`DecomposedLines: ${dlc}/${dlUpdates.length}`);

    const allCD = await fetchAll(db.CommittedDemand, 'id');
    const cdUpdates = allCD.filter(c => OLD_SKUS.has(c.sku_id)).map(c => ({ id: c.id, data: { sku_id: SKU_MAP[c.sku_id].newSku } }));
    const cdc = await batchWrite(db.CommittedDemand, cdUpdates, 'CD');
    log.push(`CommittedDemand: ${cdc}/${cdUpdates.length}`);

    const allPL = await fetchAll(db.ParLevel, 'id');
    const plUpdates = allPL.filter(p => OLD_SKUS.has(p.sku_id)).map(p => ({ id: p.id, data: { sku_id: SKU_MAP[p.sku_id].newSku } }));
    const plc = await batchWrite(db.ParLevel, plUpdates, 'PL');
    log.push(`ParLevels: ${plc}/${plUpdates.length}`);

    // Audit log
    if (!dryRun) {
      try {
        await db.AuditLog.create({
          action: 'sku_migration', entity_type: 'Product',
          description: `MWL SKU migration step 6 complete — all entities processed.`,
        });
      } catch {}
    }
  }

  // ── STEP 7: Verification — scan all entities for leftover old SKUs ──
  if (step === 7) {
    log.push('=== STEP 7: VERIFICATION ===');

    const checks = [
      { name: 'Product', entity: db.Product, field: 'sku' },
      { name: 'SalesOrderLine', entity: db.SalesOrderLine, field: 'sku' },
      { name: 'StockOnHand', entity: db.StockOnHand, field: 'product_sku' },
      { name: 'StockMovement', entity: db.StockMovement, field: 'product_sku' },
      { name: 'Bom', entity: db.Bom, field: 'product_sku' },
      { name: 'BomComponent', entity: db.BomComponent, field: 'input_product_sku' },
      { name: 'ProductionRunLine', entity: db.ProductionRunLine, field: 'product_sku' },
      { name: 'ProductionTask', entity: db.ProductionTask, field: 'product_sku' },
      { name: 'DecomposedLine', entity: db.DecomposedLine, field: 'meal_sku' },
      { name: 'CommittedDemand', entity: db.CommittedDemand, field: 'sku_id' },
      { name: 'ParLevel', entity: db.ParLevel, field: 'sku_id' },
    ];

    let allClean = true;
    for (const check of checks) {
      const all = await fetchAll(check.entity, 'id');
      const stale = all.filter(r => OLD_SKUS.has(r[check.field]));
      if (stale.length > 0) {
        allClean = false;
        log.push(`❌ ${check.name}: ${stale.length} records still have old SKUs`);
        // Show first 3
        stale.slice(0, 3).forEach(r => log.push(`   - id=${r.id} ${check.field}=${r[check.field]}`));
      } else {
        log.push(`✅ ${check.name}: clean`);
      }
      await sleep(400);
    }

    // PackBom special check
    const allPB = await fetchAll(db.PackBom, 'package_sku');
    let pbStale = 0;
    for (const bom of allPB) {
      const hasOld = (bom.component_skus || []).some(s => OLD_SKUS.has(s)) ||
        (bom.disabled_skus || []).some(s => OLD_SKUS.has(s));
      let ovHasOld = false;
      try { const ov = JSON.parse(bom.sku_overrides || '{}'); ovHasOld = Object.keys(ov).some(k => OLD_SKUS.has(k)); } catch {}
      if (hasOld || ovHasOld) { pbStale++; log.push(`❌ PackBom ${bom.package_sku}: still has old SKUs`); allClean = false; }
    }
    if (pbStale === 0) log.push('✅ PackBom: clean');

    // Also verify new SKUs exist
    const products = await fetchAll(db.Product, 'sku');
    const newSkus = new Set(Object.values(SKU_MAP).map(v => v.newSku));
    const foundNew = products.filter(p => newSkus.has(p.sku));
    log.push(`\nNew MWL SKUs found in Product: ${foundNew.length}/15`);
    foundNew.forEach(p => log.push(`  ${p.sku} → ${p.name} (variant: ${p.shopify_variant_id || 'none'})`));

    // Check stock levels are preserved (spot check)
    const soh = await fetchAll(db.StockOnHand, 'product_sku');
    const mwlSoh = soh.filter(s => newSkus.has(s.product_sku));
    log.push(`\nStockOnHand for MWL SKUs: ${mwlSoh.length} records`);
    mwlSoh.forEach(s => log.push(`  ${s.product_sku}: on_hand=${s.qty_on_hand} committed=${s.qty_committed} available=${s.qty_available}`));

    log.push(`\n=== VERIFICATION ${allClean ? 'PASSED ✅' : 'FAILED ❌ — run remaining steps'} ===`);
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  log.push(`Step ${step} ${dryRun ? '(dry run)' : ''} completed in ${elapsed}s`);

  return Response.json({
    status: errors.length > 0 ? 'completed_with_errors' : 'completed',
    step, dry_run: dryRun, elapsed_seconds: parseFloat(elapsed),
    errors, log,
  });
});