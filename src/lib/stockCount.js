import { base44 } from '@/api/base44Client';
import { nextDocNumber } from '@/lib/docNumbering';
import { resolveSubcategory } from '@/lib/productClassification';

// Reviewed stock-count workflow (Build 1).
// Floor counts NEVER touch stock-on-hand — they are reviewed and posted from the web.

// Assemble-on-demand categories: a package/bundle is built FROM finished meals at
// pack time, so the meals are the real counted stock — the box itself is never
// stock-counted. Excluded explicitly so a stray on-hand row for a package SKU can
// never pull it into a count (which the 036 freeze trigger would then block from
// being assembled).
const NON_COUNTABLE_TYPES = new Set(['package', 'bundle']);

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

// Build the count-UOM options for a product line: the base stock unit, plus any
// Stock Count Units (stock_count_uoms) AND any Purchasing Units
// (supplier_products) registered for the product. Every option carries
// "1 unit = conversion_factor stock units". Deduped so the same pack registered
// against several suppliers (or in both tables) only shows once.
//   buildUomOptions('kg', countUoms, supplierProducts) →
//     [{ key:'__stock__', count_uom:'kg', conversion_factor:1 }, { key:'sp_…', count_uom:'case', count_uom_label:'Case of 6', conversion_factor:6 }, …]
export const STOCK_UOM_KEY = '__stock__';
export function buildUomOptions(stockUom, countUoms = [], supplierProducts = []) {
  const baseUom = stockUom || 'unit';
  const seen = new Set([`${baseUom}|1|`.toLowerCase()]);
  const options = [{ key: STOCK_UOM_KEY, count_uom: baseUom, count_uom_label: '', conversion_factor: 1, source: 'base' }];

  const add = (key, uom, label, cf, source) => {
    const factor = Number(cf) || 0;
    if (!(factor > 0)) return;                       // skip unusable / missing conversions
    const unit = uom || baseUom;
    const lbl = label || '';
    const dedupe = `${unit}|${factor}|${lbl}`.toLowerCase();
    if (seen.has(dedupe)) return;
    seen.add(dedupe);
    options.push({ key, count_uom: unit, count_uom_label: lbl, conversion_factor: factor, source });
  };

  (countUoms || []).forEach(u =>
    add(`scu_${u.id}`, u.count_uom, u.count_uom_label, u.conversion_factor, 'count'));
  (supplierProducts || []).forEach(sp =>
    add(`sp_${sp.id}`, sp.purchase_uom, sp.purchase_uom_label || sp.purchase_uom_name, sp.conversion_factor ?? sp.purchase_to_stock_factor, 'purchase'));

  return options;
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

  // Does a product belong in this count? Category matches product.type; the
  // optional subcategory filter matches the SAME resolved subcategory the count
  // screens group by (resolveSubcategory) — NOT the raw column — so a legacy /
  // auto-classified meal (e.g. "Smart Carb" → "Low Carb Meals") is never dropped.
  const matchesScope = (product) => {
    if (!product) return false;
    if (NON_COUNTABLE_TYPES.has(product.type)) return false;
    if (cat && product.type !== cat) return false;
    if (subCats && !subCats.includes(resolveSubcategory(product))) return false;
    return true;
  };

  // Location-name lookup harvested from the SOH rows we already loaded, so a
  // synthesised zero-stock line can still carry a readable location name.
  const locNameById = {};
  sohRows.forEach(s => { if (s.location_id && s.location_name) locNameById[s.location_id] = s.location_name; });

  // A stand-in SOH row for a product that has NO stock-on-hand record yet, so the
  // line-creation mapping below treats it like any other candidate (qty 0). This
  // is what makes zero-stock meals show up to be counted (and confirmed at 0).
  const syntheticSoh = (product, locId) => ({
    product_id: product.id,
    product_sku: product.sku || '',
    product_name: product.name || '',
    location_id: locId || null,
    location_name: (locId && locNameById[locId]) || '',
    qty_on_hand: 0,
    uom: product.stock_uom || 'pcs',
  });

  // Build candidates. Every active product matching the category/subcategory is
  // seeded — INCLUDING zero-stock products — so the floor sees the full range.
  const seen = new Set();
  const candidates = [];

  if (!location) {
    // Category(/subcategory)-only across all locations: one line per matching
    // product. Products with stock pick an authoritative SOH row (default
    // location, else highest qty); zero-stock products fall back to their
    // default location so they still appear.
    const sohByProduct = {};
    for (const soh of sohRows) {
      if (!soh.product_id || !soh.location_id) continue;
      if (!matchesScope(productById[soh.product_id])) continue;
      (sohByProduct[soh.product_id] ||= []).push(soh);
    }
    for (const product of products) {
      if (!matchesScope(product) || seen.has(product.id)) continue;
      seen.add(product.id);
      const rows = sohByProduct[product.id];
      if (rows && rows.length) {
        const defaultLocId = product.default_location_id;
        const pick = (defaultLocId && rows.find(s => s.location_id === defaultLocId))
                     || rows.reduce((best, s) =>
                       (Number(s.qty_on_hand) || 0) >= (Number(best.qty_on_hand) || 0) ? s : best, rows[0]);
        candidates.push({ soh: pick, product });
      } else {
        candidates.push({ soh: syntheticSoh(product, product.default_location_id), product });
      }
    }
  } else {
    // Location (or location+category): one line per product+location with stock,
    // PLUS a zero line for matching products that have no stock-on-hand row here.
    const scopeIds = locationScopeIds && locationScopeIds.length > 0 ? locationScopeIds : [location.id];
    const scopeSet = new Set(scopeIds);
    // Where to seat a zero-stock line: the product's default location if it falls
    // in scope, else a concrete in-scope location to post against.
    const fallbackLoc = scopeSet.has(location.id) ? location.id : scopeIds[0];
    const productsWithStock = new Set();
    for (const soh of sohRows) {
      if (!soh.product_id || !soh.location_id) continue;
      const key = `${soh.product_id}_${soh.location_id}`;
      if (seen.has(key)) continue;
      if (!matchesScope(productById[soh.product_id])) continue;
      seen.add(key);
      productsWithStock.add(soh.product_id);
      candidates.push({ soh, product: productById[soh.product_id] });
    }
    for (const product of products) {
      if (!matchesScope(product) || productsWithStock.has(product.id)) continue;
      const defLoc = product.default_location_id;
      // With a category filter the user is counting that whole range, so every
      // matching meal is included (seated on the count's location). Without one
      // (pure location count), only products that actually belong here appear —
      // so a location count doesn't drag in the entire catalogue.
      const loc = (defLoc && scopeSet.has(defLoc)) ? defLoc : (cat ? fallbackLoc : null);
      if (!loc) continue;
      const key = `${product.id}_${loc}`;
      if (seen.has(key)) continue;
      seen.add(key);
      candidates.push({ soh: syntheticSoh(product, loc), product });
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
// Top up an editable count with in-scope products that are missing a line.
// Counts created before the "seed every meal" fix only have lines for products
// that had a stock-on-hand row, so zero-stock meals never appeared. This adds
// them (uncounted, qty 0) WITHOUT touching any line already entered.
//
// The subcategory scope is INFERRED from the subcategories already present in
// the count (the original chip selection isn't persisted on the header), so a
// count scoped to "Low Carb Meals" only gains other Low Carb meals — it never
// pulls in the rest of the category. Returns the number of lines added.
// ---------------------------------------------------------------------------
export async function syncCountLines(countId) {
  const header = await base44.entities.NewStockTake.filter({ id: countId }).then(r => r[0]);
  if (!header) return 0;
  if (!FLOOR_OPEN_STATUSES.includes(header.status)) return 0; // only open / in_progress
  const cat = header.item_group && header.item_group !== 'all' ? header.item_group : null;
  if (!cat) return 0; // pure location count — never dump the whole catalogue

  const lines = await base44.entities.StockTakeLine.filter({ stocktake_id: countId }, 'product_name', 5000);
  if (!lines.length) return 0;
  const products = await base44.entities.Product.filter({ status: 'active', type: cat }, 'name', 5000);
  const productById = Object.fromEntries(products.map(p => [p.id, p]));

  // Subcategories already represented in the count = the inferred scope.
  const presentSubs = new Set(
    lines.map(l => { const p = productById[l.product_id]; return p ? resolveSubcategory(p) : null; })
      .filter(Boolean)
  );
  if (!presentSubs.size) return 0;

  const haveProductIds = new Set(lines.map(l => l.product_id));
  const scopeLocs = new Set(lines.map(l => l.location_id).filter(Boolean));
  const fallbackLoc = header.location_id || lines[0]?.location_id || null;
  const fallbackLocName = (header.location_name && header.location_name !== 'All locations')
    ? header.location_name : (lines[0]?.location_name || '');

  const toAdd = products.filter(p =>
    !NON_COUNTABLE_TYPES.has(p.type) &&
    !haveProductIds.has(p.id) &&
    presentSubs.has(resolveSubcategory(p))
  );
  if (!toAdd.length) return 0;

  await base44.entities.StockTakeLine.bulkCreate(toAdd.map(p => {
    // Seat the new zero line at the product's default location if that location
    // is part of this count, else the count's location.
    const loc = (p.default_location_id && scopeLocs.has(p.default_location_id))
      ? p.default_location_id
      : (header.location_id ? fallbackLoc : (p.default_location_id || fallbackLoc));
    return {
      stocktake_id: countId,
      product_id: p.id,
      product_sku: p.sku || '',
      product_name: p.name || '',
      location_id: loc || null,
      location_name: loc === p.default_location_id ? '' : fallbackLocName,
      stock_uom: p.stock_uom || 'pcs',
      count_uom: p.stock_uom || 'pcs',
      conversion_factor: 1,
      counted: false,
      count_attempt: 1,
    };
  }));

  await base44.entities.NewStockTake.update(countId, {
    total_lines: (Number(header.total_lines) || lines.length) + toAdd.length,
    uncounted_count: (Number(header.uncounted_count) || 0) + toAdd.length,
  });

  return toAdd.length;
}

// ---------------------------------------------------------------------------
// Remove count lines for products that have since been ARCHIVED (or deleted)
// from any still-editable count. A product that's been retired should never be
// counted, so a line seeded before it was archived is stale — drop it. Completed
// and cancelled counts are historical records and are left untouched.
//
// This is what makes an archived meal disappear from an in-progress count
// everywhere (web review + floor) instead of lingering under "__UNKNOWN__".
// Returns the number of lines removed.
// ---------------------------------------------------------------------------
export async function pruneArchivedLines(countId) {
  const header = await base44.entities.NewStockTake.filter({ id: countId }).then(r => r[0]);
  if (!header) return 0;
  if (['completed', 'cancelled'].includes(header.status)) return 0;

  const lines = await base44.entities.StockTakeLine.filter({ stocktake_id: countId }, 'product_name', 5000);
  if (!lines.length) return 0;

  const productIds = [...new Set(lines.map(l => l.product_id).filter(Boolean))];
  if (!productIds.length) return 0;
  const products = await base44.entities.Product.filter({ id: productIds }, 'name', 5000);
  const statusById = Object.fromEntries(products.map(p => [p.id, p.status]));

  // Stale = product is archived, or no longer exists at all.
  const stale = lines.filter(l => statusById[l.product_id] !== 'active');
  if (!stale.length) return 0;

  await base44.entities.StockTakeLine.bulkDelete(stale.map(l => l.id));

  const surviving = lines.filter(l => statusById[l.product_id] === 'active');
  await base44.entities.NewStockTake.update(countId, {
    total_lines: surviving.length,
    uncounted_count: surviving.filter(l => !l.counted).length,
  });
  return stale.length;
}

// Delete a count outright (header + all its lines). Used from the list screen.
// Active counts freeze stock, so cancel them first — deleting a completed count
// keeps the posted stock movements (they reference the count only by number).
export async function deleteStockCount(countId) {
  const lines = await base44.entities.StockTakeLine.filter({ stocktake_id: countId }, 'product_name', 5000);
  if (lines.length) await base44.entities.StockTakeLine.bulkDelete(lines.map(l => l.id));
  await base44.entities.NewStockTake.delete(countId);
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
