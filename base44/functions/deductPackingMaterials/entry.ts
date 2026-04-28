import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * Deducts packing materials from inventory when an order is packed.
 * Triggered by entity automation on SalesOrder update (status → packed).
 *
 * Logic:
 * 1. Load all active PackingMaterialRule records.
 * 2. Load SalesOrderLines for this order.
 * 3. Count meals (type=finished_meal via component lines) and supplements.
 * 4. For each rule, calculate deduction qty and create StockMovement + update SOH.
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    // Parse automation payload
    const body = await req.json();
    const { event, data, old_data } = body;

    // Only proceed if status just changed to 'packed'
    if (!data || data.status !== 'packed') {
      return Response.json({ skipped: true, reason: 'status is not packed' });
    }
    if (old_data && old_data.status === 'packed') {
      return Response.json({ skipped: true, reason: 'already was packed' });
    }

    const orderId = event?.entity_id || data?.id;
    if (!orderId) {
      return Response.json({ error: 'No order ID found' }, { status: 400 });
    }

    console.log(`[deductPackingMaterials] Order ${orderId} packed — processing rules`);

    // Load rules and order lines in parallel
    const [rules, orderLines, products] = await Promise.all([
      base44.asServiceRole.entities.PackingMaterialRule.filter({ is_active: true }),
      base44.asServiceRole.entities.SalesOrderLine.filter({ sales_order_id: orderId }),
      base44.asServiceRole.entities.Product.filter({ status: 'active' }),
    ]);

    if (rules.length === 0) {
      console.log('[deductPackingMaterials] No active rules — skipping');
      return Response.json({ skipped: true, reason: 'no active rules' });
    }

    // Build product type lookup
    const productTypeBySku = {};
    products.forEach(p => {
      if (p.sku) productTypeBySku[p.sku.toLowerCase()] = p.type;
    });

    // Count meals and supplements in this order
    // Meals: component lines (is_package_component=true) or standalone finished_meal lines
    // Supplements: lines whose product type = 'supplement'
    let mealCount = 0;
    let supplementCount = 0;

    for (const line of orderLines) {
      if (line.status === 'cancelled') continue;
      if (line.is_package_parent) continue; // parent display lines, not actual items

      const sku = (line.sku || '').toLowerCase();
      const productType = productTypeBySku[sku];

      if (productType === 'supplement') {
        supplementCount += line.qty || 0;
      } else if (productType === 'finished_meal' || line.is_package_component) {
        mealCount += line.qty || 0;
      }
    }

    console.log(`[deductPackingMaterials] Meals: ${mealCount}, Supplements: ${supplementCount}`);

    // Process each rule
    const deductions = [];

    for (const rule of rules) {
      // Check trigger
      const triggerMatch =
        (rule.trigger === 'has_supplements' && supplementCount > 0) ||
        (rule.trigger === 'has_meals' && mealCount > 0) ||
        (rule.trigger === 'always');

      if (!triggerMatch) {
        console.log(`[deductPackingMaterials] Rule "${rule.name}" — trigger not met, skipping`);
        continue;
      }

      // Calculate deduction qty
      let deductQty = 0;
      if (rule.deduction_mode === 'fixed_per_order') {
        deductQty = rule.qty_per_deduction || 1;
      } else if (rule.deduction_mode === 'per_x_items') {
        // Determine the relevant item count
        const itemCount = rule.trigger === 'has_supplements' ? supplementCount :
                          rule.trigger === 'has_meals' ? mealCount :
                          (mealCount + supplementCount);
        const perX = rule.per_x_items || 1;
        const buckets = Math.ceil(itemCount / perX);
        deductQty = buckets * (rule.qty_per_deduction || 1);
      }

      if (deductQty <= 0) continue;

      console.log(`[deductPackingMaterials] Rule "${rule.name}" — deducting ${deductQty} of ${rule.material_sku}`);

      // Create stock movement (consumption from packing)
      await base44.asServiceRole.entities.StockMovement.create({
        product_id: rule.material_product_id,
        product_sku: rule.material_sku || '',
        product_name: rule.material_name || '',
        qty: deductQty,
        uom: 'pcs',
        reason: 'sale_fulfillment',
        ref_type: 'sales_order',
        ref_id: orderId,
        reference_key: `packing_material:${orderId}:${rule.id}`,
        notes: `Auto-deduct packing material: ${rule.name} (${deductQty} units)`,
      });

      // Update StockOnHand if exists
      const sohRecords = await base44.asServiceRole.entities.StockOnHand.filter({
        product_id: rule.material_product_id,
      });

      if (sohRecords.length > 0) {
        const soh = sohRecords[0];
        const newOnHand = Math.max(0, (soh.qty_on_hand || 0) - deductQty);
        const newAvailable = Math.max(0, newOnHand - (soh.qty_committed || 0));
        await base44.asServiceRole.entities.StockOnHand.update(soh.id, {
          qty_on_hand: newOnHand,
          qty_available: newAvailable,
          last_updated_at: new Date().toISOString(),
        });
      }

      deductions.push({
        rule: rule.name,
        material: rule.material_sku,
        qty: deductQty,
      });
    }

    console.log(`[deductPackingMaterials] Done — ${deductions.length} deductions applied`);
    return Response.json({ success: true, order_id: orderId, deductions });

  } catch (error) {
    console.error('[deductPackingMaterials] Error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});