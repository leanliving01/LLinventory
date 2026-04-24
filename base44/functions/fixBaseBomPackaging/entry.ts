import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

// These "base" portion BOMs (BeeTri, ChiCur, CotPie, etc.) are actually the MWL (300g) meals
// used for BYO orders and MWL packages. They need MWL sleeves + Skin Vacuum + Black Plates.
// 
// Mapping: base SKU -> MWL meal number (to find the MWL sleeve)
// e.g. BeeTri = MWL2 (Beef Trinchado), so sleeve = MWL2Sleeve

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    const dryRun = body.dry_run !== false;

    // Get all active portion BOMs
    const portionBoms = await base44.entities.Bom.filter({ bom_type: 'portion', is_active: true }, 'product_sku', 200);
    
    // Get ALL BomComponents
    const allComponents = await base44.entities.BomComponent.list('-created_date', 5000);
    
    // Get all packaging products
    const packagingProducts = await base44.entities.Product.filter({ type: 'packaging', status: 'active' }, 'sku', 200);
    
    const BLACK_PLATE = { id: '69ea6e91c5850d1639818518', sku: 'BPM', name: 'Black Plates' };
    const SKIN_VACUUM = { id: '69ea6ed8615d12ebe130c018', sku: 'SVP', name: 'Skin Vacuum' };
    
    // Build sleeve lookup by SKU
    const sleeveBysku = {};
    packagingProducts.forEach(p => {
      if (p.sku?.includes('Sleeve')) {
        sleeveBysku[p.sku] = p;
      }
    });
    
    // Group components by bom_id
    const compsByBom = {};
    allComponents.forEach(c => {
      if (!compsByBom[c.bom_id]) compsByBom[c.bom_id] = [];
      compsByBom[c.bom_id].push(c);
    });
    
    // Identify base BOMs: portion BOMs whose product_sku does NOT start with MLM/MWL/WLM/WWL/LC
    // These are the MWL/BYO base meals
    const variantPrefixes = ['MLM', 'MWL', 'WLM', 'WWL', 'LC'];
    const baseBoms = portionBoms.filter(b => {
      const sku = b.product_sku || '';
      return !variantPrefixes.some(p => sku.startsWith(p));
    });
    
    // For each base BOM, find which MWL number it corresponds to by matching product names
    // Strategy: find the MWL BOM that has the same base meal name
    const mwlBoms = portionBoms.filter(b => (b.product_sku || '').startsWith('MWL'));
    
    const sleeveIds = new Set(Object.values(sleeveBysku).map(s => s.id));
    const actions = [];
    const unmatchedBoms = [];
    
    for (const baseBom of baseBoms) {
      const comps = compsByBom[baseBom.id] || [];
      const hasBlackPlate = comps.some(c => c.input_product_id === BLACK_PLATE.id);
      const hasSkinVacuum = comps.some(c => c.input_product_id === SKIN_VACUUM.id);
      const hasSleeve = comps.some(c => sleeveIds.has(c.input_product_id));
      
      // Find matching MWL BOM by product name similarity
      const baseName = (baseBom.product_name || '').toLowerCase().replace(/\s+/g, ' ').trim();
      let matchedMwl = null;
      for (const mwl of mwlBoms) {
        const mwlName = (mwl.product_name || '').toLowerCase().replace(/\s+/g, ' ').trim();
        // MWL names typically append " MLM" or " MWL" etc. at the end
        // Check if base name is contained in MWL name (minus the suffix)
        const mwlBase = mwlName.replace(/\s*(mlm|mwl|wlm|wwl)\s*$/i, '').trim();
        if (mwlBase === baseName || baseName === mwlBase) {
          matchedMwl = mwl;
          break;
        }
      }
      
      // Find the MWL sleeve SKU
      let mwlSleeveSku = null;
      if (matchedMwl) {
        mwlSleeveSku = matchedMwl.product_sku + 'Sleeve'; // e.g. MWL2Sleeve
      }
      
      const sleeveProduct = mwlSleeveSku ? sleeveBysku[mwlSleeveSku] : null;
      
      // Also check for special sleeves (CAEPL - Sleeve, CZA - Sleeve, LHCCG - Sleeve)
      const specialSleeveSku = baseBom.product_sku + ' - Sleeve';
      const specialSleeve = sleeveBysku[specialSleeveSku];
      const finalSleeve = sleeveProduct || specialSleeve;
      
      const info = {
        bom_id: baseBom.id,
        bom_sku: baseBom.product_sku,
        bom_name: baseBom.product_name,
        matched_mwl: matchedMwl ? matchedMwl.product_sku : null,
        has_black_plate: hasBlackPlate,
        has_skin_vacuum: hasSkinVacuum,
        has_sleeve: hasSleeve,
        sleeve_found: finalSleeve ? finalSleeve.sku : null,
      };
      
      // Add missing items
      if (!hasBlackPlate) {
        if (!dryRun) {
          await base44.asServiceRole.entities.BomComponent.create({
            bom_id: baseBom.id, input_product_id: BLACK_PLATE.id,
            input_product_name: BLACK_PLATE.name, input_product_sku: BLACK_PLATE.sku,
            qty: 1, uom: 'pcs', is_consumable: true,
          });
        }
        actions.push({ ...info, adding: 'Black Plates (BPM)' });
      }
      
      if (!hasSkinVacuum) {
        if (!dryRun) {
          await base44.asServiceRole.entities.BomComponent.create({
            bom_id: baseBom.id, input_product_id: SKIN_VACUUM.id,
            input_product_name: SKIN_VACUUM.name, input_product_sku: SKIN_VACUUM.sku,
            qty: 1, uom: 'pcs', is_consumable: true,
          });
        }
        actions.push({ ...info, adding: 'Skin Vacuum (SVP)' });
      }
      
      if (!hasSleeve) {
        if (finalSleeve) {
          if (!dryRun) {
            await base44.asServiceRole.entities.BomComponent.create({
              bom_id: baseBom.id, input_product_id: finalSleeve.id,
              input_product_name: finalSleeve.name, input_product_sku: finalSleeve.sku,
              qty: 1, uom: 'pcs', is_consumable: true,
            });
          }
          actions.push({ ...info, adding: `Sleeve: ${finalSleeve.name} (${finalSleeve.sku})` });
        } else {
          unmatchedBoms.push(info);
        }
      }
    }
    
    return Response.json({
      dry_run: dryRun,
      total_base_boms: baseBoms.length,
      total_actions: actions.length,
      actions,
      unmatched_no_sleeve_found: unmatchedBoms,
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});