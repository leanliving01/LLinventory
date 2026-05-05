import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * Scans all active raw material products for potential duplicate clusters.
 * Groups products by normalised name similarity.
 * Returns clusters with 2+ products, ranked by BOM reference count.
 *
 * Payload: { type_filter?: string } — defaults to "raw" 
 */
Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me();
  if (!user || user.role !== 'admin') {
    return Response.json({ error: 'Admin access required' }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const typeFilter = body.type_filter || 'raw';

  // Load active products of the given type
  const products = await base44.asServiceRole.entities.Product.filter(
    { status: 'active', type: typeFilter }, 'name', 1000
  );

  // Load BOM data for reference counting
  const allBomComps = await base44.asServiceRole.entities.BomComponent.list('-created_date', 5000);
  const allBoms = await base44.asServiceRole.entities.Bom.list('-created_date', 1000);

  const bomCountFor = (pid) => {
    return allBomComps.filter(c => c.input_product_id === pid).length +
           allBoms.filter(b => b.product_id === pid).length;
  };

  // Normalise name for grouping — strip packaging info, UoM suffixes, supplier prefixes
  const normaliseName = (name) => {
    let n = name.toLowerCase().trim();
    // Remove common suffixes: quantities, weights, packaging descriptions
    n = n.replace(/\s*[-–]\s*(cooking with|bulk|fillet|frozen|fresh|iqf).*$/i, '');
    n = n.replace(/\s*\d+\s*(kg|g|ml|l|pcs|box|pack|bag|unit|item|x)\b.*$/i, '');
    n = n.replace(/\s*(box of|bag of|pack of|carton of)\s*\d+.*$/i, '');
    // Remove UoM qualifiers
    n = n.replace(/\b(bulk|fillet|diced|sliced|minced|ground|whole|trimmed|skinless|boneless)\b/gi, '');
    // Remove percentage patterns like "10 PCT", "10%"
    n = n.replace(/\d+\s*(%|pct)/gi, '');
    // Collapse whitespace
    n = n.replace(/\s+/g, ' ').trim();
    return n;
  };

  // Group products by normalised name
  const groups = {};
  for (const p of products) {
    const key = normaliseName(p.name);
    if (!groups[key]) groups[key] = [];
    groups[key].push(p);
  }

  // Filter to clusters with 2+ products
  const clusters = [];
  for (const [normName, group] of Object.entries(groups)) {
    if (group.length < 2) continue;

    // Sort by BOM reference count descending — canonical first
    const sorted = group.map(p => ({
      id: p.id,
      sku: p.sku,
      name: p.name,
      stock_uom: p.stock_uom,
      purchase_uom: p.purchase_uom || null,
      cost_avg: p.cost_avg || 0,
      supplier_id: p.supplier_id || null,
      supplier_sku: p.supplier_sku || null,
      bom_references: bomCountFor(p.id),
    })).sort((a, b) => b.bom_references - a.bom_references);

    clusters.push({
      normalised_name: normName,
      product_count: sorted.length,
      total_bom_references: sorted.reduce((s, p) => s + p.bom_references, 0),
      canonical: sorted[0],
      duplicates: sorted.slice(1),
      products: sorted,
    });
  }

  // Sort clusters by total BOM references descending (most impactful first)
  clusters.sort((a, b) => b.total_bom_references - a.total_bom_references);

  return Response.json({
    type_filter: typeFilter,
    total_products_scanned: products.length,
    duplicate_clusters_found: clusters.length,
    total_duplicates: clusters.reduce((s, c) => s + c.duplicates.length, 0),
    clusters,
  });
});