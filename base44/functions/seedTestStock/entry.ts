import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Admin only' }, { status: 403 });
    }

    const { qty = 4, location_id, batch_start = 0, batch_size = 15 } = await req.json();

    // Fetch a batch of active finished meals
    const meals = await base44.asServiceRole.entities.Product.filter(
      { type: 'finished_meal', status: 'active' }, 'sku', batch_size, batch_start
    );

    console.log(`Processing batch starting at ${batch_start}: ${meals.length} meals`);

    if (meals.length === 0) {
      return Response.json({ success: true, done: true, meals_seeded: 0, message: 'No more meals to process' });
    }

    const now = new Date().toISOString();

    // Create stock movements in bulk
    const movements = meals.map(meal => ({
      product_id: meal.id,
      product_sku: meal.sku,
      product_name: meal.name,
      to_location_id: location_id,
      qty: qty,
      uom: meal.stock_uom || 'pcs',
      reason: 'stocktake_adjustment',
      ref_type: 'manual',
      ref_number: 'TEST-SEED',
      notes: `Test seed: ${qty} units`,
    }));

    await base44.asServiceRole.entities.StockMovement.bulkCreate(movements);

    // Create/update StockOnHand one by one (need to check existing)
    let created = 0;
    for (const meal of meals) {
      const existing = await base44.asServiceRole.entities.StockOnHand.filter({
        product_id: meal.id,
        location_id: location_id,
      });

      if (existing.length > 0) {
        const soh = existing[0];
        await base44.asServiceRole.entities.StockOnHand.update(soh.id, {
          qty_on_hand: (soh.qty_on_hand || 0) + qty,
          qty_available: ((soh.qty_on_hand || 0) + qty) - (soh.qty_committed || 0),
          last_updated_at: now,
        });
      } else {
        await base44.asServiceRole.entities.StockOnHand.create({
          product_id: meal.id,
          product_sku: meal.sku,
          product_name: meal.name,
          location_id: location_id,
          location_name: 'Meal Freezer',
          qty_on_hand: qty,
          qty_committed: 0,
          qty_available: qty,
          uom: meal.stock_uom || 'pcs',
          last_updated_at: now,
        });
      }
      created++;
    }

    const hasMore = meals.length === batch_size;

    return Response.json({
      success: true,
      done: !hasMore,
      meals_seeded: created,
      qty_per_meal: qty,
      next_batch_start: hasMore ? batch_start + batch_size : null,
    });
  } catch (error) {
    console.error('Error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});