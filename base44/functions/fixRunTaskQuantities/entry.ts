import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * One-shot admin function to fix WIP task quantities for a specific production run.
 * Recalculates cook/prep task qty from BOM components × meal-line planned quantities.
 */
Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me();
  if (user?.role !== 'admin') {
    return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
  }

  const { run_id } = await req.json();
  if (!run_id) return Response.json({ error: 'run_id required' }, { status: 400 });

  // 1. Load all tasks for this run
  const tasks = await base44.asServiceRole.entities.ProductionTask.filter({ run_id, archived: false }, 'step_no', 500);
  
  // 2. Load all run lines
  const lines = await base44.asServiceRole.entities.ProductionRunLine.filter({ run_id }, '-created_date', 200);
  
  // 3. Load all portion BOMs
  const portionBoms = await base44.asServiceRole.entities.Bom.filter({ bom_type: 'portion', is_active: true }, '-created_date', 200);
  
  // 4. Load all BOM components
  const allComponents = await base44.asServiceRole.entities.BomComponent.list('-created_date', 3000);
  
  // Build lookup: finished_meal_product_id → portion BOM
  const portionBomByProduct = {};
  portionBoms.forEach(b => { portionBomByProduct[b.product_id] = b; });
  
  // Build lookup: bom_id → components[]
  const compsByBom = {};
  allComponents.forEach(c => {
    if (!compsByBom[c.bom_id]) compsByBom[c.bom_id] = [];
    compsByBom[c.bom_id].push(c);
  });

  // 5. For each run line (finished meal), look up its portion BOM components (WIP ingredients)
  //    and aggregate: wip_product_id → total kg needed
  const wipQty = {}; // wip_product_id → { totalKg, uom, sku, name }
  
  for (const line of lines) {
    const portionBom = portionBomByProduct[line.product_id];
    if (!portionBom) continue;
    
    const yieldQty = portionBom.yield_qty || 1;
    const comps = compsByBom[portionBom.id] || [];
    
    for (const comp of comps) {
      // Skip packaging/consumables (SVP, BPM, sleeves) — only care about WIP bulk items
      if (comp.is_consumable) continue;
      
      const perMeal = comp.qty / yieldQty;
      const totalNeeded = perMeal * (line.planned_qty || 0);
      
      if (!wipQty[comp.input_product_id]) {
        wipQty[comp.input_product_id] = { totalQty: 0, uom: comp.uom, sku: comp.input_product_sku, name: comp.input_product_name };
      }
      wipQty[comp.input_product_id].totalQty += totalNeeded;
    }
  }
  
  // Round to 2 decimals
  for (const id of Object.keys(wipQty)) {
    wipQty[id].totalQty = Math.round(wipQty[id].totalQty * 100) / 100;
  }

  // 6. Now update cook and prep tasks with the correct quantities
  const cookPrepTasks = tasks.filter(t => t.station === 'cook' || t.station === 'prep');
  const updates = [];
  
  for (const task of cookPrepTasks) {
    const wip = wipQty[task.product_id];
    if (!wip) {
      updates.push({ id: task.id, sku: task.product_sku, oldQty: task.qty, newQty: task.qty, uom: task.qty_uom || '?', reason: 'no-portion-bom-ref' });
      continue;
    }
    
    const newQty = wip.totalQty;
    const newUom = wip.uom || 'kg';
    
    if (newQty !== task.qty || newUom !== task.qty_uom) {
      await base44.asServiceRole.entities.ProductionTask.update(task.id, {
        qty: newQty,
        qty_uom: newUom,
      });
      updates.push({ id: task.id, sku: task.product_sku, name: task.meal_name, station: task.station, oldQty: task.qty, newQty, oldUom: task.qty_uom, newUom, status: 'updated' });
    } else {
      updates.push({ id: task.id, sku: task.product_sku, oldQty: task.qty, newQty, uom: newUom, status: 'already-correct' });
    }
  }
  
  // 7. Also set qty_uom on portion tasks (they should be 'pcs')
  const portionTasks = tasks.filter(t => t.station === 'portion');
  for (const task of portionTasks) {
    if (task.qty_uom !== 'pcs') {
      await base44.asServiceRole.entities.ProductionTask.update(task.id, { qty_uom: 'pcs' });
      updates.push({ id: task.id, sku: task.product_sku, station: 'portion', oldUom: task.qty_uom, newUom: 'pcs', status: 'uom-fixed' });
    }
  }
  
  return Response.json({ 
    run_id,
    wip_quantities: wipQty,
    task_updates: updates,
    summary: {
      total_tasks: tasks.length,
      cook_prep_tasks: cookPrepTasks.length,
      portion_tasks: portionTasks.length,
    }
  });
});