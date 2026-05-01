import { base44 } from '@/api/base44Client';
import { writeAuditLog } from '@/lib/auditLog';

/**
 * Confirms a GRN:
 * 1. Saves all GRN lines (recalculates internal_qty, variance, line_total)
 * 2. Creates StockMovement records for each stock-type line
 * 3. Updates StockOnHand per product/location
 * 4. Updates Product.cost_avg (weighted average) and cost_current
 * 5. Creates SupplierShortage records for short lines
 * 6. Updates PO status if linked
 * 7. Marks GRN as confirmed
 */
export async function confirmGRN(grn, lines, userName) {
  // 1. Persist lines and compute derived fields
  const persistedLines = [];
  let totalValue = 0;
  let hasShortages = false;
  let hasRejections = false;

  for (const line of lines) {
    const receivedQty = parseFloat(line.received_qty) || 0;
    const expectedQty = parseFloat(line.expected_qty) || null;
    const cf = parseFloat(line.conversion_factor) || 1;
    const yf = parseFloat(line.yield_factor) || 1;
    const unitCost = parseFloat(line.unit_cost) || 0;
    const varianceQty = expectedQty != null ? receivedQty - expectedQty : 0;
    const internalQty = Math.round(receivedQty * cf * yf * 1000) / 1000;
    const lineTotal = Math.round(receivedQty * unitCost * 100) / 100;

    if (varianceQty < 0) hasShortages = true;
    if (line.condition === 'damaged' || line.condition === 'rejected') hasRejections = true;
    totalValue += lineTotal;

    const lineData = {
      ...line,
      received_qty: receivedQty,
      expected_qty: expectedQty,
      variance_qty: varianceQty,
      internal_qty_received: internalQty,
      unit_cost: unitCost,
      line_total: lineTotal,
      conversion_factor: cf,
      yield_factor: yf,
    };

    if (line.id) {
      await base44.entities.GRNLine.update(line.id, lineData);
    } else {
      const created = await base44.entities.GRNLine.create({ ...lineData, grn_id: grn.id });
      lineData.id = created.id;
    }
    persistedLines.push(lineData);
  }

  // 2. Create stock movements (only for stock items with condition=accepted)
  const stockOnHand = await base44.entities.StockOnHand.list('-updated_date', 2000);
  const productCache = {};

  for (const line of persistedLines) {
    if (line.item_type && line.item_type !== 'stock') continue;
    if (line.condition === 'rejected') continue;
    if (!line.internal_qty_received || line.internal_qty_received <= 0) continue;

    // Fetch product if not cached
    if (!productCache[line.product_id]) {
      const prods = await base44.entities.Product.filter({ id: line.product_id });
      if (prods[0]) productCache[line.product_id] = prods[0];
    }
    const product = productCache[line.product_id];
    if (!product) continue;

    // Create stock movement
    await base44.entities.StockMovement.create({
      product_id: line.product_id,
      product_sku: line.product_sku || product.sku,
      product_name: line.product_name || product.name,
      to_location_id: grn.location_id,
      qty: line.internal_qty_received,
      uom: product.stock_uom || 'kg',
      reason: 'receipt',
      ref_type: 'grn',
      ref_id: grn.id,
      ref_number: grn.grn_number,
      reference_key: `grn:${grn.id}:${line.id}`,
      unit_cost_at_movement: line.unit_cost,
      notes: `GRN ${grn.grn_number} from ${grn.supplier_name}`,
    });

    // 3. Update StockOnHand
    const existing = stockOnHand.find(
      s => s.product_id === line.product_id && s.location_id === grn.location_id
    );
    if (existing) {
      const newOnHand = (existing.qty_on_hand || 0) + line.internal_qty_received;
      await base44.entities.StockOnHand.update(existing.id, {
        qty_on_hand: newOnHand,
        qty_available: newOnHand - (existing.qty_committed || 0),
        last_updated_at: new Date().toISOString(),
      });
    } else {
      await base44.entities.StockOnHand.create({
        product_id: line.product_id,
        product_sku: line.product_sku || product.sku,
        product_name: line.product_name || product.name,
        location_id: grn.location_id,
        location_name: grn.location_name,
        qty_on_hand: line.internal_qty_received,
        qty_committed: 0,
        qty_available: line.internal_qty_received,
        uom: product.stock_uom || 'kg',
        last_updated_at: new Date().toISOString(),
      });
    }

    // 4. Update Product cost_avg (weighted average) and cost_current
    const allStock = stockOnHand.filter(s => s.product_id === line.product_id);
    const totalExistingQty = allStock.reduce((s, r) => s + (r.qty_on_hand || 0), 0);
    const existingCost = product.cost_avg || 0;
    const totalQty = totalExistingQty + line.internal_qty_received;
    // Cost per internal unit: unit_cost / (cf * yf) = cost per stock unit
    const costPerStockUnit = line.unit_cost / (line.conversion_factor * line.yield_factor) || 0;
    const newAvg = totalQty > 0
      ? ((totalExistingQty * existingCost) + (line.internal_qty_received * costPerStockUnit)) / totalQty
      : costPerStockUnit;

    await base44.entities.Product.update(product.id, {
      cost_avg: Math.round(newAvg * 100) / 100,
      cost_current: Math.round(costPerStockUnit * 100) / 100,
    });
  }

  // 4b. Price variance tracking — write SupplierPriceHistory and flag lines
  for (const line of persistedLines) {
    if (!line.supplier_product_id) continue;
    const unitCost = parseFloat(line.unit_cost) || 0;
    if (unitCost <= 0) continue;

    // Fetch the supplier product to get last_purchase_price and threshold
    let sp;
    try {
      const spList = await base44.entities.SupplierProduct.filter({ id: line.supplier_product_id });
      sp = spList[0];
    } catch { /* skip */ }
    if (!sp) continue;

    const prevPrice = sp.last_purchase_price || 0;
    const changePct = prevPrice > 0 ? ((unitCost - prevPrice) / prevPrice) * 100 : 0;
    const threshold = sp.price_variance_threshold || 0.10; // decimal e.g. 0.10 = 10%
    const isFlagged = prevPrice > 0 && Math.abs(changePct) > threshold * 100;

    // Write price history record
    await base44.entities.SupplierPriceHistory.create({
      supplier_product_id: line.supplier_product_id,
      supplier_name: grn.supplier_name,
      product_name: line.product_name,
      product_sku: line.product_sku,
      price: unitCost,
      previous_price: prevPrice,
      change_pct: Math.round(changePct * 10) / 10,
      effective_date: grn.received_date || new Date().toISOString().split('T')[0],
      source: 'grn',
      source_ref: grn.grn_number,
      purchase_uom: line.purchase_uom || sp.purchase_uom || '',
    });

    // Update supplier product last_purchase_price
    await base44.entities.SupplierProduct.update(sp.id, {
      last_purchase_price: unitCost,
    });

    // Flag the GRN line
    if (isFlagged && line.id) {
      await base44.entities.GRNLine.update(line.id, { price_variance_flagged: true });
    }
  }

  // 5. Create SupplierShortage records for short lines
  for (const line of persistedLines) {
    if (line.expected_qty == null) continue;
    const shortage = parseFloat(line.expected_qty) - parseFloat(line.received_qty);
    if (shortage <= 0) continue;

    await base44.entities.SupplierShortage.create({
      grn_id: grn.id,
      grn_line_id: line.id,
      supplier_id: grn.supplier_id,
      supplier_name: grn.supplier_name,
      supplier_product_id: line.supplier_product_id || '',
      product_id: line.product_id,
      product_name: line.product_name,
      product_sku: line.product_sku,
      shortage_qty: shortage,
      shortage_value: Math.round(shortage * (line.unit_cost || 0) * 100) / 100,
      purchase_uom: line.purchase_uom || '',
      unit_cost: line.unit_cost || 0,
      status: 'open',
    });
  }

  // 6. Update PO status if linked
  if (grn.purchase_order_id) {
    // Check how many GRNs exist for this PO
    const poGRNs = await base44.entities.GoodsReceivedNote.filter({ purchase_order_id: grn.purchase_order_id });
    const confirmedCount = poGRNs.filter(g => g.status === 'confirmed' || g.id === grn.id).length;
    await base44.entities.PurchaseOrder.update(grn.purchase_order_id, {
      status: 'received',
      grn_count: confirmedCount,
    });
  }

  // 7. Mark GRN as confirmed
  await base44.entities.GoodsReceivedNote.update(grn.id, {
    status: 'confirmed',
    received_by_name: userName,
    total_lines: persistedLines.length,
    total_received_value: Math.round(totalValue * 100) / 100,
    has_shortages: hasShortages,
    has_rejections: hasRejections,
  });

  writeAuditLog({
    action: 'finalize',
    entity_type: 'GoodsReceivedNote',
    entity_id: grn.id,
    description: `Confirmed GRN ${grn.grn_number}: ${persistedLines.length} lines, R ${totalValue.toFixed(2)} total`,
  });

  return { success: true, totalValue, lineCount: persistedLines.length, hasShortages, hasRejections };
}