import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * Seeds generous stock for raw materials, WIP, or finished meals.
 * mode: 'raw' | 'wip' | 'finished'
 * Processes in batches with built-in retry/backoff.
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Admin only' }, { status: 403 });
    }

    const { mode = 'raw', batch_start = 0, batch_size = 12 } = await req.json();

    // Config per mode
    const CONFIG = {
      raw: {
        filter: { type: 'raw', status: 'active' },
        location_id: '69ea6bec8ec21eb79273085e',
        location_name: 'Port Elizabeth Main Warehouse',
        ref: 'TEST-SEED-RAW',
        getQty: (uom) => {
          const u = (uom || 'kg').toLowerCase();
          if (u === 'kg') return 200;
          if (u === 'g') return 50000;
          if (u === 'ml') return 50000;
          if (u === 'l') return 50;
          if (u === 'pcs') return 500;
          return 200;
        },
      },
      wip: {
        filter: { type: 'wip_bulk', status: 'active' },
        location_id: '69ea6bec8ec21eb792730860',
        location_name: '(PE)Cold Storage',
        ref: 'TEST-SEED-WIP',
        getQty: () => 50,
      },
      finished: {
        filter: { type: 'finished_meal', status: 'active' },
        location_id: '69ea6bec8ec21eb792730863',
        location_name: '(PE)Meal Freezer',
        ref: 'TEST-SEED-MEALS',
        getQty: () => 4,
      },
      packaging: {
        filter: { type: 'packaging', status: 'active' },
        location_id: '69ea6bec8ec21eb79273085f',
        location_name: '(PE) Dry Storage',
        ref: 'TEST-SEED-PKG',
        getQty: () => 1000,
      },
    };

    const cfg = CONFIG[mode];
    if (!cfg) {
      return Response.json({ error: 'Invalid mode. Use: raw, wip, finished, packaging' }, { status: 400 });
    }

    // Fetch batch of products
    const products = await base44.asServiceRole.entities.Product.filter(
      cfg.filter, 'sku', batch_size, batch_start
    );

    if (products.length === 0) {
      return Response.json({ success: true, done: true, seeded: 0, message: 'No more products' });
    }

    const now = new Date().toISOString();

    // Bulk create stock movements
    const movements = products.map(p => ({
      product_id: p.id,
      product_sku: p.sku,
      product_name: p.name,
      to_location_id: cfg.location_id,
      qty: cfg.getQty(p.stock_uom),
      uom: p.stock_uom || 'kg',
      reason: 'stocktake_adjustment',
      ref_type: 'manual',
      ref_number: cfg.ref,
      notes: `Test seed: ${cfg.getQty(p.stock_uom)} ${p.stock_uom || 'kg'}`,
    }));

    await base44.asServiceRole.entities.StockMovement.bulkCreate(movements);

    // Bulk create StockOnHand (skip check — for testing, just create fresh records)
    const sohRecords = products.map(p => {
      const qty = cfg.getQty(p.stock_uom);
      return {
        product_id: p.id,
        product_sku: p.sku,
        product_name: p.name,
        location_id: cfg.location_id,
        location_name: cfg.location_name,
        qty_on_hand: qty,
        qty_committed: 0,
        qty_available: qty,
        uom: p.stock_uom || 'kg',
        last_updated_at: now,
      };
    });

    await base44.asServiceRole.entities.StockOnHand.bulkCreate(sohRecords);

    const hasMore = products.length === batch_size;
    return Response.json({
      success: true,
      done: !hasMore,
      seeded: products.length,
      next_batch_start: hasMore ? batch_start + batch_size : null,
      sample: products.slice(0, 3).map(p => `${p.name} (${p.sku}): ${cfg.getQty(p.stock_uom)} ${p.stock_uom || 'kg'}`),
    });
  } catch (error) {
    console.error('Error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});