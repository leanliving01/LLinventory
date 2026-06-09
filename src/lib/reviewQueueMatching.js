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

const tokenize = (s) =>
  (s || '').toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 2);

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

  // 3 — description / name similarity (supplier description first, then product name).
  if (desc) {
    for (const sp of supplierProducts) {
      const ov = tokenOverlap(desc, sp.supplier_description || sp.product_name);
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
