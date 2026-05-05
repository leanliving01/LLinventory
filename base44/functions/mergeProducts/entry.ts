import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * Merge duplicate products into BOM-linked canonical products.
 *
 * For a given product name (fuzzy), finds all Product records that match,
 * identifies which one is used in BOMs (BomComponent.input_product_id),
 * merges useful data from duplicates into the canonical record,
 * creates SupplierProduct records from the duplicate info, and archives the duplicates.
 *
 * Modes:
 *   preview: true  → returns what WOULD happen (no writes)
 *   preview: false → executes the merge
 *
 * Payload: { product_ids: string[], preview?: boolean }
 *   product_ids: array of Product IDs to merge (must include the canonical one)
 */
Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me();
  if (!user || user.role !== 'admin') {
    return Response.json({ error: 'Admin access required' }, { status: 403 });
  }

  const { product_ids, preview = true } = await req.json();

  if (!product_ids || product_ids.length < 2) {
    return Response.json({ error: 'Provide at least 2 product_ids to merge' }, { status: 400 });
  }

  // Load the products
  const products = [];
  for (const pid of product_ids) {
    try {
      const results = await base44.asServiceRole.entities.Product.filter({ id: pid });
      if (results[0]) products.push(results[0]);
    } catch (e) {
      // Skip invalid IDs
      console.warn(`Skipping invalid product ID: ${pid}`, e.message);
    }
  }

  if (products.length < 2) {
    return Response.json({ error: `Only found ${products.length} product(s) from ${product_ids.length} IDs` }, { status: 400 });
  }

  // Load all BOM components to find which product is used in BOMs
  const allBomComps = await base44.asServiceRole.entities.BomComponent.list('-created_date', 5000);
  const bomLinkedIds = new Set(allBomComps.map(c => c.input_product_id));

  // Also check Bom.product_id (output side)
  const allBoms = await base44.asServiceRole.entities.Bom.list('-created_date', 1000);
  const bomOutputIds = new Set(allBoms.map(b => b.product_id));

  // Find the canonical product (the one used in BOMs)
  let canonical = null;
  const duplicates = [];

  for (const p of products) {
    if (bomLinkedIds.has(p.id) || bomOutputIds.has(p.id)) {
      if (!canonical) {
        canonical = p;
      } else {
        // Multiple BOM-linked — pick the one with more BOM references
        const cCount = allBomComps.filter(c => c.input_product_id === canonical.id).length +
                       allBoms.filter(b => b.product_id === canonical.id).length;
        const pCount = allBomComps.filter(c => c.input_product_id === p.id).length +
                       allBoms.filter(b => b.product_id === p.id).length;
        if (pCount > cCount) {
          duplicates.push(canonical);
          canonical = p;
        } else {
          duplicates.push(p);
        }
      }
    } else {
      duplicates.push(p);
    }
  }

  // If none are BOM-linked, let user pick — use the first one
  if (!canonical) {
    canonical = products[0];
    duplicates.length = 0;
    products.slice(1).forEach(p => duplicates.push(p));
  }

  // Build merge plan
  const mergePlan = {
    canonical: {
      id: canonical.id,
      sku: canonical.sku,
      name: canonical.name,
      bom_references: allBomComps.filter(c => c.input_product_id === canonical.id).length +
                      allBoms.filter(b => b.product_id === canonical.id).length,
    },
    duplicates_to_archive: duplicates.map(d => ({
      id: d.id,
      sku: d.sku,
      name: d.name,
      bom_references: allBomComps.filter(c => c.input_product_id === d.id).length +
                      allBoms.filter(b => b.product_id === d.id).length,
    })),
    fields_to_merge: [],
    supplier_products_to_create: [],
  };

  // Determine which fields to merge from duplicates into canonical
  const MERGE_FIELDS = [
    'purchase_uom', 'purchase_to_stock_factor', 'default_location_id',
    'par_level', 'min_before_reorder', 'reorder_qty', 'lead_time_days',
    'pick_category', 'barcode', 'weight_g', 'category',
    'cost_current', 'price',
    'cogs_account', 'inventory_account', 'revenue_account',
    'purchase_tax_rule', 'sale_tax_rule',
  ];

  const canonicalUpdates = {};
  for (const field of MERGE_FIELDS) {
    if (!canonical[field] || canonical[field] === 0) {
      for (const dup of duplicates) {
        if (dup[field] && dup[field] !== 0) {
          canonicalUpdates[field] = dup[field];
          mergePlan.fields_to_merge.push({ field, from_sku: dup.sku, value: dup[field] });
          break;
        }
      }
    }
  }

  // Load existing SupplierProduct records for canonical
  const existingSPs = await base44.asServiceRole.entities.SupplierProduct.filter(
    { product_id: canonical.id }, '-created_date', 100
  );
  const existingSPKeys = new Set(existingSPs.map(sp => `${sp.supplier_id}__${sp.supplier_sku}`));

  // Load all suppliers for matching
  const allSuppliers = await base44.asServiceRole.entities.Supplier.list('name', 200);
  const supplierById = {};
  allSuppliers.forEach(s => { supplierById[s.id] = s; });

  // Create SupplierProduct entries from duplicates
  for (const dup of duplicates) {
    if (dup.supplier_id) {
      const key = `${dup.supplier_id}__${dup.supplier_sku || dup.sku}`;
      if (!existingSPKeys.has(key)) {
        const supplier = supplierById[dup.supplier_id];
        const spData = {
          supplier_id: dup.supplier_id,
          supplier_name: supplier?.name || dup.supplier_id,
          product_id: canonical.id,
          product_name: canonical.name,
          product_sku: canonical.sku,
          supplier_sku: dup.supplier_sku || dup.sku,
          supplier_description: dup.name,
          purchase_uom: dup.purchase_uom || 'kg',
          purchase_uom_label: dup.purchase_uom || '',
          conversion_factor: dup.purchase_to_stock_factor || 1,
          conversion_uom: canonical.stock_uom || 'kg',
          yield_factor: 1.0,
          effective_internal_qty: dup.purchase_to_stock_factor || 1,
          last_purchase_price: dup.cost_current || dup.cost_avg || 0,
          is_default_supplier: false,
          active: true,
        };
        mergePlan.supplier_products_to_create.push(spData);
        existingSPKeys.add(key);
      }
    } else {
      // No supplier linked — still note it for the plan
      mergePlan.supplier_products_to_create.push({
        note: `${dup.sku} (${dup.name}) has no supplier_id — cannot auto-create SupplierProduct. Data merged into canonical.`,
        sku: dup.sku,
        name: dup.name,
        purchase_uom: dup.purchase_uom,
        cost: dup.cost_avg || dup.cost_current,
      });
    }
  }

  if (preview) {
    return Response.json({ preview: true, plan: mergePlan });
  }

  // Execute the merge
  const results = { updated_canonical: false, created_supplier_products: 0, archived_duplicates: 0, updated_references: 0 };

  // 1. Update canonical with merged fields
  if (Object.keys(canonicalUpdates).length > 0) {
    await base44.asServiceRole.entities.Product.update(canonical.id, canonicalUpdates);
    results.updated_canonical = true;
  }

  // 2. Create SupplierProduct records
  for (const spData of mergePlan.supplier_products_to_create) {
    if (spData.note) continue; // skip info-only entries
    await base44.asServiceRole.entities.SupplierProduct.create(spData);
    results.created_supplier_products++;
  }

  // 3. Update any StockOnHand, StockMovement, PickLine, TaskConsumption, PurchaseOrderLine
  //    that reference duplicate product IDs → point them to canonical
  for (const dup of duplicates) {
    // StockOnHand
    const sohRecords = await base44.asServiceRole.entities.StockOnHand.filter({ product_id: dup.id }, '-created_date', 100);
    for (const soh of sohRecords) {
      await base44.asServiceRole.entities.StockOnHand.update(soh.id, {
        product_id: canonical.id, product_sku: canonical.sku, product_name: canonical.name,
      });
      results.updated_references++;
    }

    // PurchaseOrderLine
    const poLines = await base44.asServiceRole.entities.PurchaseOrderLine.filter({ product_id: dup.id }, '-created_date', 500);
    for (const pol of poLines) {
      await base44.asServiceRole.entities.PurchaseOrderLine.update(pol.id, {
        product_id: canonical.id, product_sku: canonical.sku, product_name: canonical.name,
      });
      results.updated_references++;
    }

    // Existing SupplierProduct records pointing to the duplicate → re-link
    const dupSPs = await base44.asServiceRole.entities.SupplierProduct.filter({ product_id: dup.id }, '-created_date', 100);
    for (const sp of dupSPs) {
      await base44.asServiceRole.entities.SupplierProduct.update(sp.id, {
        product_id: canonical.id, product_name: canonical.name, product_sku: canonical.sku,
      });
      results.updated_references++;
    }
  }

  // 4. Archive duplicates
  for (const dup of duplicates) {
    await base44.asServiceRole.entities.Product.update(dup.id, {
      status: 'archived',
      internal_note: `Merged into ${canonical.sku} (${canonical.name}) on ${new Date().toISOString().slice(0, 10)}. Original data preserved for audit.`,
    });
    results.archived_duplicates++;
  }

  // 5. Audit log
  await base44.asServiceRole.entities.AuditLog.create({
    action: 'update',
    entity_type: 'Product',
    entity_id: canonical.id,
    description: `Merged ${duplicates.length} duplicate(s) into ${canonical.sku} (${canonical.name}). Archived: ${duplicates.map(d => d.sku).join(', ')}. Created ${results.created_supplier_products} supplier product(s).`,
  });

  return Response.json({ preview: false, plan: mergePlan, results });
});