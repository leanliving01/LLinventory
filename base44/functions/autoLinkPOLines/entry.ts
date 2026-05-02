import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * Auto-links unmatched PurchaseOrderLine records to Products.
 * 
 * Strategy (in priority order):
 * 1. SupplierProduct match: For each PO line, check if the PO's supplier has a
 *    SupplierProduct with a matching xero_item_code or supplier_description.
 *    This gives product_id + supplier_product_id + purchase_uom in one shot.
 * 2. Product name fuzzy match: Fall back to fuzzy matching by description → product name.
 * 
 * When matched, sets: product_id, product_sku, supplier_product_id, purchase_uom
 * 
 * Params:
 *   dry_run (bool, default true)  — preview only, don't update
 *   threshold (number, default 0.45) — fuzzy match threshold
 *   batch_size (number, default 200) — max lines to update per run
 */

function normalize(str) {
  return (str || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\b(cooking\s*with|p\s*kg|per\s*kg|each|pack|refill|deli)\b/g, '')
    .replace(/\b\d+\s*x\s*\d+\s*(kg|g|l|ml)\b/g, '')
    .replace(/\b\d+\s*(kg|g|l|ml|mm)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenize(str) {
  return new Set(normalize(str).split(' ').filter(t => t.length > 1));
}

function jaccardScore(setA, setB) {
  if (setA.size === 0 && setB.size === 0) return 0;
  let intersection = 0;
  for (const t of setA) { if (setB.has(t)) intersection++; }
  const union = new Set([...setA, ...setB]).size;
  return union === 0 ? 0 : intersection / union;
}

function containsScore(lineNorm, productNorm) {
  if (!lineNorm || !productNorm) return 0;
  if (lineNorm.includes(productNorm)) return 0.85;
  if (productNorm.includes(lineNorm)) return 0.80;
  return 0;
}

function bestScore(lineName, productName) {
  const lineNorm = normalize(lineName);
  const prodNorm = normalize(productName);
  if (lineNorm === prodNorm) return 1.0;
  const jaccard = jaccardScore(tokenize(lineName), tokenize(productName));
  const contains = containsScore(lineNorm, prodNorm);
  return Math.max(jaccard, contains);
}

function isServiceLine(name) {
  const n = (name || '').toLowerCase();
  const patterns = ['shipping charge', 'subscription charge', 'admin debit', 'custom r&d',
    'procurement', 'manufacturing', 'delivery fee', 'surcharge', 'credit note', 'discount',
    'interest', 'penalty', 'freight', 'insurance'];
  if (n === '.' || n === '-' || n === '') return true;
  return patterns.some(p => n.includes(p));
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function withRetry(fn, maxRetries = 3) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const msg = (err.message || '').toLowerCase();
      if ((msg.includes('rate limit') || msg.includes('429')) && attempt < maxRetries) {
        console.log(`Rate limited, waiting ${attempt * 3}s...`);
        await sleep(attempt * 3000);
        continue;
      }
      throw err;
    }
  }
}

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me();
  if (!user || user.role !== 'admin') {
    return Response.json({ error: 'Admin access required' }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const dryRun = body.dry_run !== false;
  const threshold = body.threshold || 0.45;
  const batchSize = body.batch_size || 200;

  // 1. Load all active products (purchasable)
  let allProducts = [];
  let offset = 0;
  while (true) {
    const batch = await withRetry(() => base44.asServiceRole.entities.Product.filter(
      { status: 'active' }, 'name', 500, offset
    ));
    allProducts = allProducts.concat(batch);
    if (batch.length < 500) break;
    offset += 500;
  }

  // 2. Load all active SupplierProducts
  let allSPs = [];
  offset = 0;
  while (true) {
    const batch = await withRetry(() => base44.asServiceRole.entities.SupplierProduct.filter(
      { active: true }, 'product_name', 500, offset
    ));
    allSPs = allSPs.concat(batch);
    if (batch.length < 500) break;
    offset += 500;
  }

  // Build SupplierProduct lookup maps
  // By supplier_id → array of SPs
  const spBySupplier = {};
  for (const sp of allSPs) {
    const sid = sp.supplier_id;
    if (!spBySupplier[sid]) spBySupplier[sid] = [];
    spBySupplier[sid].push(sp);
  }
  // By xero_item_code (global)
  const spByItemCode = {};
  for (const sp of allSPs) {
    if (sp.xero_item_code) {
      spByItemCode[sp.xero_item_code.toLowerCase().trim()] = sp;
    }
  }

  // 3. Load POs to get supplier_id per PO
  let allPOs = [];
  offset = 0;
  while (true) {
    const batch = await withRetry(() => base44.asServiceRole.entities.PurchaseOrder.filter(
      {}, '-created_date', 500, offset
    ));
    allPOs = allPOs.concat(batch);
    if (batch.length < 500) break;
    offset += 500;
  }
  const poById = {};
  allPOs.forEach(po => { poById[po.id] = po; });

  // Product lookup by id
  const productById = {};
  allProducts.forEach(p => { productById[p.id] = p; });

  // 4. Load unmatched lines
  let unmatchedLines = [];
  offset = 0;
  while (true) {
    const batch = await withRetry(() => base44.asServiceRole.entities.PurchaseOrderLine.filter(
      { product_id: 'unmatched' }, '-created_date', 500, offset
    ));
    unmatchedLines = unmatchedLines.concat(batch);
    if (batch.length < 500) break;
    offset += 500;
  }

  // 5. Match functions

  // Try SupplierProduct match for a line
  function trySupplierProductMatch(line) {
    const po = poById[line.purchase_order_id];
    if (!po?.supplier_id) return null;

    const desc = (line.product_name || '').trim();
    const itemCode = (line.product_sku || '').trim();

    // A) Try xero_item_code exact match
    if (itemCode) {
      const sp = spByItemCode[itemCode.toLowerCase()];
      if (sp && sp.supplier_id === po.supplier_id) {
        const product = productById[sp.product_id];
        if (product) return { sp, product, matchType: 'item_code' };
      }
    }

    // B) Try supplier's SupplierProducts by description fuzzy
    const supplierSPs = spBySupplier[po.supplier_id] || [];
    if (supplierSPs.length === 0) return null;

    let bestSP = null;
    let bestSPScore = 0;
    for (const sp of supplierSPs) {
      // Try matching against supplier_description, product_name, product_sku, supplier_sku
      const candidates = [
        sp.supplier_description,
        sp.product_name,
        sp.purchase_uom_label ? `${sp.product_name} ${sp.purchase_uom_label}` : null,
      ].filter(Boolean);

      for (const c of candidates) {
        const score = bestScore(desc, c);
        if (score > bestSPScore) {
          bestSPScore = score;
          bestSP = sp;
        }
      }

      // Also try SKU match
      if (itemCode && sp.supplier_sku && itemCode.toLowerCase() === sp.supplier_sku.toLowerCase()) {
        const product = productById[sp.product_id];
        if (product) return { sp, product, matchType: 'supplier_sku' };
      }
    }

    if (bestSP && bestSPScore >= 0.5) {
      const product = productById[bestSP.product_id];
      if (product) return { sp: bestSP, product, matchType: 'sp_fuzzy', score: bestSPScore };
    }

    return null;
  }

  // Fuzzy match against product catalog
  const matchCache = {};
  function findProductMatch(description) {
    if (matchCache[description]) return matchCache[description];
    const scores = [];
    for (const product of allProducts) {
      const score = bestScore(description, product.name);
      if (score >= threshold) scores.push({ product, score });
    }
    scores.sort((a, b) => b.score - a.score);

    let result;
    if (scores.length === 0) {
      result = { product: null, score: 0, status: 'no_match', topMatches: [] };
    } else if (scores.length === 1) {
      result = { product: scores[0].product, score: scores[0].score, status: 'auto', topMatches: scores };
    } else if (scores[0].score >= 0.7 && scores[0].score - scores[1].score >= 0.15) {
      result = { product: scores[0].product, score: scores[0].score, status: 'auto', topMatches: scores.slice(0, 3) };
    } else if (scores[0].score >= 0.9) {
      // Very high score — accept even if close second
      result = { product: scores[0].product, score: scores[0].score, status: 'auto', topMatches: scores.slice(0, 3) };
    } else {
      result = { product: null, score: scores[0].score, status: 'ambiguous', topMatches: scores.slice(0, 5) };
    }
    matchCache[description] = result;
    return result;
  }

  // 6. Process lines
  let linked = 0, skippedService = 0, skippedAmbiguous = 0, skippedNoMatch = 0;
  let linkedViaSP = 0, linkedViaFuzzy = 0;
  const linkedDetails = [];
  const ambiguousList = [];
  const noMatchList = [];
  const seenAmbiguous = new Set();
  const seenNoMatch = new Set();

  for (const line of unmatchedLines) {
    const desc = (line.product_name || '').trim();
    if (!desc || isServiceLine(desc)) { skippedService++; continue; }

    // Strategy 1: SupplierProduct match
    const spMatch = trySupplierProductMatch(line);
    if (spMatch) {
      if (!dryRun && linked < batchSize) {
        const updateData = {
          product_id: spMatch.product.id,
          product_sku: spMatch.product.sku,
          supplier_product_id: spMatch.sp.id,
          purchase_uom: spMatch.sp.purchase_uom || line.uom,
        };
        await withRetry(() => base44.asServiceRole.entities.PurchaseOrderLine.update(line.id, updateData));
        await sleep(350);
      }
      linked++;
      linkedViaSP++;
      if (linkedDetails.length < 50) {
        linkedDetails.push({
          xero_desc: desc,
          matched_to: spMatch.product.name,
          sku: spMatch.product.sku,
          match_method: 'supplier_product_' + spMatch.matchType,
          score: spMatch.score ? Math.round(spMatch.score * 100) + '%' : '100%',
          purchase_uom: spMatch.sp.purchase_uom,
          conversion_factor: spMatch.sp.conversion_factor,
        });
      }
      continue;
    }

    // Strategy 2: Fuzzy product name match
    const match = findProductMatch(desc);
    if (match.status === 'auto' && match.product) {
      if (!dryRun && linked < batchSize) {
        await withRetry(() => base44.asServiceRole.entities.PurchaseOrderLine.update(line.id, {
          product_id: match.product.id,
          product_sku: match.product.sku,
        }));
        await sleep(350);
      }
      linked++;
      linkedViaFuzzy++;
      if (linkedDetails.length < 50) {
        linkedDetails.push({
          xero_desc: desc,
          matched_to: match.product.name,
          sku: match.product.sku,
          match_method: 'fuzzy_name',
          score: Math.round(match.score * 100) + '%',
          purchase_uom: null,
          conversion_factor: null,
        });
      }
    } else if (match.status === 'ambiguous') {
      skippedAmbiguous++;
      if (!seenAmbiguous.has(desc) && ambiguousList.length < 30) {
        seenAmbiguous.add(desc);
        ambiguousList.push({
          xero_desc: desc,
          candidates: match.topMatches.slice(0, 3).map(m => ({
            name: m.product.name, sku: m.product.sku, score: Math.round(m.score * 100) + '%',
          })),
        });
      }
    } else {
      skippedNoMatch++;
      if (!seenNoMatch.has(desc) && noMatchList.length < 30) {
        seenNoMatch.add(desc);
        noMatchList.push({ xero_desc: desc });
      }
    }
  }

  const actualUpdated = dryRun ? 0 : Math.min(linked, batchSize);
  console.log(`[AutoLink] ${dryRun ? 'DRY RUN' : 'LIVE'}: ${linked} linkable (${linkedViaSP} via SP, ${linkedViaFuzzy} via fuzzy), ${actualUpdated} updated, ${skippedAmbiguous} ambiguous, ${skippedNoMatch} no match, ${skippedService} service`);

  return Response.json({
    mode: dryRun ? 'dry_run' : 'live',
    summary: {
      total_unmatched: unmatchedLines.length,
      auto_linkable: linked,
      linked_via_supplier_product: linkedViaSP,
      linked_via_fuzzy: linkedViaFuzzy,
      actually_updated: actualUpdated,
      ambiguous_skipped: skippedAmbiguous,
      no_match_skipped: skippedNoMatch,
      service_lines_skipped: skippedService,
    },
    linked_preview: linkedDetails,
    ambiguous: ambiguousList,
    no_match: noMatchList,
  });
});