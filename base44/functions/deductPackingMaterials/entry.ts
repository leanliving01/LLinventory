import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * Deducts packing materials from inventory when an order is packed.
 * Triggered by entity automation on SalesOrder update (status → packed).
 *
 * Each PackingMaterialRule can have multiple materials (stored as JSON in `materials` field).
 * Falls back to legacy single-material fields if `materials` is empty.
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json();
    const { event, data, old_data } = body;

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
    products.forEach(p => { if (p.sku) productTypeBySku[p.sku.toLowerCase()] = p.type; });

    // Build sellable flag lookup (to distinguish customer sauces from kitchen raw sauces)
    const productSellableBySku = {};
    products.forEach(p => { if (p.sku) productSellableBySku[p.sku.toLowerCase()] = !!p.sellable; });

    // Count meals and supplements (sellable sauces count as supplements — they ship in supplement boxes)
    let mealCount = 0;
    let supplementCount = 0;

    for (const line of orderLines) {
      if (line.status === 'cancelled' || line.is_package_parent) continue;
      const sku = (line.sku || '').toLowerCase();
      const productType = productTypeBySku[sku];
      const isSellable = productSellableBySku[sku];
      if (productType === 'supplement') {
        supplementCount += line.qty || 0;
      } else if (productType === 'sauce' && isSellable) {
        supplementCount += line.qty || 0;
      } else if (productType === 'finished_meal' || line.is_package_component) {
        mealCount += line.qty || 0;
      }
    }

    console.log(`[deductPackingMaterials] Meals: ${mealCount}, Supplements: ${supplementCount}`);

    const deductions = [];

    for (const rule of rules) {
      // Check trigger
      const triggerMatch =
        (rule.trigger === 'has_supplements' && supplementCount > 0) ||
        (rule.trigger === 'has_meals' && mealCount > 0) ||
        (rule.trigger === 'always');

      if (!triggerMatch) continue;

      // Parse materials list (new format), fallback to legacy single material
      let materialsList = [];
      if (rule.materials) {
        try {
          const parsed = JSON.parse(rule.materials);
          if (Array.isArray(parsed)) materialsList = parsed;
        } catch { /* ignore parse errors */ }
      }
      // Legacy fallback
      if (materialsList.length === 0 && rule.material_product_id) {
        materialsList = [{
          product_id: rule.material_product_id,
          sku: rule.material_sku || '',
          name: rule.material_name || '',
          deduction_mode: rule.deduction_mode || 'fixed_per_order',
          qty_per_deduction: rule.qty_per_deduction ?? 1,
          per_x_items: rule.per_x_items ?? 1,
        }];
      }

      for (const mat of materialsList) {
        if (!mat.product_id) continue;

        // Calculate deduction qty
        let deductQty = 0;
        if (mat.deduction_mode === 'fixed_per_order') {
          deductQty = mat.qty_per_deduction || 1;
        } else if (mat.deduction_mode === 'per_x_items') {
          const itemCount = rule.trigger === 'has_supplements' ? supplementCount :
                            rule.trigger === 'has_meals' ? mealCount :
                            (mealCount + supplementCount);
          const perX = mat.per_x_items || 1;
          const buckets = Math.ceil(itemCount / perX);
          deductQty = buckets * (mat.qty_per_deduction || 1);
        }

        if (deductQty <= 0) continue;

        console.log(`[deductPackingMaterials] Rule "${rule.name}" — deducting ${deductQty} of ${mat.sku}`);

        // Create stock movement
        await base44.asServiceRole.entities.StockMovement.create({
          product_id: mat.product_id,
          product_sku: mat.sku || '',
          product_name: mat.name || '',
          qty: deductQty,
          uom: 'pcs',
          reason: 'packing_material',
          ref_type: 'sales_order',
          ref_id: orderId,
          ref_number: data.order_number || `Order ${orderId}`,
          reference_key: `packing_material:${orderId}:${rule.id}:${mat.product_id}`,
          notes: `Auto-deduct: ${rule.name} — ${mat.name} (${deductQty} units)`,
        });

        // Update StockOnHand
        const sohRecords = await base44.asServiceRole.entities.StockOnHand.filter({
          product_id: mat.product_id,
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

        deductions.push({ rule: rule.name, material: mat.sku, qty: deductQty });
      }
    }

    console.log(`[deductPackingMaterials] Done — ${deductions.length} deductions applied`);
    return Response.json({ success: true, order_id: orderId, deductions });

  } catch (error) {
    console.error('[deductPackingMaterials] Error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});