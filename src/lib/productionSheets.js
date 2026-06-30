/**
 * Production print sheets — data builders.
 *
 * Turns a ProductionRun's lines into the three printable sheets Thys specced
 * (30/06/2026):
 *
 *   1. Production Plan  — meals × range columns (MWL→MLM→WLM→WWL), with Low Carb
 *      and Winter Warmer split onto their own pages. "How many of each dish to plate."
 *   2. Bulk Cook Sheet  — per bulk product: Raw vs Cooked weight required for the
 *      run, plus a blank Actual-Yield write-in column.
 *   3. Recipe Sheets    — per bulk product the scaled ingredient list (Ingredient ·
 *      UOM · Total), grouped into Protein / Starch / Veg / Sauce sheets.
 *
 * All maths is reused from the existing engine so the numbers match the cooking
 * runs and pick list exactly:
 *   - explodeLinesToBulks()      → cooked-kg per bulk (productionEngine.js)
 *   - groupMealsForProduction()  → the MWL/MLM/WLM/WWL matrix (productionGrouping.js)
 *   - getBulkCookedSubcategory() → Meats/Starches/Vegetables/Sauces bucket
 *
 * No LLM — deterministic numbers only.
 */

import { base44 } from '@/api/base44Client';
import { explodeLinesToBulks } from '@/lib/productionEngine';
import { groupMealsForProduction, VARIANT_CODES, VARIANT_INFO } from '@/lib/productionGrouping';
import { getBulkCookedSubcategory } from '@/lib/productSubcategories';

// ── Smart unit formatting ────────────────────────────────────────────────────
// Big numbers roll up (g→kg, ml→L); small ones stay g/ml. Counts pass through.
// Returns { value:number, unit:string, text:string }.

function round(n, dp = 2) {
  const f = Math.pow(10, dp);
  return Math.round((n + Number.EPSILON) * f) / f;
}

/** Convert a (qty, uom) pair to a base amount in grams/ml plus its "kind". */
export function toBase(qty, uom) {
  const u = (uom || '').toString().trim().toLowerCase();
  const q = Number(qty) || 0;
  if (u === 'kg') return { base: q * 1000, kind: 'mass' };
  if (u === 'g' || u === 'gram' || u === 'grams') return { base: q, kind: 'mass' };
  if (u === 'l' || u === 'litre' || u === 'liter' || u === 'litres') return { base: q * 1000, kind: 'vol' };
  if (u === 'ml') return { base: q, kind: 'vol' };
  return { base: q, kind: 'count', uom: u };
}

/** Format a base amount (grams/ml) with smart unit roll-up. */
export function formatSmart(base, kind, uom) {
  const b = Number(base) || 0;
  if (kind === 'mass') {
    return b >= 1000 ? { value: round(b / 1000, 2), unit: 'kg', text: `${round(b / 1000, 2)} kg` }
                     : { value: round(b, 0), unit: 'g', text: `${round(b, 0)} g` };
  }
  if (kind === 'vol') {
    return b >= 1000 ? { value: round(b / 1000, 2), unit: 'L', text: `${round(b / 1000, 2)} L` }
                     : { value: round(b, 0), unit: 'ml', text: `${round(b, 0)} ml` };
  }
  const unit = uom || '';
  return { value: round(b, 2), unit, text: `${round(b, 2)}${unit ? ' ' + unit : ''}`.trim() };
}

/** kg with smart roll-down to g for small values (used by the bulk cook sheet). */
export function formatKg(kg) {
  return formatSmart((Number(kg) || 0) * 1000, 'mass');
}

// ── Data loader ──────────────────────────────────────────────────────────────

async function loadBomData() {
  const [portionBoms, cookBoms, components, products] = await Promise.all([
    base44.entities.Bom.filter({ bom_type: 'portion', is_active: true }, 'product_name', 1000),
    base44.entities.Bom.filter({ bom_type: 'cook', is_active: true }, 'product_name', 1000),
    base44.entities.BomComponent.list('bom_id', 4000),
    base44.entities.Product.filter({ status: 'active' }, 'name', 2000),
  ]);

  const portionByProductId = {};
  portionBoms.forEach(b => { portionByProductId[b.product_id] = b; });

  const cookBomByProductId = {};
  cookBoms.forEach(b => { cookBomByProductId[b.product_id] = b; });

  const compsByBomId = {};
  components.forEach(c => {
    if (!compsByBomId[c.bom_id]) compsByBomId[c.bom_id] = [];
    compsByBomId[c.bom_id].push(c);
  });

  const productById = {};
  products.forEach(p => { productById[p.id] = p; });

  return { portionByProductId, cookBomByProductId, compsByBomId, productById };
}

// ── Sheet 1: Production Plan ──────────────────────────────────────────────────

const isWinter = (product) =>
  (product?.sku || '').toUpperCase().startsWith('WWR') ||
  /winter warmer/i.test(product?.subcategory || product?.name || '');

function buildPlan(lines, productById) {
  // qty per finished-meal product for this run
  const qtyByProduct = {};
  lines.forEach(l => {
    qtyByProduct[l.product_id] = (qtyByProduct[l.product_id] || 0) + (Number(l.planned_qty) || 0);
  });

  // Resolve a product object per line (fall back to a synthetic from line fields
  // so an archived meal still groups by its SKU variant).
  const products = lines.map(l =>
    productById[l.product_id] || {
      id: l.product_id, name: l.product_name, sku: l.product_sku,
      type: 'finished_meal', status: 'active',
    });
  // de-dupe by id
  const uniq = Object.values(Object.fromEntries(products.map(p => [p.id, p])));

  const { goalRows, lowCarbRows, otherRows } = groupMealsForProduction(uniq);

  // Goal page: MWL → MLM → WLM → WWL columns
  const goalColumns = VARIANT_CODES.map(code => ({
    code, label: VARIANT_INFO[code].fullLabel, short: VARIANT_INFO[code].label,
    color: VARIANT_INFO[code],
  }));
  const goal = goalRows.map(row => {
    const cells = {};
    let rowTotal = 0;
    VARIANT_CODES.forEach(code => {
      const p = row.variants[code];
      const q = p ? (qtyByProduct[p.id] || 0) : 0;
      cells[code] = p ? q : null; // null = meal not in this range at all
      rowTotal += q;
    });
    return { name: row.baseName, mealNumber: row.mealNumber, cells, rowTotal };
  }).filter(r => r.rowTotal > 0);

  const goalTotals = {};
  VARIANT_CODES.forEach(code => {
    goalTotals[code] = goal.reduce((s, r) => s + (r.cells[code] || 0), 0);
  });

  // Low Carb page (single qty column)
  const lowCarb = lowCarbRows.map(row => {
    const p = row.variants.LC;
    return { name: row.baseName, sku: row.mealNumber, qty: p ? (qtyByProduct[p.id] || 0) : 0 };
  }).filter(r => r.qty > 0);

  // Winter Warmer + any remaining non-variant meals
  const winterList = [];
  const otherList = [];
  otherRows.forEach(row => {
    const p = row.variants.OTHER;
    const qty = p ? (qtyByProduct[p.id] || 0) : 0;
    if (qty <= 0) return;
    const target = isWinter(p) ? winterList : otherList;
    target.push({ name: row.baseName, sku: row.mealNumber, qty });
  });

  return {
    goal: { columns: goalColumns, rows: goal, totals: goalTotals,
            grandTotal: Object.values(goalTotals).reduce((a, b) => a + b, 0) },
    lowCarb: { rows: lowCarb, total: lowCarb.reduce((s, r) => s + r.qty, 0) },
    winter:  { rows: winterList, total: winterList.reduce((s, r) => s + r.qty, 0) },
    other:   { rows: otherList, total: otherList.reduce((s, r) => s + r.qty, 0) },
  };
}

// ── Sheets 2 & 3: explode bulks, raw weight, recipes ──────────────────────────

const SUBCAT_TO_GROUP = {
  Meats: 'Protein',
  Starches: 'Starch',
  Vegetables: 'Veg',
  Sauces: 'Sauce',
  'Stir-Fry & Mixed': 'Veg',
};
const GROUP_ORDER = ['Protein', 'Starch', 'Veg', 'Sauce', 'Other'];

function groupForBulk(product) {
  const sub = getBulkCookedSubcategory(product || {});
  return SUBCAT_TO_GROUP[sub] || 'Other';
}

function buildBulksAndRecipes(lines, d) {
  const { portionByProductId, cookBomByProductId, compsByBomId, productById } = d;

  // cooked-kg required per bulk (matches cooking runs / pick list)
  const wip = explodeLinesToBulks(lines, { portionByProductId, compsByBomId, cookBomByProductId, productById });

  const bulkRows = [];   // Sheet 2
  const recipes = {};    // Sheet 3 — { group: [ {name, sku, group, ingredients:[...] } ] }
  GROUP_ORDER.forEach(g => { recipes[g] = []; });

  for (const [bulkId, info] of Object.entries(wip)) {
    const cookedKg = round(info.kg, 3);
    if (cookedKg <= 0) continue;

    const product = productById[bulkId] || { id: bulkId, name: info.name, sku: info.sku, type: 'wip_bulk' };
    const cookBom = cookBomByProductId[bulkId];
    const comps = cookBom ? (compsByBomId[cookBom.id] || []) : [];
    const yieldKg = cookBom && cookBom.yield_qty > 0 ? cookBom.yield_qty : 1;
    const scale = cookedKg / yieldKg; // how many "recipe batches" this run needs

    // Raw input weight per batch (mass + volume both count toward weight; skip
    // packaging + consumables + pure counts).
    let rawBasePerBatch = 0;
    const ingredients = [];
    for (const c of comps) {
      const inputProd = productById[c.input_product_id];
      if (inputProd && inputProd.type === 'packaging') continue;
      if (c.is_consumable) continue;

      const { base, kind, uom } = toBase(c.qty, c.uom);
      if (kind === 'mass' || kind === 'vol') rawBasePerBatch += base;

      const totalBase = base * scale;
      ingredients.push({
        name: c.input_product_name || inputProd?.name || '—',
        sku: c.input_product_sku || inputProd?.sku || '',
        ...formatSmart(totalBase, kind, uom),
        kind,
        sortBase: kind === 'count' ? -1 : totalBase,
      });
    }
    // Heaviest ingredients first (the mains), counts/spices last.
    ingredients.sort((a, b) => b.sortBase - a.sortBase);

    const rawKg = round((rawBasePerBatch * scale) / 1000, 2);
    const group = groupForBulk(product);

    bulkRows.push({
      name: product.name || info.name,
      sku: product.sku || info.sku,
      group,
      rawKg,
      cookedKg: round(cookedKg, 2),
      yieldPct: rawKg > 0 ? Math.round((cookedKg / rawKg) * 100) : null,
    });

    recipes[group].push({
      name: product.name || info.name,
      sku: product.sku || info.sku,
      group,
      ingredients,
    });
  }

  // Sort Sheet 2 by group order then name
  bulkRows.sort((a, b) =>
    (GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group)) ||
    a.name.localeCompare(b.name));

  // Sort each recipe group by name
  Object.values(recipes).forEach(arr => arr.sort((a, b) => a.name.localeCompare(b.name)));

  return {
    bulkCook: {
      rows: bulkRows,
      totalRawKg: round(bulkRows.reduce((s, r) => s + r.rawKg, 0), 2),
      totalCookedKg: round(bulkRows.reduce((s, r) => s + r.cookedKg, 0), 2),
    },
    recipes,
  };
}

/**
 * Load + build all three sheets for a production run.
 * @param {Array} lines  ProductionRunLine[] ({ product_id, planned_qty, product_name, product_sku })
 * @returns {Promise<{ plan, bulkCook, recipes }>}
 */
export async function buildProductionSheets(lines) {
  const safeLines = (lines || []).filter(l => (Number(l.planned_qty) || 0) > 0);
  const d = await loadBomData();
  const plan = buildPlan(safeLines, d.productById);
  const { bulkCook, recipes } = buildBulksAndRecipes(safeLines, d);
  return { plan, bulkCook, recipes };
}

export { GROUP_ORDER };
