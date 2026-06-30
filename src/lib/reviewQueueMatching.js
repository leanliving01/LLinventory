/**
 * Possible-duplicate detection for the Product Review Queue.
 *
 * When a line comes in from a supplier invoice / scanned PDF it should be matched
 * against existing inventory using MORE than the product name — because the
 * supplier SKU / item code is the strongest identifier and names vary wildly
 * between suppliers. This module scores candidates across several fields:
 *
 *   1. supplier SKU / item code  ↔  supplier_products.supplier_sku / xero_item_code
 *   2. item code                 ↔  product.sku
 *   3. description (tokens)       ↔  supplier_products.supplier_description, product.name
 *
 * It returns a ranked list of { product, supplierProduct, score, reasons } so the
 * UI can surface "possible match" hints and pre-select the best candidate.
 */

const norm = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

// Light singular/plural stem so "lemons" ↔ "lemon", "boxes" ↔ "box" match. Keeps
// short words intact; only trims common English plural endings.
const stem = (t) => {
  if (t.length > 4 && t.endsWith('ies')) return `${t.slice(0, -3)}y`;
  if (t.length > 4 && (t.endsWith('ses') || t.endsWith('xes') || t.endsWith('zes'))) return t.slice(0, -2);
  if (t.length > 3 && t.endsWith('s') && !t.endsWith('ss')) return t.slice(0, -1);
  return t;
};
// Drop pack/size tokens so "CORIANDER 30g" and "CORIANDER 100g" tokenise the same.
// Anything starting with a digit ("30g", "10kg", "350", "5l") is a size, not an
// identifier; bare unit words ("kg", "ml") are already removed by the length filter.
const isPackToken = (t) => /^\d/.test(t);
// Supplier-branding / packaging filler that carries no product identity — Bidfood's
// "COOKING WITH", Bell Ceres' "DELI", "1000 OFF", "LOOSE", "SALES", etc. Dropping
// these stops noise words from creating false matches AND false duplicate-ties.
const STOPWORDS = new Set([
  'deli', 'off', 'cooking', 'with', 'loose', 'sales', 'sale', 'per', 'pkg', 'the',
  'and', 'for', 'from', 'plus', 'new', 'fresh', 'each', 'pack', 'packet',
]);
const tokenize = (s) =>
  (s || '').toLowerCase().split(/[^a-z0-9]+/)
    .filter((t) => t.length > 2 && !isPackToken(t))
    .map(stem)
    .filter((t) => !STOPWORDS.has(t));

// A pack-size-insensitive signature: the significant words, stemmed, sorted, joined.
// Two descriptions that differ ONLY by pack size collapse to the same signature.
const packlessSig = (s) => tokenize(s).slice().sort().join('|');

// Every wording an existing supplier_product is known by — the stored description,
// the product name, and every past invoice wording remembered in known_descriptions.
const candidateTexts = (sp) => {
  const out = [];
  if (sp?.supplier_description) out.push(sp.supplier_description);
  if (sp?.product_name) out.push(sp.product_name);
  for (const d of sp?.known_descriptions || []) if (d) out.push(d);
  return out;
};

// Minimum shared significant tokens for a contained-match to fire. Two keeps
// single-word collisions (a stray "Butternut" landing on "Butternut Dice
// Halfmoon") from auto-resolving while still catching real wording drift.
const CONTAIN_MIN_SHARED = 2;

/**
 * Contained-match score between two descriptions, 0 when they don't qualify.
 *
 * Tokenises both (dropping units/short words), then requires that EVERY
 * significant token of the shorter side appears in the longer side, sharing at
 * least CONTAIN_MIN_SHARED tokens. This tolerates wording that gains or loses a
 * word between invoices (e.g. a trailing "HALFMOON") without collapsing two
 * genuinely different items — "…DICE…" and "…WHOLE…" each carry a distinct token,
 * so neither is contained in the other. Score = shared-token count (more shared
 * tokens = a more specific, preferred match).
 */
function containedScore(aText, bText) {
  const a = new Set(tokenize(aText));
  const b = new Set(tokenize(bText));
  if (!a.size || !b.size) return 0;
  const [small, big] = a.size <= b.size ? [a, b] : [b, a];
  let shared = 0;
  for (const t of small) if (big.has(t)) shared++;
  if (shared < CONTAIN_MIN_SHARED || shared !== small.size) return 0;
  return shared;
}

/**
 * Decide whether an invoice line is ALREADY linked to a product for this supplier.
 *
 * A line counts as already-linked when, for the SAME supplier, it matches an
 * existing supplier_product by (in priority order):
 *   1. supplier SKU / item code   — exact, normalised
 *   2. description                 — exact, normalised
 *   3. description contained-match — tolerant of wording drift (see containedScore)
 *
 * These lines are auto-resolved and never shown in the queue — the product is
 * already known for this supplier, so there's nothing to review. The fuzzy tier
 * is supplier-scoped (it only ever compares against products already confirmed
 * for THIS supplier) and picks a single clear winner; an ambiguous tie between
 * two different products is left for manual review rather than guessed.
 *
 * @param {object} line                 PurchaseInvoiceLine ({ xero_item_code, xero_description })
 * @param {object[]} supplierProducts   supplier_products for THIS supplier
 * @returns {object|null} the matching supplier_product, or null
 */
export function findExistingLink(line, supplierProducts = []) {
  const sku = norm(line?.xero_item_code);
  const desc = norm(line?.xero_description);
  const descRaw = line?.xero_description || '';
  const sig = packlessSig(descRaw);
  if (!sku && !descRaw) return null;

  // 1 — exact SKU / item code (strongest identifier).
  if (sku) {
    for (const sp of supplierProducts) {
      if (norm(sp.supplier_sku) === sku || norm(sp.xero_item_code) === sku) return sp;
    }
  }
  // 2 — exact description against ANY remembered wording (normalised).
  if (desc) {
    for (const sp of supplierProducts) {
      if (candidateTexts(sp).some((t) => norm(t) === desc)) return sp;
    }
  }
  // 2b — pack-size-insensitive exact: same words, only the size differs
  //      ("CORIANDER 30g" ↔ "CORIANDER 100g"). Single clear winner only.
  if (sig) {
    let hit = null, ambiguous = false;
    for (const sp of supplierProducts) {
      if (candidateTexts(sp).some((t) => packlessSig(t) === sig)) {
        if (hit && sp.product_id !== hit.product_id) ambiguous = true;
        else hit = sp;
      }
    }
    if (hit && !ambiguous) return hit;
  }
  // 3 — contained-match on description (tolerant of added/dropped words); pick the
  //     single best-scoring supplier product; bail on an ambiguous tie.
  if (descRaw) {
    let best = null, bestScore = 0, tie = false;
    for (const sp of supplierProducts) {
      let score = 0;
      for (const t of candidateTexts(sp)) score = Math.max(score, containedScore(descRaw, t));
      if (score > bestScore) { best = sp; bestScore = score; tie = false; }
      else if (score === bestScore && score > 0 && best && sp.product_id !== best.product_id) { tie = true; }
    }
    if (best && bestScore > 0 && !tie) return best;
  }
  return null;
}

/** Jaccard-ish token overlap, 0..1. */
function tokenOverlap(a, b) {
  const setA = new Set(tokenize(a));
  const listB = tokenize(b);
  if (!setA.size || !listB.length) return 0;
  const hits = listB.filter((t) => setA.has(t)).length;
  return hits / Math.max(setA.size, listB.length);
}

/**
 * @param {object} lineGroup   review-queue group (uses representativeLine)
 * @param {object} opts
 * @param {object[]} opts.products            full catalogue
 * @param {object[]} opts.supplierProducts    supplier products for THIS supplier
 * @param {number}  [opts.limit=5]
 * @returns {{product:object, supplierProduct:object|null, score:number, reasons:string[]}[]}
 */
export function findPossibleMatches(lineGroup, { products = [], supplierProducts = [], limit = 5 } = {}) {
  const line = lineGroup?.representativeLine || {};
  const code = norm(line.xero_item_code);
  const desc = line.xero_description || '';

  const productById = new Map(products.map((p) => [p.id, p]));
  const candidates = new Map(); // productId -> candidate

  const add = (product, supplierProduct, score, reason) => {
    if (!product) return;
    const prev = candidates.get(product.id);
    if (!prev) {
      candidates.set(product.id, { product, supplierProduct: supplierProduct || null, score, reasons: [reason] });
    } else {
      prev.score = Math.max(prev.score, score);
      if (!prev.supplierProduct && supplierProduct) prev.supplierProduct = supplierProduct;
      if (reason && !prev.reasons.includes(reason)) prev.reasons.push(reason);
    }
  };

  // 1 & 2 — match the supplier item code against supplier products + catalogue SKUs.
  if (code) {
    for (const sp of supplierProducts) {
      if (norm(sp.supplier_sku) === code || norm(sp.xero_item_code) === code) {
        add(productById.get(sp.product_id), sp, 1, 'Supplier SKU / item code matches');
      }
    }
    for (const p of products) {
      if (norm(p.sku) === code) add(p, null, 0.95, 'Internal SKU matches the item code');
    }
  }

  // 3 — description / name similarity (best of every remembered wording).
  if (desc) {
    for (const sp of supplierProducts) {
      let ov = 0;
      for (const t of candidateTexts(sp)) ov = Math.max(ov, tokenOverlap(desc, t));
      if (ov >= 0.5) add(productById.get(sp.product_id), sp, 0.5 + ov * 0.4, 'Description matches a supplier product');
    }
    for (const p of products) {
      const ov = tokenOverlap(desc, p.name);
      if (ov >= 0.5) add(p, null, 0.4 + ov * 0.4, 'Description matches a product name');
    }
  }

  return Array.from(candidates.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}
