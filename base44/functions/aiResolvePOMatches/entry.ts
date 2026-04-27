import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * Uses AI to resolve ambiguous PO line ↔ Product matches.
 * 
 * 1. Loads the full ambiguous list from the matching engine
 * 2. Sends them to an LLM with food-industry context
 * 3. For high-confidence AI picks → auto-links (if dry_run=false)
 * 4. Returns only the truly uncertain ones for manual review
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
  for (const t of setA) if (setB.has(t)) intersection++;
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
  return Math.max(jaccardScore(tokenize(lineName), tokenize(productName)), containsScore(lineNorm, prodNorm));
}

function isServiceLine(name) {
  const n = (name || '').toLowerCase();
  const patterns = ['shipping charge', 'subscription charge', 'admin debit', 'custom r&d',
    'procurement', 'manufacturing', 'delivery', 'surcharge', 'credit note', 'discount',
    'interest', 'penalty', 'freight', 'insurance'];
  return patterns.some(p => n.includes(p));
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function withRetry(fn, maxRetries = 3) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try { return await fn(); }
    catch (err) {
      const msg = (err.message || '').toLowerCase();
      if ((msg.includes('rate limit') || msg.includes('429')) && attempt < maxRetries) {
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
  const dryRun = body.dry_run !== false; // default true
  const threshold = 0.45;

  // 1. Load products
  let allProducts = [];
  let offset = 0;
  while (true) {
    const batch = await withRetry(() => base44.asServiceRole.entities.Product.filter(
      { status: 'active', purchasable: true }, 'name', 500, offset
    ));
    allProducts = allProducts.concat(batch);
    if (batch.length < 500) break;
    offset += 500;
  }

  // 2. Load unmatched lines
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

  // 3. Find ambiguous matches (same logic as autoLinkPOLines)
  const matchCache = {};
  function findMatch(description) {
    if (matchCache[description]) return matchCache[description];
    const scores = [];
    for (const product of allProducts) {
      const score = bestScore(description, product.name);
      if (score >= threshold) scores.push({ product, score });
    }
    scores.sort((a, b) => b.score - a.score);
    let result;
    if (scores.length === 0) {
      result = { status: 'no_match', topMatches: [] };
    } else if (scores.length === 1) {
      result = { status: 'auto', product: scores[0].product, topMatches: scores };
    } else if (scores[0].score >= 0.7 && scores[0].score - scores[1].score >= 0.15) {
      result = { status: 'auto', product: scores[0].product, topMatches: scores.slice(0, 3) };
    } else {
      result = { status: 'ambiguous', topMatches: scores.slice(0, 5) };
    }
    matchCache[description] = result;
    return result;
  }

  // Collect unique ambiguous descriptions and the lines they apply to
  const ambiguousMap = {}; // description → { lineIds: [], candidates: [] }
  for (const line of unmatchedLines) {
    const desc = (line.product_name || '').trim();
    if (!desc || isServiceLine(desc)) continue;
    const match = findMatch(desc);
    if (match.status !== 'ambiguous') continue;
    if (!ambiguousMap[desc]) {
      ambiguousMap[desc] = {
        lineIds: [],
        candidates: match.topMatches.slice(0, 5).map(m => ({
          id: m.product.id,
          name: m.product.name,
          sku: m.product.sku,
          score: Math.round(m.score * 100),
        })),
      };
    }
    ambiguousMap[desc].lineIds.push(line.id);
  }

  const ambiguousDescriptions = Object.keys(ambiguousMap);
  console.log(`Found ${ambiguousDescriptions.length} unique ambiguous descriptions covering ${Object.values(ambiguousMap).reduce((s, v) => s + v.lineIds.length, 0)} lines`);

  // 4. Send to LLM in chunks (to stay within token limits)
  const CHUNK_SIZE = 30;
  const allDecisions = [];

  for (let i = 0; i < ambiguousDescriptions.length; i += CHUNK_SIZE) {
    const chunk = ambiguousDescriptions.slice(i, i + CHUNK_SIZE);
    const items = chunk.map((desc, idx) => ({
      index: i + idx,
      xero_description: desc,
      candidates: ambiguousMap[desc].candidates.map(c => ({
        sku: c.sku,
        name: c.name,
        score: c.score,
      })),
    }));

    const prompt = `You are a food-industry inventory expert working for a South African meal-prep company called Lean Living.

I have purchase order line descriptions from Xero that need to be matched to the correct product in our system. Each item has multiple candidate products and I need you to pick the RIGHT one, or say "uncertain" if you genuinely cannot tell.

RULES:
- "DELI" in the Xero description means pre-prepared/deli-cut fresh produce — match to the vegetable, not to unrelated items.
- "p/kg" or "P/KG" means "per kilogram" — it's a pricing note, not a product name.
- "COOKING WITH" is a brand name — ignore it for matching purposes.
- Size variants (e.g. 3KG vs 6.25KG, 1LT vs 5LT) of the SAME product should match to the same product.
- If two candidates have the same name but different SKUs, pick the one whose SKU does NOT end in "UOM00" (those are usually duplicate/variant entries). If only UOM00 exists, pick it.
- "Halfmoon Slice" or "DICE" are cut types for vegetables — still match to the base vegetable.
- When there's a clear semantic match (e.g. "BUTTERNUT DICE" → "Butternut" not "Butter"), pick it even if scores are tied.
- When a Xero description includes a brand and size that exactly matches one candidate, prefer that exact match.

For each item, respond with ONLY a JSON array. Each element: {"index": <number>, "pick_sku": "<sku>" or null, "confidence": "high"|"medium"|"low", "reason": "<brief reason>"}.
Set pick_sku to null and confidence to "low" only if you genuinely cannot determine the correct match.

Items to resolve:
${JSON.stringify(items, null, 2)}`;

    const llmResult = await withRetry(() => base44.asServiceRole.integrations.Core.InvokeLLM({
      prompt,
      response_json_schema: {
        type: "object",
        properties: {
          decisions: {
            type: "array",
            items: {
              type: "object",
              properties: {
                index: { type: "number" },
                pick_sku: { type: "string" },
                confidence: { type: "string" },
                reason: { type: "string" },
              },
            },
          },
        },
      },
    }));

    const decisions = llmResult.decisions || [];
    allDecisions.push(...decisions);
    console.log(`LLM chunk ${Math.floor(i / CHUNK_SIZE) + 1}: ${decisions.length} decisions`);
    
    if (i + CHUNK_SIZE < ambiguousDescriptions.length) await sleep(1000);
  }

  // 5. Process decisions
  const autoResolved = [];  // AI is confident → will link
  const needsReview = [];   // AI is uncertain → manual
  let linesLinked = 0;

  for (const decision of allDecisions) {
    const desc = ambiguousDescriptions[decision.index];
    if (!desc) continue;
    const entry = ambiguousMap[desc];
    if (!entry) continue;

    if (decision.pick_sku && decision.confidence !== 'low') {
      const matchedCandidate = entry.candidates.find(c => c.sku === decision.pick_sku);
      if (matchedCandidate) {
        autoResolved.push({
          xero_desc: desc,
          picked: matchedCandidate.name,
          picked_sku: matchedCandidate.sku,
          confidence: decision.confidence,
          reason: decision.reason,
          line_count: entry.lineIds.length,
        });

        // Actually link the lines if not dry run (batch limit to avoid timeout)
        if (!dryRun && linesLinked < 40) {
          for (const lineId of entry.lineIds) {
            if (linesLinked >= 40) break;
            await withRetry(() => base44.asServiceRole.entities.PurchaseOrderLine.update(lineId, {
              product_id: matchedCandidate.id,
              product_sku: matchedCandidate.sku,
            }));
            linesLinked++;
            await sleep(300);
          }
        }
        continue;
      }
    }

    // Uncertain or sku not found in candidates
    needsReview.push({
      xero_desc: desc,
      candidates: entry.candidates,
      ai_reason: decision.reason || 'Could not determine',
      line_count: entry.lineIds.length,
    });
  }

  // Also add any descriptions not covered by LLM decisions
  for (let i = 0; i < ambiguousDescriptions.length; i++) {
    const desc = ambiguousDescriptions[i];
    const covered = allDecisions.some(d => d.index === i);
    if (!covered) {
      needsReview.push({
        xero_desc: desc,
        candidates: ambiguousMap[desc].candidates,
        ai_reason: 'Not evaluated by AI',
        line_count: ambiguousMap[desc].lineIds.length,
      });
    }
  }

  console.log(`AI resolved: ${autoResolved.length}, needs review: ${needsReview.length}, lines linked: ${linesLinked}`);

  return Response.json({
    mode: dryRun ? 'dry_run' : 'live',
    summary: {
      total_ambiguous_descriptions: ambiguousDescriptions.length,
      ai_resolved: autoResolved.length,
      needs_manual_review: needsReview.length,
      lines_auto_linked: dryRun ? 0 : linesLinked,
      lines_would_link: autoResolved.reduce((s, r) => s + r.line_count, 0),
    },
    auto_resolved: autoResolved,
    needs_review: needsReview,
  });
});