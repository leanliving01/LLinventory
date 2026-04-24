import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const dryRun = body.dry_run !== false; // default to dry run

    // Get all active portion BOMs
    const portionBoms = await base44.entities.Bom.filter({ bom_type: 'portion', is_active: true }, 'product_sku', 200);
    
    // Get ALL BomComponents
    const allComponents = await base44.entities.BomComponent.list('-created_date', 5000);
    
    // Get all packaging products
    const packagingProducts = await base44.entities.Product.filter({ type: 'packaging', status: 'active' }, 'sku', 200);
    
    // Key packaging product IDs
    const BLACK_PLATE = { id: '69ea6e91c5850d1639818518', sku: 'BPM', name: 'Black Plates' };
    const SKIN_VACUUM = { id: '69ea6ed8615d12ebe130c018', sku: 'SVP', name: 'Skin Vacuum' };
    
    // Sleeve products indexed by SKU prefix
    const sleeveProducts = packagingProducts.filter(p => 
      p.name?.includes('Sleeve') || p.sku?.includes('Sleeve')
    );
    
    // Group components by bom_id
    const compsByBom = {};
    allComponents.forEach(c => {
      if (!compsByBom[c.bom_id]) compsByBom[c.bom_id] = [];
      compsByBom[c.bom_id].push(c);
    });
    
    const sleeveIds = new Set(sleeveProducts.map(s => s.id));
    const actions = [];
    
    for (const bom of portionBoms) {
      const comps = compsByBom[bom.id] || [];
      const hasBlackPlate = comps.some(c => c.input_product_id === BLACK_PLATE.id);
      const hasSkinVacuum = comps.some(c => c.input_product_id === SKIN_VACUUM.id);
      const hasSleeve = comps.some(c => sleeveIds.has(c.input_product_id));
      
      // Add missing Black Plate
      if (!hasBlackPlate) {
        const action = {
          bom_id: bom.id,
          bom_sku: bom.product_sku,
          bom_name: bom.product_name,
          adding: 'Black Plates (BPM)',
        };
        if (!dryRun) {
          await base44.asServiceRole.entities.BomComponent.create({
            bom_id: bom.id,
            input_product_id: BLACK_PLATE.id,
            input_product_name: BLACK_PLATE.name,
            input_product_sku: BLACK_PLATE.sku,
            qty: 1,
            uom: 'pcs',
            is_consumable: true,
          });
        }
        actions.push(action);
      }
      
      // Add missing Skin Vacuum
      if (!hasSkinVacuum) {
        const action = {
          bom_id: bom.id,
          bom_sku: bom.product_sku,
          bom_name: bom.product_name,
          adding: 'Skin Vacuum (SVP)',
        };
        if (!dryRun) {
          await base44.asServiceRole.entities.BomComponent.create({
            bom_id: bom.id,
            input_product_id: SKIN_VACUUM.id,
            input_product_name: SKIN_VACUUM.name,
            input_product_sku: SKIN_VACUUM.sku,
            qty: 1,
            uom: 'pcs',
            is_consumable: true,
          });
        }
        actions.push(action);
      }
      
      // Add missing Sleeve — find the matching sleeve for this BOM's product SKU
      if (!hasSleeve) {
        const bomSku = bom.product_sku || '';
        const matchingSleeve = sleeveProducts.find(s => {
          const sleeveSku = (s.sku || '').replace('Sleeve', '').replace(' - Sleeve', '').replace(' - ', '').trim();
          return sleeveSku === bomSku;
        });
        
        if (matchingSleeve) {
          const action = {
            bom_id: bom.id,
            bom_sku: bom.product_sku,
            bom_name: bom.product_name,
            adding: `Sleeve: ${matchingSleeve.name} (${matchingSleeve.sku})`,
          };
          if (!dryRun) {
            await base44.asServiceRole.entities.BomComponent.create({
              bom_id: bom.id,
              input_product_id: matchingSleeve.id,
              input_product_name: matchingSleeve.name,
              input_product_sku: matchingSleeve.sku,
              qty: 1,
              uom: 'pcs',
              is_consumable: true,
            });
          }
          actions.push(action);
        } else {
          actions.push({
            bom_id: bom.id,
            bom_sku: bom.product_sku,
            bom_name: bom.product_name,
            adding: 'SLEEVE NOT FOUND — no matching sleeve product in catalog',
            warning: true,
          });
        }
      }
    }
    
    return Response.json({
      dry_run: dryRun,
      total_portion_boms: portionBoms.length,
      total_actions: actions.length,
      actions,
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});