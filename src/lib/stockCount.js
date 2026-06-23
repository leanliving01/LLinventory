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
// A count that is still "live" — blocks a duplicate count for the same location.
export const ACTIVE_STATUSES = [
  'open', 'in_progress', 'floor_completed', 'under_review',
  'recount_requested', 'recount_in_progress',
];

const round = (n, dp = 2) => {
  const f = 10 ** dp;
  return Math.round((Number(n) || 0) * f) / f;
};

// Total stock-UOM quantity a counted line represents:
//   counted_qty (whole count-UOM units) * conversion_factor
//   + broken_units (loose / open remainder, already measured in the main stock UOM)
// e.g. 110 x 2kg packets + 0.3kg from an open packet = 220.3 kg on hand.
export function convertedFromLine(countedQty, conversionFactor, brokenUnits = 0) {
  const cf = Number(conversionFactor) || 1;
  const cq = Number(countedQty) || 0;
  const bu = Number(brokenUnits) || 0;
  return round(cq * cf + bu, 3);
}

const costOf = (product) =>
  Number(product?.cost_avg) || Number(product?.cost_current) || 0;

// ---------------------------------------------------------------------------
// Create a count (planned or live) and seed one line per product that has stock
// at the selected location (optionally narrowed to an item group / category).
// ---------------------------------------------------------------------------
async function createCount({ location, locationScopeIds, date, countType, status, itemGroup, subItemGroups, countName, assignedTo, assignedToName }) {
  const cat = itemGroup && itemGroup !== 'all' ? itemGroup : null;
  const subCats = subItemGroups && subItemGroups.length > 0 ? subItemGroups : null;
  // scope: by location (all categories), by location + category, or by category (all locations).
  const scope = location ? (cat ? 'location_category' : 'location') : 'category';
  if (!location && !cat) throw new Error('Pick a location or a category to count');

  // Guard: don't allow two overlapping active counts (avoids confusion).
  if (location) {
    const existing = await base44.entities.NewStockTake.filter({ location_id: location.id }, '-created_date', 200);
    const active = existing.find(c => ACTIVE_STATUSES.includes(c.status));
    if (active) {
      throw new Error(`An active count (${active.reference || 'in progress'}) already exists for ${location.name}. Complete or cancel it first.`);
    }
  } else {
    const existing = await base44.entities.NewStockTake.filter({ item_group: cat }, '-created_date', 200);
    const active = existing.find(c => ACTIVE_STATUSES.includes(c.status) && c.location_id == null);
    if (active) {
      throw new Error(`An active count (${active.reference || 'in progress'}) already exists for category "${cat}". Complete or cancel it first.`);
    }
  }

  const reference = await nextDocNumber('SCN');

  // Candidate stock-on-hand rows.
  // By location → use provided scope ids (all zones in warehouse, or just the zone); by category → every location.
  let sohRows;
  if (location) {
    const scopeIds = locationScopeIds && locationScopeIds.length > 0 ? locationScopeIds : [location.id];
    sohRows = scopeIds.length === 1
      ? await base44.entities.StockOnHand.filter({ location_id: scopeIds[0] }, 'product_name', 5000)
      : await base44.entities.StockOnHand.filter({ location_id: scopeIds }, 'product_name', 5000);
  } else {
    sohRows = await base44.entities.StockOnHand.list('product_name', 20000);
  }
  const products = await base44.entities.Product.filter({ status: 'active' }, 'name', 5000);
  const productById = Object.fromEntries(products.map(p => [p.id, p]));

  // Build candidates.
  // Category-only scope: one line per product at its default_location_id — prevents a product
  // with incidental SOH in 4 locations from generating 4 count lines when counting by category.
  // Falls back to the row with the highest qty if no default location is set on the product.
  // Location scope: one line per product+location (existing behaviour, keeps every zone).
  const seen = new Set();
  const candidates = [];

  if (!location) {
    // Category-only: group SOH rows by product, then pick one authoritative row per product.
    const sohByProduct = {};
    for (const soh of sohRows) {
      if (!soh.product_id || !soh.location_id) continue;
      const product = productById[soh.product_id];
      if (cat && product?.type !== cat) continue;
      if (subCats && !subCats.includes((product?.subcategory || '').trim())) continue;
      if (!sohByProduct[soh.product_id]) sohByProduct[soh.product_id] = [];
      sohByProduct[soh.product_id].push(soh);
    }
    for (const [pid, rows] of Object.entries(sohByProduct)) {
      if (seen.has(pid)) continue;
      seen.add(pid);
      const product = productById[pid];
      const defaultLocId = product?.default_location_id;
      const pick = (defaultLocId && rows.find(s => s.location_id === defaultLocId))
                   || rows.reduce((best, s) =>
                     (Number(s.qty_on_hand) || 0) >= (Number(best.qty_on_hand) || 0) ? s : best, rows[0]);
      candidates.push({ soh: pick, product });
    }
  } else {
    // Location (or location+category): one line per product+location.
    for (const soh of sohRows) {
      if (!soh.product_id || !soh.location_id) continue;
      const key = `${soh.product_id}_${soh.location_id}`;
      if (seen.has(key)) continue;
      const product = productById[soh.product_id];
      if (cat && product?.type !== cat) continue;
      if (subCats && !subCats.includes((product?.subcategory || '').trim())) continue;
      seen.add(key);
      candidates.push({ soh, product });
    }
  }

  // Default Stock Count UOM per product (falls back to the main stock UOM).
  const productIds = [...new Set(candidates.map(c => c.soh.product_id))];
  const countUoms = productIds.length
    ? await base44.entities.StockCountUom.filter({ product_id: productIds }, 'count_uom', 5000)
    : [];
  const defaultUomByProduct = {};
  countUoms.forEach(u => { if (u.is_default && !defaultUomByProduct[u.product_id]) defaultUomByProduct[u.product_id] = u; });

  const header = await base44.entities.NewStockTake.create({
    reference,
    count_name: countName || null,
    stocktake_date: date,
    location_id: location?.id || null,
    location_name: location?.name || 'All locations',
    scope,
    status,
    count_type: countType,
    item_group: cat,
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
        location_id: soh.location_id,
        location_name: soh.location_name || location?.name || '',
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
// `location` may be null for a category-across-all-locations count.
// `locationScopeIds` expands a warehouse into all its stock-bearing zone ids.
// `subItemGroup` is an optional subcategory filter within the chosen type.
export function createPlannedCount({ location, locationScopeIds, date, countName, itemGroup, subItemGroups, assignedTo, assignedToName }) {
  return createCount({ location, locationScopeIds, date, countType: 'planned', status: 'open', countName, itemGroup, subItemGroups, assignedTo, assignedToName });
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
// Web: create a count from a validated CSV. Rows are already matched to products
// with a count UOM + conversion factor. Lands directly Under Review.
// `rows` = [{ product_id, product_sku, product_name, stock_uom, count_uom,
//             count_uom_label, conversion_factor, counted_qty }]
// ---------------------------------------------------------------------------
export async function createCsvCount({ location, date, rows, userName }) {
  const reference = await nextDocNumber('SCN');

  const sohRows = await base44.entities.StockOnHand.filter({ location_id: location.id }, 'product_name', 5000);
  const systemByProduct = {};
  sohRows.forEach(s => { systemByProduct[s.product_id] = (systemByProduct[s.product_id] || 0) + (Number(s.qty_on_hand) || 0); });

  const header = await base44.entities.NewStockTake.create({
    reference,
    stocktake_date: date || new Date().toISOString().slice(0, 10),
    location_id: location.id,
    location_name: location.name,
    status: 'under_review',
    count_type: 'planned',
    total_lines: rows.length,
    uncounted_count: 0,
    submitted_by: userName || null,
    submitted_at: new Date().toISOString(),
  });

  if (rows.length) {
    await base44.entities.StockTakeLine.bulkCreate(rows.map(r => {
      const cf = Number(r.conversion_factor) || 1;
      const qty = Number(r.counted_qty) || 0;
      return {
        stocktake_id: header.id,
        product_id: r.product_id,
        product_sku: r.product_sku || '',
        product_name: r.product_name || '',
        location_id: location.id,
        location_name: location.name,
        stock_uom: r.stock_uom || 'pcs',
        count_uom: r.count_uom || r.stock_uom || 'pcs',
        count_uom_label: r.count_uom_label || '',
        conversion_factor: cf,
        counted_qty: qty,
        converted_qty: round(qty * cf, 3),
        system_qty: round(systemByProduct[r.product_id] || 0, 3),
        counted: true,
        count_attempt: 1,
      };
    }));
  }

  return header;
}

// ---------------------------------------------------------------------------
// Floor: persist entered counts. Updates existing lines; never writes SOH.
// `entries` = [{ id, counted_qty }]. Sets header → in_progress.
// ---------------------------------------------------------------------------
export async function saveFloorCounts(countId, entries, userName) {
  const now = new Date().toISOString();
  const updates = entries.map(e => {
    const qty = e.counted_qty === '' || e.counted_qty == null ? null : Number(e.counted_qty);
    const broken = e.broken_units === '' || e.broken_units == null ? 0 : (Number(e.broken_units) || 0);
    const hasBroken = broken > 0;
    return {
      id: e.id,
      // A line counted purely as loose stock (0 full units + a broken remainder)
      // still counts — store qty as 0 rather than null so it posts.
      counted_qty: qty == null && hasBroken ? 0 : qty,
      broken_units: broken,
      counted: qty != null || hasBroken,
      counted_at: now,
      counted_by: userName || null,
      // Persist the chosen count UOM + conversion when the user switched units.
      ...(e.count_uom ? {
        count_uom: e.count_uom,
        count_uom_label: e.count_uom_label ?? null,
        conversion_factor: Number(e.conversion_factor) || 1,
      } : {}),
    };
  });
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
export async function addCountLine(countId, product, locationId, locationName) {
  return base44.entities.StockTakeLine.create({
    stocktake_id: countId,
    product_id: product.id,
    product_sku: product.sku || '',
    product_name: product.name || '',
    location_id: locationId || null,
    location_name: locationName || null,
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

  // System qty snapshot per product+location (each line carries its own location).
  const locIds = [...new Set(lines.map(l => l.location_id || header.location_id).filter(Boolean))];
  const sohRows = locIds.length
    ? await base44.entities.StockOnHand.filter({ location_id: locIds }, 'product_name', 20000)
    : [];
  const systemByKey = {};
  sohRows.forEach(s => {
    const k = `${s.product_id}_${s.location_id}`;
    systemByKey[k] = (systemByKey[k] || 0) + (Number(s.qty_on_hand) || 0);
  });

  const counted = lines.filter(l => l.counted && l.counted_qty != null);
  const updates = counted.map(l => {
    const converted = convertedFromLine(l.counted_qty, l.conversion_factor, l.broken_units);
    const loc = l.location_id || header.location_id;
    return {
      id: l.id,
      system_qty: round(systemByKey[`${l.product_id}_${loc}`] || 0, 3),
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
      const converted = l.converted_qty != null
        ? Number(l.converted_qty)
        : convertedFromLine(l.counted_qty, l.conversion_factor, l.broken_units);
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
// Web: progress view — EVERY line (counted or not), so the web user can watch
// the count fill in live. Uses the snapshot system qty if present, else the
// current stock-on-hand (sohByKey, keyed `${product_id}_${location_id}`).
// Uncounted lines have null counted/converted/variance.
// ---------------------------------------------------------------------------
export function buildProgressRows(lines, productById, sohByKey = {}) {
  return lines.map(l => {
    const product = productById[l.product_id];
    const cf = Number(l.conversion_factor) || 1;
    const isCounted = l.counted && l.counted_qty != null;
    const counted = isCounted ? Number(l.counted_qty) : null;
    const converted = isCounted
      ? (l.converted_qty != null ? Number(l.converted_qty) : convertedFromLine(l.counted_qty, cf, l.broken_units))
      : null;
    const live = sohByKey[`${l.product_id}_${l.location_id || ''}`];
    const system = l.system_qty != null ? Number(l.system_qty) : (live != null ? Number(live) : 0);
    const unitCost = l.unit_cost != null ? Number(l.unit_cost) : costOf(product);
    const variance = isCounted ? round(converted - system, 3) : null;
    return {
      ...l,
      _counted: isCounted,
      _system: system,
      _converted: converted,
      _variance: variance,
      _unitCost: unitCost,
      _varianceValue: variance != null ? round(variance * unitCost, 2) : null,
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
  // SOH keyed per product+location (each line posts back to its own location).
  const locIds = [...new Set(lines.map(l => l.location_id || header.location_id).filter(Boolean))];
  const sohRows = locIds.length
    ? await base44.entities.StockOnHand.filter({ location_id: locIds }, 'product_name', 20000)
    : [];
  const sohByKey = {};
  sohRows.forEach(s => { const k = `${s.product_id}_${s.location_id}`; if (!sohByKey[k]) sohByKey[k] = s; });

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

    const loc = r.location_id || header.location_id;
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
      to_location_id: variance > 0 ? loc : undefined,
      from_location_id: variance < 0 ? loc : undefined,
      notes: `Stock count ${header.reference}: system ${r._system}, counted ${converted} ${r.stock_uom || ''} @ ${r.location_name || ''}`.trim(),
    });

    // Overwrite SOH absolute to the counted qty (in the main stock UOM) at this line's location.
    const existing = sohByKey[`${r.product_id}_${loc}`];
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
        location_id: loc,
        location_name: r.location_name || header.location_name || '',
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
