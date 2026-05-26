import { base44, adjustStockOnHand } from '@/api/base44Client';
import { writeAuditLog } from '@/lib/auditLog';
import { toast } from 'sonner';

/**
 * Pre-flight validation for GRN confirmation.
 * Returns an array of error messages. An empty array means validation passed.
 * No DB writes happen here — safe to call before confirmGRN.
 */
export function validateGRNLines(grn, lines) {
  const errors = [];

  if (!grn.location_id) {
    errors.push('A delivery location must be selected.');
  }

  const stockLines = lines.filter(l => !l.item_type || l.item_type === 'stock');
  const hasAnyQty = lines.some(l => parseFloat(l.received_qty) > 0);
  if (!hasAnyQty) {
    errors.push('No quantities have been entered. Enter received quantities before confirming this GRN.');
  }

  lines.forEach((l, idx) => {
    const lineNum = idx + 1;
    const receivedQty = parseFloat(l.received_qty);

    if (!l.product_id) {
      errors.push(`Product mapping is missing on line ${lineNum}. Map the product before confirming this GRN.`);
      return;
    }

    if ((!l.item_type || l.item_type === 'stock') && receivedQty > 0) {
      if (!l.purchase_uom) {
        errors.push(`Purchase unit of measure is missing on line ${lineNum} (${l.product_name || 'unknown product'}). This GRN cannot be confirmed.`);
      }
      if (!l.conversion_factor || parseFloat(l.conversion_factor) <= 0) {
        errors.push(`Product ${l.product_name || 'on line ' + lineNum} cannot be received because the purchase UOM has no conversion rate to the stock UOM. Update the supplier product record first.`);
      }
      if (!l.unit_cost && parseFloat(l.unit_cost) !== 0) {
        errors.push(`Product ${l.product_name || 'on line ' + lineNum} cannot be received because no unit cost has been entered. Enter a cost before confirming.`);
      }
    }
  });

  if (!grn.location_id && stockLines.some(l => parseFloat(l.received_qty) > 0)) {
    // Already added above, but add per-line message for stock items
    errors.push('Receiving location is required for stock items.');
  }

  return [...new Set(errors)]; // deduplicate
}

/**
 * Confirms a GRN:
 * 1. Validates lines (throws if validation fails — no partial writes)
 * 2. Saves all GRN lines (recalculates internal_qty, variance, line_total)
 * 3. Creates StockMovement records for each stock-type line
 * 4. Updates StockOnHand per product/location
 * 5. Updates Product.cost_avg (weighted average) and cost_current
 * 6. Creates SupplierShortage records for short lines
 * 7. Updates PO status if linked
 * 8. Marks GRN as confirmed
 */
export async function confirmGRN(grn, lines, userName) {
  // Pre-flight validation — no DB writes happen if this fails
  const validationErrors = validateGRNLines(grn, lines);
  if (validationErrors.length > 0) {
    const err = new Error('GRN validation failed');
    err.validationErrors = validationErrors;
    throw err;
  }
  // 1. Persist lines and compute derived fields
  const persistedLines = [];
  let totalValue = 0;
  let hasShortages = false;
  let hasRejections = false;
  let hasPriceVariance = false;

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

  // 2. Create stock movements + atomically update SOH (only for accepted stock lines)
  const stockLines = persistedLines.filter(l =>
    (!l.item_type || l.item_type === 'stock') && l.condition !== 'rejected' && (l.internal_qty_received || 0) > 0
  );
  const uniqueProductIds = [...new Set(stockLines.map(l => l.product_id).filter(Boolean))];
  const productList = uniqueProductIds.length > 0
    ? await base44.entities.Product.filter({ id: { $in: uniqueProductIds } })
    : [];
  const productCache = Object.fromEntries(productList.map(p => [p.id, p]));

  for (const line of persistedLines) {
    if (line.item_type && line.item_type !== 'stock') continue;
    if (line.condition === 'rejected') continue;
    if (!line.internal_qty_received || line.internal_qty_received <= 0) continue;

    const product = productCache[line.product_id];
    if (!product) continue;

    // Cost per internal (stock) unit
    const costPerStockUnit = line.unit_cost / ((line.conversion_factor || 1) * (line.yield_factor || 1)) || 0;

    // Create stock movement — unit_cost_at_movement must be per stock UOM, not purchase UOM
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
      unit_cost_at_movement: costPerStockUnit,
      notes: `GRN ${grn.grn_number} from ${grn.supplier_name}`,
    });

    // 3. Atomically update StockOnHand — the RPC computes the correct weighted average in the DB
    const updatedSoh = await adjustStockOnHand(line.product_id, grn.location_id, line.internal_qty_received, costPerStockUnit);

    // 4. FIFO: create a cost layer. Weighted average: update cost_avg from RPC result.
    if (product.costing_method === 'fifo') {
      await base44.entities.CostLayer.create({
        product_id: line.product_id,
        grn_line_id: line.id,
        received_date: grn.received_date || new Date().toISOString().slice(0, 10),
        qty_received: line.internal_qty_received,
        qty_remaining: line.internal_qty_received,
        cost_per_stock_uom: costPerStockUnit,
        is_depleted: false,
      });
      await base44.entities.Product.update(product.id, {
        cost_current: Math.round(costPerStockUnit * 100) / 100,
      });
    } else {
      // cost_current always reflects the latest receipt price (useful for price-creep tracking).
      const newCostAvg = updatedSoh?.cost_avg ?? costPerStockUnit;
      productCache[product.id] = { ...product, cost_avg: newCostAvg }; // keep cache warm for multi-line GRNs
      await base44.entities.Product.update(product.id, {
        cost_avg: Math.round(newCostAvg * 10000) / 10000,
        cost_current: Math.round(costPerStockUnit * 100) / 100,
      });
    }
  }

  // 4b. Price variance tracking — write SupplierPriceHistory and flag lines
  const skippedPriceNames = [];
  for (const line of persistedLines) {
    if (!line.supplier_product_id) continue;
    const unitCost = parseFloat(line.unit_cost) || 0;
    if (unitCost <= 0) continue;

    // Fetch the supplier product to get last_purchase_price and threshold
    let sp;
    try {
      const spList = await base44.entities.SupplierProduct.filter({ id: line.supplier_product_id });
      sp = spList[0];
    } catch (err) {
      console.warn(`[GRNConfirmLogic] Could not fetch SupplierProduct for line ${line.product_name}:`, err);
    }
    if (!sp) {
      skippedPriceNames.push(line.product_name || line.product_sku || line.product_id);
      continue;
    }

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
      hasPriceVariance = true;
      await base44.entities.GRNLine.update(line.id, { price_variance_flagged: true });
    }
  }

  if (skippedPriceNames.length > 0) {
    toast.warning(`Price history skipped — missing Supplier Product link for: ${skippedPriceNames.join(', ')}`);
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
      supplier_product_id: line.supplier_product_id || null,
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
    has_price_variance: hasPriceVariance,
  });

  writeAuditLog({
    action: 'finalize',
    entity_type: 'GoodsReceivedNote',
    entity_id: grn.id,
    description: `Confirmed GRN ${grn.grn_number}: ${persistedLines.length} lines, R ${totalValue.toFixed(2)} total`,
  });

  return { success: true, totalValue, lineCount: persistedLines.length, hasShortages, hasRejections };
}