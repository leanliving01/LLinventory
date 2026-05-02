import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * Reads all SupplierProduct records and creates matching ProductPurchaseUom records
 * for any Product that doesn't already have purchase UoMs defined.
 *
 * Options (via payload):
 *  - dry_run: boolean (default false) — preview without creating
 *  - force: boolean (default false) — create even if product already has purchase UoMs
 *  - product_id: string — only process a single product
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (user?.role !== 'admin') {
      return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    const dryRun = body.dry_run === true;
    const force = body.force === true;
    const singleProductId = body.product_id || null;

    // Fetch all supplier products (active ones)
    let supplierProducts = await base44.asServiceRole.entities.SupplierProduct.filter({ active: true }, 'product_id', 2000);
    if (singleProductId) {
      supplierProducts = supplierProducts.filter(sp => sp.product_id === singleProductId);
    }

    if (supplierProducts.length === 0) {
      return Response.json({ status: 'no_supplier_products', created: 0 });
    }

    // Fetch existing ProductPurchaseUom records to avoid duplicates
    const existingUoms = await base44.asServiceRole.entities.ProductPurchaseUom.list('product_id', 5000);

    // Group existing UoMs by product_id
    const existingByProduct = {};
    for (const u of existingUoms) {
      if (!existingByProduct[u.product_id]) existingByProduct[u.product_id] = [];
      existingByProduct[u.product_id].push(u);
    }

    // Fetch products for stock_uom reference
    const productIds = [...new Set(supplierProducts.map(sp => sp.product_id))];
    const allProducts = await base44.asServiceRole.entities.Product.list('sku', 2000);
    const productMap = {};
    for (const p of allProducts) productMap[p.id] = p;

    const toCreate = [];
    const skipped = [];

    for (const sp of supplierProducts) {
      const product = productMap[sp.product_id];
      if (!product) {
        skipped.push({ sp_id: sp.id, reason: 'product_not_found', product_id: sp.product_id });
        continue;
      }

      // Skip if product already has purchase UoMs (unless force)
      const existing = existingByProduct[sp.product_id] || [];
      if (!force && existing.length > 0) {
        // Check if this specific supplier+label combo already exists
        const alreadyExists = existing.some(e =>
          e.supplier_id === sp.supplier_id &&
          (e.label === sp.purchase_uom_label || e.label === sp.purchase_uom)
        );
        if (alreadyExists) {
          skipped.push({ sp_id: sp.id, reason: 'already_exists', product_name: product.name });
          continue;
        }
      }

      // Build label from SupplierProduct data
      const label = sp.purchase_uom_label || sp.purchase_uom || 'Each';
      const factor = sp.conversion_factor || 1;

      toCreate.push({
        product_id: sp.product_id,
        label,
        purchase_to_stock_factor: factor,
        supplier_id: sp.supplier_id || '',
        supplier_name: sp.supplier_name || '',
        is_default: sp.is_default_supplier || false,
        notes: sp.notes || '',
        _meta: { product_name: product.name, product_sku: product.sku, sp_id: sp.id }
      });
    }

    if (dryRun) {
      return Response.json({
        status: 'dry_run',
        would_create: toCreate.length,
        skipped: skipped.length,
        preview: toCreate.slice(0, 20).map(r => ({
          product: r._meta.product_name,
          sku: r._meta.product_sku,
          label: r.label,
          factor: r.purchase_to_stock_factor,
          supplier: r.supplier_name,
        })),
        skipped_details: skipped.slice(0, 10),
      });
    }

    // Create records in batches of 20
    let created = 0;
    const errors = [];
    for (let i = 0; i < toCreate.length; i += 20) {
      const batch = toCreate.slice(i, i + 20);
      const cleanBatch = batch.map(({ _meta, ...rest }) => rest);
      try {
        await base44.asServiceRole.entities.ProductPurchaseUom.bulkCreate(cleanBatch);
        created += cleanBatch.length;
      } catch (err) {
        // Fall back to individual creates
        for (const record of cleanBatch) {
          try {
            await base44.asServiceRole.entities.ProductPurchaseUom.create(record);
            created++;
          } catch (e2) {
            errors.push({ product_id: record.product_id, label: record.label, error: e2.message });
          }
        }
      }
    }

    // Audit log
    try {
      await base44.asServiceRole.entities.AuditLog.create({
        action: 'import',
        entity_type: 'ProductPurchaseUom',
        description: `Backfilled ${created} purchase UoMs from SupplierProduct records`,
      });
    } catch (_) {}

    return Response.json({
      status: 'completed',
      created,
      skipped: skipped.length,
      errors: errors.length,
      error_details: errors.slice(0, 10),
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});