import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * §5.2.7 Ingredient Cost Rollup
 * Cascades cost_avg through Cook → Portion → Pack BOM layers.
 * 
 * Cook BOM: output cost = sum(input_product.cost_avg * component.qty / yield_qty)
 * Portion BOM: output cost = sum(input_product.cost_avg * component.qty / yield_qty)  
 * Pack BOM: output cost = sum(input_product.cost_avg * component.qty / yield_qty)
 */

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me();
  if (user?.role !== 'admin') {
    return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
  }

  try {
    // Load all products and BOMs (with pagination)
    const loadAll = async (entity) => {
      let all = [];
      let skip = 0;
      const limit = 200;
      while (true) {
        const batch = await entity.list('-created_date', limit, skip);
        all = all.concat(batch);
        if (batch.length < limit) break;
        skip += limit;
      }
      return all;
    };

    const products = await loadAll(base44.asServiceRole.entities.Product);
    const boms = await base44.asServiceRole.entities.Bom.filter({ is_active: true }, '-created_date', 500);
    const components = await loadAll(base44.asServiceRole.entities.BomComponent);

    const productMap = {};
    products.forEach(p => { productMap[p.id] = p; });

    const componentsByBom = {};
    components.forEach(c => {
      if (!componentsByBom[c.bom_id]) componentsByBom[c.bom_id] = [];
      componentsByBom[c.bom_id].push(c);
    });

    const bomsByType = { cook: [], portion: [], pack: [] };
    boms.forEach(b => {
      if (bomsByType[b.bom_type]) bomsByType[b.bom_type].push(b);
    });

    const updates = [];
    const log = [];

    // Helper: calculate cost for a BOM
    const calcBomCost = (bom) => {
      const comps = componentsByBom[bom.id] || [];
      if (comps.length === 0) return null;

      let totalInputCost = 0;
      for (const comp of comps) {
        if (comp.is_consumable) continue;
        const inputProduct = productMap[comp.input_product_id];
        if (!inputProduct) continue;
        const inputCost = inputProduct.cost_avg || 0;
        totalInputCost += inputCost * comp.qty;
      }

      const yieldQty = bom.yield_qty || 1;
      return totalInputCost / yieldQty;
    };

    // Layer 1: Cook BOMs (raw → WIP bulk)
    for (const bom of bomsByType.cook) {
      const cost = calcBomCost(bom);
      if (cost === null) continue;
      const outputProduct = productMap[bom.product_id];
      if (!outputProduct) continue;

      const rounded = Math.round(cost * 100) / 100;
      if (rounded !== (outputProduct.cost_avg || 0)) {
        updates.push({ id: outputProduct.id, cost_avg: rounded });
        productMap[outputProduct.id] = { ...outputProduct, cost_avg: rounded };
        log.push(`Cook: ${outputProduct.sku} → R${rounded}`);
      }
    }

    // Layer 2: Portion BOMs (WIP → portioned meals)
    for (const bom of bomsByType.portion) {
      const cost = calcBomCost(bom);
      if (cost === null) continue;
      const outputProduct = productMap[bom.product_id];
      if (!outputProduct) continue;

      const rounded = Math.round(cost * 100) / 100;
      if (rounded !== (outputProduct.cost_avg || 0)) {
        updates.push({ id: outputProduct.id, cost_avg: rounded });
        productMap[outputProduct.id] = { ...outputProduct, cost_avg: rounded };
        log.push(`Portion: ${outputProduct.sku} → R${rounded}`);
      }
    }

    // Layer 3: Pack BOMs (meals → packages)
    for (const bom of bomsByType.pack) {
      const cost = calcBomCost(bom);
      if (cost === null) continue;
      const outputProduct = productMap[bom.product_id];
      if (!outputProduct) continue;

      const rounded = Math.round(cost * 100) / 100;
      if (rounded !== (outputProduct.cost_avg || 0)) {
        updates.push({ id: outputProduct.id, cost_avg: rounded });
        log.push(`Pack: ${outputProduct.sku} → R${rounded}`);
      }
    }

    // Apply updates (batched with delay to avoid rate limits)
    for (let i = 0; i < updates.length; i++) {
      await base44.asServiceRole.entities.Product.update(updates[i].id, { cost_avg: updates[i].cost_avg });
      if (i > 0 && i % 10 === 0) {
        await new Promise(r => setTimeout(r, 1000));
      }
    }

    console.log(`[CostRollup] Updated ${updates.length} products`);

    // Audit log
    if (updates.length > 0) {
      await base44.asServiceRole.entities.AuditLog.create({
        action: 'update',
        entity_type: 'Product',
        description: `Cost rollup: updated ${updates.length} products through Cook→Portion→Pack layers`,
      });
    }

    return Response.json({
      success: true,
      updated: updates.length,
      details: log,
    });

  } catch (error) {
    console.error('[CostRollup ERROR]', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});