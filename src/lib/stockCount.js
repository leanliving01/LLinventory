import { base44 } from '@/api/base44Client';
import { nextDocNumber } from '@/lib/docNumbering';

// Reviewed stock-count workflow (Build 1).
// Floor counts NEVER touch stock-on-hand — they are reviewed and posted from the web.

export const COUNT_STATUS = {
  draft: 'Draft',
  open: 'Open',
  in_progress: 'In Progress',
  floor_completed: 'Floor Completed',
  under_review: 'Under Web Review',
  recount_requested: 'Recount Requested',
  recount_in_progress: 'Recount In Progress',
  completed: 'Completed / Posted',
  cancelled: 'Cancelled',
};

// Statuses where the count is still being captured on the floor.
export const FLOOR_OPEN_STATUSES = ['open', 'in_progress'];
export const RECOUNT_STATUSES = ['recount_requested', 'recount_in_progress'];
// All statuses where the floor may edit counts (initial capture or recount).
export const FLOOR_EDITABLE_STATUSES = [...FLOOR_OPEN_STATUSES, ...RECOUNT_STATUSES];

const round = (n, dp = 2) => {
  const f = 10 ** dp;
  return Math.round((Number(n) || 0) * f) / f;
};

const costOf = (product) =>
  Number(product?.cost_avg) || Number(product?.cost_current) || 0;

// ---------------------------------------------------------------------------
// Create a count (planned or live) and seed one line per product that has stock
// at the selected location (optionally narrowed to an item group / category).
// ---------------------------------------------------------------------------
async function createCount({ location, date, countType, status, itemGroup, assignedTo, assignedToName }) {
  const reference = await nextDocNumber('SCN');

  // Candidate products = those with a stock-on-hand row at this location.
  const sohRows = await base44.entities.StockOnHand.filter({ location_id: location.id }, 'product_name', 5000);
  const products = await base44.entities.Product.filter({ status: 'active' }, 'name', 5000);
  const productById = Object.fromEntries(products.map(p => [p.id, p]));

  // De-dupe to one line per product; apply optional item-group (category) filter.
  const seen = new Set();
  const candidates = [];
  for (const soh of sohRows) {
    if (!soh.product_id || seen.has(soh.product_id)) continue;
    const product = productById[soh.product_id];
    if (itemGroup && itemGroup !== 'all' && product?.category !== itemGroup) continue;
    seen.add(soh.product_id);
    candidates.push({ soh, product });
  }

  // Default Stock Count UOM per product (falls back to the main stock UOM).
  const productIds = candidates.map(c => c.soh.product_id);
  const countUoms = productIds.length
    ? await base44.entities.StockCountUom.filter({ product_id: productIds }, 'count_uom', 5000)
    : [];
  const defaultUomByProduct = {};
  countUoms.forEach(u => { if (u.is_default && !defaultUomByProduct[u.product_id]) defaultUomByProduct[u.product_id] = u; });

  const header = await base44.entities.NewStockTake.create({
    reference,
    stocktake_date: date,
    location_id: location.id,
    location_name: location.name,
    status,
    count_type: countType,
    item_group: itemGroup && itemGroup !== 'all' ? itemGroup : null,
    assigned_to: assignedTo || null,
    assigned_to_name: assignedToName || null,
    total_lines: candidates.length,
    uncounted_count: candidates.length,
  });

  if (candidates.length) {
    await base44.entities.StockTakeLine.bulkCreate(candidates.map(({ soh, product }) => {
      const stockUom = product?.stock_uom || soh.uom || 'pcs';
      const def = defaultUomByProduct[soh.product_id];
      return {
        stocktake_id: header.id,
        product_id: soh.product_id,
        product_sku: soh.product_sku || product?.sku || '',
        product_name: soh.product_name || product?.name || '',
        stock_uom: stockUom,
        count_uom: def?.count_uom || stockUom,
        count_uom_label: def?.count_uom_label || '',
        conversion_factor: def ? (Number(def.conversion_factor) || 1) : 1,
        counted: false,
        count_attempt: 1,
      };
    }));
  }

  return header;
}

// Web: planned count (status Open — appears on the floor under Planned Counts).
export function createPlannedCount({ location, date, itemGroup, assignedTo, assignedToName }) {
  return createCount({ location, date, countType: 'planned', status: 'open', itemGroup, assignedTo, assignedToName });
}

// Floor: live count started on the floor (status In Progress immediately).
export function createLiveCount({ location, assignedTo, assignedToName }) {
  return createCount({
    location,
    date: new Date().toISOString().slice(0, 10),
    countType: 'live',
    status: 'in_progress',
    assignedTo,
    assignedToName,
  });
}

// ---------------------------------------------------------------------------
// Floor: persist entered counts. Updates existing lines; never writes SOH.
// `entries` = [{ id, counted_qty }]. Sets header → in_progress.
// ---------------------------------------------------------------------------
export async function saveFloorCounts(countId, entries, userName) {
  const now = new Date().toISOString();
  const updates = entries.map(e => ({
    id: e.id,
    counted_qty: e.counted_qty === '' || e.counted_qty == null ? null : Number(e.counted_qty),
    counted: e.counted_qty !== '' && e.counted_qty != null,
    counted_at: now,
    counted_by: userName || null,
    // Persist the chosen count UOM + conversion when the floor user switched units.
    ...(e.count_uom ? {
      count_uom: e.count_uom,
      count_uom_label: e.count_uom_label ?? null,
      conversion_factor: Number(e.conversion_factor) || 1,
    } : {}),
  }));
  if (updates.length) await base44.entities.StockTakeLine.bulkUpdate(updates);

  const header = await base44.entities.NewStockTake.filter({ id: countId }).then(r => r[0]);
  if (header) {
    if (FLOOR_OPEN_STATUSES.includes(header.status) && header.status !== 'in_progress') {
      await base44.entities.NewStockTake.update(countId, { status: 'in_progress' });
    } else if (RECOUNT_STATUSES.includes(header.status) && header.status !== 'recount_in_progress') {
      await base44.entities.NewStockTake.update(countId, { status: 'recount_in_progress' });
    }
  }
}

// Add a product found during counting that wasn't in the seeded list.
export async function addCountLine(countId, product) {
  return base44.entities.StockTakeLine.create({
    stocktake_id: countId,
    product_id: product.id,
    product_sku: product.sku || '',
    product_name: product.name || '',
    stock_uom: product.stock_uom || 'pcs',
    count_uom: product.stock_uom || 'pcs',
    conversion_factor: 1,
    counted: false,
    count_attempt: 1,
  });
}

// ---------------------------------------------------------------------------
// Floor: complete the count → snapshot system qty (silently), compute converted
// qty, push to web review. No SOH change.
// ---------------------------------------------------------------------------
export async function completeFloorCount(countId, userName) {
  const header = await base44.entities.NewStockTake.filter({ id: countId }).then(r => r[0]);
  if (!header) throw new Error('Count not found');
  const lines = await base44.entities.StockTakeLine.filter({ stocktake_id: countId }, 'product_name', 5000);
  const sohRows = await base44.entities.StockOnHand.filter({ location_id: header.location_id }, 'product_name', 5000);

  const systemByProduct = {};
  sohRows.forEach(s => { systemByProduct[s.product_id] = (systemByProduct[s.product_id] || 0) + (Number(s.qty_on_hand) || 0); });

  const counted = lines.filter(l => l.counted && l.counted_qty != null);
  const updates = counted.map(l => {
    const cf = Number(l.conversion_factor) || 1;
    const converted = round((Number(l.counted_qty) || 0) * cf, 3);
    return {
      id: l.id,
      system_qty: round(systemByProduct[l.product_id] || 0, 3),
      converted_qty: converted,
      recount_requested: false, // resolved — clears the flag after a recount
    };
  });
  if (updates.length) await base44.entities.StockTakeLine.bulkUpdate(updates);

  await base44.entities.NewStockTake.update(countId, {
    status: 'under_review',
    uncounted_count: lines.length - counted.length,
    submitted_by: userName || null,
    submitted_at: new Date().toISOString(),
  });
}

// ---------------------------------------------------------------------------
// Web: request a recount of selected lines. Keeps the previous floor count for
// comparison, clears the counted value so the floor re-enters it, and bumps the
// attempt counter. Header → recount_requested.
// ---------------------------------------------------------------------------
export async function requestRecount(countId, lineIds, userName) {
  const lines = await base44.entities.StockTakeLine.filter({ stocktake_id: countId }, 'product_name', 5000);
  const targets = lines.filter(l => lineIds.includes(l.id));
  if (!targets.length) throw new Error('Select at least one item to recount');

  await base44.entities.StockTakeLine.bulkUpdate(targets.map(l => ({
    id: l.id,
    previous_counted_qty: l.counted_qty,
    counted_qty: null,
    converted_qty: null,
    counted: false,
    recount_requested: true,
    count_attempt: (Number(l.count_attempt) || 1) + 1,
  })));

  await base44.entities.NewStockTake.update(countId, {
    status: 'recount_requested',
    uncounted_count: targets.length,
    reviewed_by: userName || null,
    reviewed_at: new Date().toISOString(),
  });
}

// ---------------------------------------------------------------------------
// Compute the variance view for a set of lines (web review).
// ---------------------------------------------------------------------------
export function buildVarianceRows(lines, productById) {
  return lines
    .filter(l => l.counted && l.counted_qty != null)
    .map(l => {
      const product = productById[l.product_id];
      const cf = Number(l.conversion_factor) || 1;
      const converted = l.converted_qty != null ? Number(l.converted_qty) : round((Number(l.counted_qty) || 0) * cf, 3);
      const system = Number(l.system_qty) || 0;
      const variance = round(converted - system, 3);
      const unitCost = l.unit_cost != null ? Number(l.unit_cost) : costOf(product);
      return {
        ...l,
        _converted: converted,
        _system: system,
        _variance: variance,
        _unitCost: unitCost,
        _varianceValue: round(variance * unitCost, 2),
      };
    });
}

// ---------------------------------------------------------------------------
// Web: post the reviewed count → overwrite SOH with the counted qty (in the main
// stock UOM), create movements for non-zero variances, lock the count.
// ---------------------------------------------------------------------------
export async function postStockCount(countId, userName) {
  const header = await base44.entities.NewStockTake.filter({ id: countId }).then(r => r[0]);
  if (!header) throw new Error('Count not found');
  if (header.status === 'completed') throw new Error('Count is already posted');

  const lines = await base44.entities.StockTakeLine.filter({ stocktake_id: countId }, 'product_name', 5000);
  const products = await base44.entities.Product.filter({ status: 'active' }, 'name', 5000);
  const productById = Object.fromEntries(products.map(p => [p.id, p]));
  const sohRows = await base44.entities.StockOnHand.filter({ location_id: header.location_id }, 'product_name', 5000);
  const sohByProduct = {};
  sohRows.forEach(s => { if (!sohByProduct[s.product_id]) sohByProduct[s.product_id] = s; });

  const rows = buildVarianceRows(lines, productById);
  let totalVarianceRand = 0;
  const now = new Date().toISOString();

  for (const r of rows) {
    const converted = r._converted;
    const variance = r._variance;
    const unitCost = r._unitCost;
    totalVarianceRand = round(totalVarianceRand + r._varianceValue, 2);

    // Persist variance figures back onto the line (locked report basis).
    await base44.entities.StockTakeLine.update(r.id, {
      converted_qty: converted,
      variance_qty: variance,
      variance_rand: r._varianceValue,
      unit_cost: unitCost,
    });

    if (variance === 0) continue;

    const product = productById[r.product_id];
    await base44.entities.StockMovement.create({
      product_id: r.product_id,
      product_sku: r.product_sku || product?.sku || '',
      product_name: r.product_name || product?.name || '',
      qty: Math.abs(variance),
      uom: r.stock_uom || product?.stock_uom || 'pcs',
      reason: 'stocktake_adjustment',
      ref_type: 'stock_take',
      ref_id: countId,
      ref_number: header.reference || header.id,
      unit_cost_at_movement: unitCost,
      to_location_id: variance > 0 ? header.location_id : undefined,
      from_location_id: variance < 0 ? header.location_id : undefined,
      notes: `Stock count ${header.reference}: system ${r._system}, counted ${converted} ${r.stock_uom || ''}`.trim(),
    });

    // Overwrite SOH absolute to the counted qty (in the main stock UOM).
    const existing = sohByProduct[r.product_id];
    if (existing) {
      await base44.entities.StockOnHand.update(existing.id, {
        qty_on_hand: converted,
        qty_available: converted - (Number(existing.qty_committed) || 0),
        last_updated_at: now,
      });
    } else if (converted > 0) {
      await base44.entities.StockOnHand.create({
        product_id: r.product_id,
        product_sku: r.product_sku || product?.sku || '',
        product_name: r.product_name || product?.name || '',
        location_id: header.location_id,
        location_name: header.location_name || '',
        qty_on_hand: converted,
        qty_committed: 0,
        qty_available: converted,
        uom: r.stock_uom || product?.stock_uom || 'pcs',
        last_updated_at: now,
      });
    }
  }

  await base44.entities.NewStockTake.update(countId, {
    status: 'completed',
    total_variance_rand: totalVarianceRand,
    reviewed_by: userName || null,
    reviewed_at: now,
    posted_by: userName || null,
    posted_at: now,
  });
}

export async function cancelStockCount(countId) {
  await base44.entities.NewStockTake.update(countId, { status: 'cancelled' });
}
