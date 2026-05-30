import { base44, adjustStockOnHand } from '@/api/base44Client';
import { writeAuditLog } from '@/lib/auditLog';
import { upsertShortage, reconcileAwaitShortages } from '@/lib/shortageEngine';
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
    ? (await Promise.allSettled(
        uniqueProductIds.map(id => base44.entities.Product.filter({ id }))
      ))
      .filter(r => r.status === 'fulfilled' && Array.isArray(r.value) && r.value.length > 0)
      .map(r => r.value[0])
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
    try {
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
    } catch (stepErr) {
      console.warn('[GRNConfirmLogic] Step failed (non-fatal):', stepErr?.message);
    }

    // 3. Atomically update StockOnHand — the RPC computes the correct weighted average in the DB
    let updatedSoh;
    try {
      updatedSoh = await adjustStockOnHand(line.product_id, grn.location_id, line.internal_qty_received, costPerStockUnit);
    } catch (stepErr) {
      console.warn('[GRNConfirmLogic] Step failed (non-fatal):', stepErr?.message);
    }

    // 4. FIFO: create a cost layer. Weighted average: update cost_avg from RPC result.
    if (product.costing_method === 'fifo') {
      try {
        await base44.entities.CostLayer.create({
          product_id: line.product_id,
          grn_line_id: line.id,
          received_date: grn.received_date || new Date().toISOString().slice(0, 10),
          qty_received: line.internal_qty_received,
          qty_remaining: line.internal_qty_received,
          cost_per_stock_uom: costPerStockUnit,
          is_depleted: false,
        });
      } catch (stepErr) {
        console.warn('[GRNConfirmLogic] Step failed (non-fatal):', stepErr?.message);
      }
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
    try {
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
    } catch (stepErr) {
      console.warn('[GRNConfirmLogic] Step failed (non-fatal):', stepErr?.message);
    }

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
    try {
      toast.warning(`Price history skipped — missing Supplier Product link for: ${skippedPriceNames.join(', ')}`);
    } catch (_) {}
  }

  // 5. Detect short-received stock lines (not rejected)
  const shortStockLines = persistedLines.filter(l =>
    parseFloat(l.received_qty) < parseFloat(l.expected_qty) &&
    (!l.item_type || l.item_type === 'stock') &&
    l.condition !== 'rejected' &&
    l.id  // must have an id to be actionable
  );

  // If there are short lines, pause and ask the user what to do
  if (shortStockLines.length > 0) {
    return { requiresDecision: true, shortLines: shortStockLines, persistedLines, grn, totalValue, hasShortages, hasRejections, hasPriceVariance };
  }

  // 6. Update PO status if linked (no shortages path — all items fully received)
  if (grn.purchase_order_id) {
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

  // Reconcile PO line totals + auto-resolve any await shortage now fully received
  if (grn.purchase_order_id) {
    try { await reconcileAwaitShortages(grn.purchase_order_id); } catch (_) {}
  }

  return { success: true, totalValue, lineCount: persistedLines.length, hasShortages, hasRejections };
}

/**
 * Finalises a GRN after the user has made short-receival decisions.
 * decisions = { [lineId]: 'receive_later' | 'request_credit' }
 */
export async function finaliseGRNWithDecisions(grn, persistedLines, decisions, userName) {
  // Decisions may be a plain action string or { action, expected_delivery_date }.
  const norm = {};
  for (const [id, v] of Object.entries(decisions)) {
    norm[id] = (typeof v === 'string') ? { action: v } : (v || {});
  }
  const shortLineIds = Object.keys(norm);

  // 1. Persist short_receival_action on each short line
  for (const lineId of shortLineIds) {
    await base44.entities.GRNLine.update(lineId, {
      short_receival_action: norm[lineId].action,
    });
  }

  // 2. Upsert the ONE central shortage record per short PO line for every decision
  //    type, so each short receival is tracked in Shortages immediately (keyed on
  //    po_line_id). 'await'/'credit'/'split'/'review' all supported.
  for (const lineId of shortLineIds) {
    const dec = norm[lineId] || {};
    const action = dec.action;
    // accept both legacy 'receive_later' and 'await_receival' for the await decision
    const isAwait = action === 'receive_later' || action === 'await_receival';
    if (!isAwait && !['request_credit', 'split', 'review'].includes(action)) continue;
    const line = persistedLines.find(l => l.id === lineId);
    if (!line) continue;
    const orderedQty = parseFloat(line.expected_qty) || 0;
    const receivedQty = parseFloat(line.received_qty) || 0;
    const fields = {
      poLineId: line.po_line_id || null,
      purchaseOrderId: grn.purchase_order_id || null,
      productId: line.product_id,
      grn_id: grn.id,
      grn_line_id: line.id,
      supplier_id: grn.supplier_id,
      supplier_name: grn.supplier_name,
      supplier_product_id: line.supplier_product_id || null,
      product_name: line.product_name,
      product_sku: line.product_sku,
      ordered_qty: orderedQty,
      received_qty: receivedQty,
      purchase_uom: line.purchase_uom || '',
      unit_cost: parseFloat(line.unit_cost) || 0,
      status: 'open',
    };
    if (action === 'request_credit') {
      await upsertShortage({ ...fields, decision: 'request_credit', credit_follow_up_status: 'credit_required', awaiting_qty: 0, credit_qty: (orderedQty - receivedQty) });
    } else if (action === 'split') {
      // Part awaited, part credited — both tracked on the one shortage record
      await upsertShortage({
        ...fields,
        decision: 'split',
        credit_follow_up_status: 'credit_required',
        awaiting_qty: parseFloat(dec.awaiting_qty) || 0,
        credit_qty: parseFloat(dec.credit_qty) || 0,
        expected_delivery_date: dec.expected_delivery_date || null,
      });
    } else if (action === 'review') {
      await upsertShortage({ ...fields, decision: 'review' });
    } else {
      // await remaining receival — capture the expected next-delivery date
      await upsertShortage({ ...fields, decision: 'await_receival', awaiting_qty: (orderedQty - receivedQty), credit_qty: 0, expected_delivery_date: dec.expected_delivery_date || null });
    }
  }

  // 3. Compute summary flags across all persisted lines
  const totalValue = persistedLines.reduce((s, l) => s + (l.line_total || 0), 0);
  const hasShortages = persistedLines.some(l =>
    l.expected_qty != null && parseFloat(l.received_qty) < parseFloat(l.expected_qty)
  );
  const hasRejections = persistedLines.some(l => l.condition === 'damaged' || l.condition === 'rejected');
  const hasPriceVariance = persistedLines.some(l => l.price_variance_flagged);

  // 4. Update PO status if linked — status depends on what the user decided for short lines
  if (grn.purchase_order_id) {
    const poGRNs = await base44.entities.GoodsReceivedNote.filter({ purchase_order_id: grn.purchase_order_id });
    const confirmedCount = poGRNs.filter(g => g.status === 'confirmed' || g.id === grn.id).length;

    const decisionValues = shortLineIds.map(id => norm[id].action);
    let newStatus;
    if (decisionValues.some(d => d === 'request_credit' || d === 'split')) {
      // Any credit-note (or split, which has a credit part) decision → credit pending
      newStatus = 'credit_note_pending';
    } else if (decisionValues.some(d => d === 'receive_later' || d === 'await_receival' || d === 'review')) {
      // Still waiting on stock (or flagged for review) — PO stays open
      newStatus = 'partially_received';
    } else {
      newStatus = 'received';
    }

    await base44.entities.PurchaseOrder.update(grn.purchase_order_id, {
      status: newStatus,
      grn_count: confirmedCount,
    });
  }

  // 5. Mark GRN as confirmed
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
    description: `Confirmed GRN ${grn.grn_number} with short-receival decisions: ${persistedLines.length} lines, R ${totalValue.toFixed(2)} total`,
  });

  // Reconcile PO line totals + auto-resolve any await shortage now fully received
  if (grn.purchase_order_id) {
    try { await reconcileAwaitShortages(grn.purchase_order_id); } catch (_) {}
  }

  return { success: true, totalValue, lineCount: persistedLines.length, hasShortages, hasRejections };
}

/**
 * Deletes a GRN and reverses everything it did, so the PO returns to a clean state
 * and a fresh GRN can be created:
 *  1. Reverses stock (negative SOH adjustment + cancellation_reversal movement) for
 *     confirmed GRNs.
 *  2. Deletes shortage records anchored on this GRN.
 *  3. Deletes the GRN lines.
 *  4. Recomputes each PO line's received_qty from the REMAINING confirmed GRNs and
 *     resets the PO status (approved / partially_received / received).
 *  5. Deletes the GRN row.
 */
export async function deleteGRN(grn) {
  const lines = await base44.entities.GRNLine.filter({ grn_id: grn.id }, 'product_name', 200);

  // 1. Reverse stock for confirmed GRNs
  if (grn.status === 'confirmed') {
    const stockLines = lines.filter(l =>
      (!l.item_type || l.item_type === 'stock') &&
      l.condition !== 'rejected' &&
      (parseFloat(l.internal_qty_received) || 0) > 0
    );
    const productIds = [...new Set(stockLines.map(l => l.product_id).filter(Boolean))];
    const productCache = {};
    if (productIds.length) {
      const results = await Promise.allSettled(productIds.map(id => base44.entities.Product.filter({ id })));
      results.forEach(r => { if (r.status === 'fulfilled' && r.value?.[0]) productCache[r.value[0].id] = r.value[0]; });
    }
    for (const line of stockLines) {
      const internalQty = parseFloat(line.internal_qty_received) || 0;
      const product = productCache[line.product_id];
      try {
        await adjustStockOnHand(line.product_id, grn.location_id, -internalQty, null);
        await base44.entities.StockMovement.create({
          product_id: line.product_id,
          product_sku: line.product_sku || product?.sku || '',
          product_name: line.product_name || product?.name || '',
          from_location_id: grn.location_id,
          qty: internalQty,
          uom: product?.stock_uom || 'unit',
          reason: 'cancellation_reversal',
          ref_type: 'grn',
          ref_id: grn.id,
          ref_number: grn.grn_number,
          reference_key: `grn-reversal:${grn.id}:${line.id}`,
          unit_cost_at_movement: 0,
          notes: `Reversal — deleted GRN ${grn.grn_number}`,
        });
      } catch (e) { console.warn('[deleteGRN] stock reversal failed:', e?.message); }
    }
  }

  // 2. Delete shortages anchored on this GRN
  try {
    const grnShortages = await base44.entities.SupplierShortage.filter({ grn_id: grn.id }, '-created_date', 100);
    for (const s of grnShortages) await base44.entities.SupplierShortage.delete(s.id);
  } catch (e) { console.warn('[deleteGRN] shortage cleanup failed:', e?.message); }

  // 3. Delete the GRN lines
  for (const line of lines) {
    try { await base44.entities.GRNLine.delete(line.id); } catch (e) { /* ignore */ }
  }

  // 4. Recompute PO line received_qty + PO status from remaining confirmed GRNs
  if (grn.purchase_order_id) {
    const poLines = await base44.entities.PurchaseOrderLine.filter({ purchase_order_id: grn.purchase_order_id }, 'created_date', 200);
    const allPoGRNs = await base44.entities.GoodsReceivedNote.filter({ purchase_order_id: grn.purchase_order_id }, '-received_date', 50);
    const remainingConfirmed = allPoGRNs.filter(g => g.id !== grn.id && g.status === 'confirmed');

    let remainingLines = [];
    if (remainingConfirmed.length) {
      const chunks = await Promise.all(remainingConfirmed.map(g => base44.entities.GRNLine.filter({ grn_id: g.id }, 'product_name', 200)));
      remainingLines = chunks.flat();
    }
    const receivedByPoLine = {};
    remainingLines.forEach(l => {
      if (l.po_line_id) receivedByPoLine[l.po_line_id] = (receivedByPoLine[l.po_line_id] || 0) + (parseFloat(l.received_qty) || 0);
    });

    for (const pl of poLines) {
      const newReceived = receivedByPoLine[pl.id] || 0;
      if ((parseFloat(pl.received_qty) || 0) !== newReceived) {
        await base44.entities.PurchaseOrderLine.update(pl.id, { received_qty: newReceived });
      }
    }

    const anyReceived = poLines.some(pl => (receivedByPoLine[pl.id] || 0) > 0);
    const allReceived = poLines.length > 0 && poLines.every(pl => (receivedByPoLine[pl.id] || 0) >= (parseFloat(pl.ordered_qty) || 0));
    const status = allReceived ? 'received' : anyReceived ? 'partially_received' : 'approved';
    await base44.entities.PurchaseOrder.update(grn.purchase_order_id, { status, grn_count: remainingConfirmed.length });
  }

  // 5. Delete the GRN itself
  await base44.entities.GoodsReceivedNote.delete(grn.id);

  writeAuditLog({
    action: 'delete',
    entity_type: 'GoodsReceivedNote',
    entity_id: grn.id,
    description: `Deleted GRN ${grn.grn_number} — stock reversed, PO received quantities recomputed`,
  });
}