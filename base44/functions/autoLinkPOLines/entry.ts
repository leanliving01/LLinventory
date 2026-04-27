import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * Auto-links unmatched PurchaseOrderLine records to Products using fuzzy name matching.
 * 
 * Rules:
 * - If exactly ONE product scores above threshold → auto-link
 * - If top match is significantly better than second → auto-link
 * - Otherwise → skip (needs manual resolution)
 * - Service lines (admin fees, shipping, subscriptions) are skipped
 * 
 * Params:
 *   dry_run (bool, default true)  — preview only, don't update
 *   threshold (number, default 0.45)
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
  for (const t of setA) {
    if (setB.has(t)) intersection++;
  }
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
    'procurement', 'manufacturing', 'delivery', 'surcharge', 'credit note', 'discount',
    'interest', 'penalty', 'freight', 'insurance'];
  return patterns.some(p => n.includes(p));
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me();
  if (!user || user.role !== 'admin') {
    return Response.json({ error: 'Admin access required' }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const dryRun = body.dry_run !== false;  // default true
  const threshold = body.threshold || 0.45;
  const batchSize = body.batch_size || 200;

  // 1. Load products
  let allProducts = [];
  let offset = 0;
  while (true) {
    const batch = await base44.asServiceRole.entities.Product.filter(
      { status: 'active', purchasable: true }, 'name', 500, offset
    );
    allProducts = allProducts.concat(batch);
    if (batch.length < 500) break;
    offset += 500;
  }

  // 2. Load unmatched lines
  let unmatchedLines = [];
  offset = 0;
  while (true) {
    const batch = await base44.asServiceRole.entities.PurchaseOrderLine.filter(
      { product_id: 'unmatched' }, '-created_date', 500, offset
    );
    unmatchedLines = unmatchedLines.concat(batch);
    if (batch.length < 500) break;
    offset += 500;
  }

  // 3. Build match index: description → best product
  const matchCache = {};  // description → { product, score, isAuto }

  function findMatch(description) {
    if (matchCache[description]) return matchCache[description];

    const scores = [];
    for (const product of allProducts) {
      const score = bestScore(description, product.name);
      if (score >= threshold) {
        scores.push({ product, score });
      }
    }
    scores.sort((a, b) => b.score - a.score);

    let result;
    if (scores.length === 0) {
      result = { product: null, score: 0, status: 'no_match', topMatches: [] };
    } else if (scores.length === 1) {
      result = { product: scores[0].product, score: scores[0].score, status: 'auto', topMatches: scores };
    } else if (scores[0].score >= 0.7 && scores[0].score - scores[1].score >= 0.15) {
      result = { product: scores[0].product, score: scores[0].score, status: 'auto', topMatches: scores.slice(0, 3) };
    } else {
      result = { product: null, score: scores[0].score, status: 'ambiguous', topMatches: scores.slice(0, 5) };
    }
    matchCache[description] = result;
    return result;
  }

  // 4. Process lines
  let linked = 0, skippedService = 0, skippedAmbiguous = 0, skippedNoMatch = 0;
  const linkedDetails = [];
  const ambiguousList = [];
  const noMatchList = [];
  const seenAmbiguous = new Set();
  const seenNoMatch = new Set();

  for (const line of unmatchedLines) {
    const desc = (line.product_name || '').trim();
    if (!desc || isServiceLine(desc)) { skippedService++; continue; }

    const match = findMatch(desc);

    if (match.status === 'auto' && match.product) {
      if (!dryRun && linked < batchSize) {
        await base44.asServiceRole.entities.PurchaseOrderLine.update(line.id, {
          product_id: match.product.id,
          product_sku: match.product.sku,
        });
        await sleep(50);
      }
      linked++;
      if (linkedDetails.length < 50) {
        linkedDetails.push({
          xero_desc: desc,
          matched_to: match.product.name,
          sku: match.product.sku,
          score: Math.round(match.score * 100) + '%',
          has_purchase_uom: !!match.product.purchase_uom,
          purchase_factor: match.product.purchase_to_stock_factor,
        });
      }
    } else if (match.status === 'ambiguous') {
      skippedAmbiguous++;
      if (!seenAmbiguous.has(desc)) {
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
      if (!seenNoMatch.has(desc)) {
        seenNoMatch.add(desc);
        noMatchList.push({ xero_desc: desc });
      }
    }
  }

  const actualUpdated = dryRun ? 0 : Math.min(linked, batchSize);

  console.log(`[AutoLink] ${dryRun ? 'DRY RUN' : 'LIVE'}: ${linked} linkable, ${actualUpdated} updated, ${skippedAmbiguous} ambiguous, ${skippedNoMatch} no match, ${skippedService} service`);

  return Response.json({
    mode: dryRun ? 'dry_run' : 'live',
    summary: {
      total_unmatched: unmatchedLines.length,
      auto_linkable: linked,
      actually_updated: actualUpdated,
      ambiguous_skipped: skippedAmbiguous,
      no_match_skipped: skippedNoMatch,
      service_lines_skipped: skippedService,
    },
    linked_preview: linkedDetails,
    ambiguous: ambiguousList.slice(0, 30),
    no_match: noMatchList.slice(0, 30),
  });
});