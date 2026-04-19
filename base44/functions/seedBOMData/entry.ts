import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me();
  if (!user || user.role !== 'admin') {
    return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
  }

  // Get all data
  const packages = await base44.asServiceRole.entities.PackageProduct.filter({});
  const skus = await base44.asServiceRole.entities.SKU.filter({});
  const existingBOM = await base44.asServiceRole.entities.PackageBOMLine.filter({});

  // Clear existing BOM lines
  for (const line of existingBOM) {
    await base44.asServiceRole.entities.PackageBOMLine.delete(line.id);
  }

  const today = new Date().toISOString().split('T')[0];
  const bomRecords = [];

  // Goal-related families: MWL, MLM, WWL, WLM
  // Each has 15 meals, same meals in all packages
  // 15-pack = 1 each, 30-pack = 2 each, 60-pack = 4 each
  const goalFamilies = ['MWL', 'MLM', 'WWL', 'WLM'];

  for (const family of goalFamilies) {
    const familySkus = skus.filter(s => s.package_type === family && s.is_active !== false);
    const familyPackages = packages.filter(p => p.package_family === family && p.is_active !== false);

    for (const pkg of familyPackages) {
      const multiplier = pkg.pack_size === 15 ? 1 : pkg.pack_size === 30 ? 2 : pkg.pack_size === 60 ? 4 : 1;
      
      for (const sku of familySkus) {
        bomRecords.push({
          package_product_id: pkg.id,
          sku_id: sku.id,
          sku_display_name: sku.display_name || sku.meal_name,
          quantity_per_pack: multiplier,
          effective_from: today,
        });
      }
    }
  }

  // Low carb: 5 meals
  // 15-pack = 3 each, 30-pack = 6 each, 60-pack = 12 each
  const lcSkus = skus.filter(s => s.package_type === 'LOW_CARB' && s.is_active !== false);
  const lcPackages = packages.filter(p => p.package_family === 'LOW_CARB' && p.is_active !== false);

  for (const pkg of lcPackages) {
    const multiplier = pkg.pack_size === 15 ? 3 : pkg.pack_size === 30 ? 6 : pkg.pack_size === 60 ? 12 : 3;
    
    for (const sku of lcSkus) {
      bomRecords.push({
        package_product_id: pkg.id,
        sku_id: sku.id,
        sku_display_name: sku.display_name || sku.meal_name,
        quantity_per_pack: multiplier,
        effective_from: today,
      });
    }
  }

  // Bulk create in batches
  let created = 0;
  for (let i = 0; i < bomRecords.length; i += 50) {
    const batch = bomRecords.slice(i, i + 50);
    await base44.asServiceRole.entities.PackageBOMLine.bulkCreate(batch);
    created += batch.length;
  }

  // Audit log
  await base44.asServiceRole.entities.AuditLog.create({
    action: 'import',
    entity_type: 'PackageBOMLine',
    description: `Seeded BOM data: ${created} lines across ${packages.length} packages`,
  });

  return Response.json({
    success: true,
    total_bom_lines: created,
    goal_families: goalFamilies.length,
    lc_meals: lcSkus.length,
  });
});