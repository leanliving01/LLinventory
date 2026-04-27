import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * Test function: attempts to fuzzy-match unmatched PO lines to Products.
 * Does NOT update anything — just returns match results for review.
 * 
 * Logic:
 * 1. Load all unmatched PO lines (product_id = "unmatched" or empty)
 * 2. Load all active purchasable products
 * 3. For each unmatched line, normalize the description and compare against product names
 * 4. Score matches using token overlap (Jaccard similarity)
 * 5. If exactly ONE product scores above threshold → "auto_match"
 *    If multiple products score above threshold → "ambiguous" (needs manual)
 *    If none score above threshold → "no_match"
 */

function normalize(str) {
  return (str || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')   // strip punctuation
    .replace(/\b(cooking\s*with|p\s*kg|per\s*kg|each|pack|refill)\b/g, '')  // remove common noise
    .replace(/\b\d+\s*x\s*\d+\s*(kg|g|l|ml)\b/g, '')  // remove pack specs like "10x1kg"
    .replace(/\b\d+\s*(kg|g|l|ml|mm)\b/g, '')  // remove weight specs like "1kg", "5l"
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

// Check if one string contains the other after normalization
function containsScore(lineNorm, productNorm) {
  if (!lineNorm || !productNorm) return 0;
  if (lineNorm.includes(productNorm)) return 0.85;
  if (productNorm.includes(lineNorm)) return 0.80;
  return 0;
}

function bestScore(lineName, productName) {
  const lineNorm = normalize(lineName);
  const prodNorm = normalize(productName);
  
  // Exact normalized match
  if (lineNorm === prodNorm) return 1.0;
  
  const jaccard = jaccardScore(tokenize(lineName), tokenize(productName));
  const contains = containsScore(lineNorm, prodNorm);
  
  return Math.max(jaccard, contains);
}

// Filter out non-inventory line descriptions (services, admin fees, shipping, etc.)
function isServiceLine(name) {
  const n = (name || '').toLowerCase();
  if (n.includes('shipping charge')) return true;
  if (n.includes('subscription charge')) return true;
  if (n.includes('admin debit')) return true;
  if (n.includes('custom r&d')) return true;
  if (n.includes('procurement')) return true;
  if (n.includes('manufacturing')) return true;
  if (n.includes('delivery')) return true;
  if (n.includes('surcharge')) return true;
  return false;
}

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me();
  if (!user || user.role !== 'admin') {
    return Response.json({ error: 'Admin access required' }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const threshold = body.threshold || 0.45;
  const maxLines = body.max_lines || 100;

  // 1. Load all active purchasable products
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
  console.log(`Loaded ${allProducts.length} purchasable products`);

  // 2. Load unmatched PO lines
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
  console.log(`Found ${unmatchedLines.length} unmatched PO lines`);

  // 3. Deduplicate by product_name (many lines have the same description)
  const uniqueNames = {};
  for (const line of unmatchedLines) {
    const name = (line.product_name || '').trim();
    if (!name) continue;
    if (isServiceLine(name)) continue;
    if (!uniqueNames[name]) {
      uniqueNames[name] = { count: 0, sample_line_id: line.id, sample_po_id: line.purchase_order_id };
    }
    uniqueNames[name].count++;
  }

  const descriptions = Object.keys(uniqueNames).slice(0, maxLines);
  console.log(`Testing ${descriptions.length} unique descriptions (out of ${Object.keys(uniqueNames).length})`);

  // 4. Match each description against all products
  const results = {
    auto_match: [],    // exactly 1 product above threshold
    ambiguous: [],     // multiple products above threshold
    no_match: [],      // nothing above threshold
    service_lines: unmatchedLines.filter(l => isServiceLine(l.product_name)).length,
    total_unmatched: unmatchedLines.length,
    unique_descriptions: Object.keys(uniqueNames).length,
  };

  for (const desc of descriptions) {
    const scores = [];
    for (const product of allProducts) {
      const score = bestScore(desc, product.name);
      if (score >= threshold) {
        scores.push({
          product_id: product.id,
          product_name: product.name,
          product_sku: product.sku,
          purchase_uom: product.purchase_uom || null,
          purchase_to_stock_factor: product.purchase_to_stock_factor || null,
          stock_uom: product.stock_uom,
          score: Math.round(score * 100) / 100,
        });
      }
    }
    scores.sort((a, b) => b.score - a.score);

    const entry = {
      xero_description: desc,
      line_count: uniqueNames[desc].count,
      matches: scores.slice(0, 5),  // top 5 matches
    };

    if (scores.length === 1) {
      results.auto_match.push(entry);
    } else if (scores.length > 1) {
      // If top score is significantly better than second, still auto-match
      if (scores[0].score >= 0.7 && scores[0].score - scores[1].score >= 0.15) {
        results.auto_match.push(entry);
      } else {
        results.ambiguous.push(entry);
      }
    } else {
      results.no_match.push(entry);
    }
  }

  console.log(`Results: ${results.auto_match.length} auto, ${results.ambiguous.length} ambiguous, ${results.no_match.length} no match`);

  return Response.json({
    summary: {
      total_unmatched_lines: results.total_unmatched,
      unique_descriptions: results.unique_descriptions,
      service_lines_excluded: results.service_lines,
      auto_matchable: results.auto_match.length,
      ambiguous_needs_manual: results.ambiguous.length,
      no_match: results.no_match.length,
      threshold_used: threshold,
    },
    auto_match: results.auto_match.slice(0, 30),
    ambiguous: results.ambiguous.slice(0, 20),
    no_match: results.no_match.slice(0, 20),
  });
});