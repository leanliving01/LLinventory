import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * Finds active, purchasable products that have NO purchase UoM defined —
 * neither a ProductPurchaseUom record, nor the legacy purchase_uom field,
 * nor a linked SupplierProduct.
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (user?.role !== 'admin') {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Fetch all active products
    const allProducts = await base44.asServiceRole.entities.Product.filter(
      { status: 'active' }, 'sku', 2000
    );

    // Only purchasable ones
    const purchasable = allProducts.filter(p => p.purchasable !== false);

    // Fetch all ProductPurchaseUom records
    const allUoms = await base44.asServiceRole.entities.ProductPurchaseUom.list('product_id', 5000);
    const uomProductIds = new Set(allUoms.map(u => u.product_id));

    // Fetch all SupplierProduct records
    const allSP = await base44.asServiceRole.entities.SupplierProduct.filter({ active: true }, 'product_id', 5000);
    const spProductIds = new Set(allSP.map(sp => sp.product_id));

    // Find products with NO coverage at all
    const missing = purchasable.filter(p => {
      const hasNewUom = uomProductIds.has(p.id);
      const hasLegacy = p.purchase_uom && p.purchase_uom.trim() !== '';
      const hasSupplierProduct = spProductIds.has(p.id);
      return !hasNewUom && !hasLegacy && !hasSupplierProduct;
    });

    // Group by type for readability
    const byType = {};
    for (const p of missing) {
      const t = p.type || 'unknown';
      if (!byType[t]) byType[t] = [];
      byType[t].push({ name: p.name, sku: p.sku, stock_uom: p.stock_uom, category: p.category || '' });
    }

    return Response.json({
      total_purchasable: purchasable.length,
      with_new_uom: uomProductIds.size,
      with_legacy_uom: purchasable.filter(p => p.purchase_uom && p.purchase_uom.trim() !== '').length,
      with_supplier_product: spProductIds.size,
      missing_any_uom: missing.length,
      missing_by_type: byType,
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});