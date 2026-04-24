import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get all active portion BOMs
    const portionBoms = await base44.entities.Bom.filter({ bom_type: 'portion', is_active: true }, 'product_sku', 200);
    
    // Get ALL BomComponents
    const allComponents = await base44.entities.BomComponent.list('-created_date', 5000);
    
    // Get all packaging products (sleeves, plates, skin vacuum)
    const packagingProducts = await base44.entities.Product.filter({ type: 'packaging', status: 'active' }, 'sku', 200);
    
    // Key packaging product IDs
    const BLACK_PLATE_ID = '69ea6e91c5850d1639818518'; // BPM
    const SKIN_VACUUM_ID = '69ea6ed8615d12ebe130c018'; // SVP
    
    // Build sleeve lookup: SKU prefix -> sleeve product
    // Sleeves follow patterns like MLM2Sleeve, MWL1Sleeve, WWL2Sleeve, etc.
    // Also: "CAEPL - Sleeve", "CZA - Sleeve", "LHCCG - Sleeve"
    const sleeveProducts = packagingProducts.filter(p => 
      p.name?.includes('Sleeve') || p.sku?.includes('Sleeve')
    );
    
    // Group components by bom_id
    const compsByBom = {};
    allComponents.forEach(c => {
      if (!compsByBom[c.bom_id]) compsByBom[c.bom_id] = [];
      compsByBom[c.bom_id].push(c);
    });
    
    const results = {
      total_portion_boms: portionBoms.length,
      missing_black_plate: [],
      missing_skin_vacuum: [],
      missing_sleeve: [],
      has_all_packaging: [],
      sleeve_products_available: sleeveProducts.map(s => ({ id: s.id, sku: s.sku, name: s.name })),
    };
    
    for (const bom of portionBoms) {
      const comps = compsByBom[bom.id] || [];
      const hasBlackPlate = comps.some(c => c.input_product_id === BLACK_PLATE_ID);
      const hasSkinVacuum = comps.some(c => c.input_product_id === SKIN_VACUUM_ID);
      
      // Check for sleeve: look for any component that is a sleeve product
      const sleeveIds = new Set(sleeveProducts.map(s => s.id));
      const hasSleeve = comps.some(c => sleeveIds.has(c.input_product_id));
      
      // Find matching sleeve for this BOM's product SKU
      const bomSku = bom.product_sku || '';
      // Try to find a sleeve that matches this SKU
      const matchingSleeve = sleeveProducts.find(s => {
        const sleeveSku = s.sku || '';
        // Match patterns: MLM2Sleeve -> MLM2, "CAEPL - Sleeve" -> CAEPL
        const cleanSleeveSku = sleeveSku.replace('Sleeve', '').replace(' - ', '').trim();
        return cleanSleeveSku === bomSku;
      });
      
      const info = {
        bom_id: bom.id,
        product_sku: bom.product_sku,
        product_name: bom.product_name,
        component_count: comps.length,
        existing_packaging: comps.filter(c => 
          c.input_product_id === BLACK_PLATE_ID || 
          c.input_product_id === SKIN_VACUUM_ID ||
          sleeveIds.has(c.input_product_id)
        ).map(c => c.input_product_sku),
        matching_sleeve: matchingSleeve ? { id: matchingSleeve.id, sku: matchingSleeve.sku, name: matchingSleeve.name } : null,
      };
      
      if (!hasBlackPlate) results.missing_black_plate.push(info);
      if (!hasSkinVacuum) results.missing_skin_vacuum.push(info);
      if (!hasSleeve) results.missing_sleeve.push(info);
      if (hasBlackPlate && hasSkinVacuum && hasSleeve) results.has_all_packaging.push(info);
    }
    
    return Response.json(results);
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});