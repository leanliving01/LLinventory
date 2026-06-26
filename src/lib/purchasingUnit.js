/**
 * Purchasing-unit conversion helpers.
 *
 * A purchasing unit is captured as a clean Purchase UOM name + a pack size +
 * packs-per-unit, and the conversion factor (1 purchase unit = X stock units)
 * is DERIVED rather than typed:
 *
 *   conversion_factor = convert(pack_size, pack_size_uom → stock_uom) × pack_qty
 *
 * e.g. a case of 24 × 500 g pasta, stock_uom = kg → 0.5 kg × 24 = 12.
 */

// Standard measurement units offered for a pack size (kept deliberately small —
// these are the only units a pack is ever physically measured in).
export const MEASURE_UNITS = [
  { code: 'kg', label: 'kg' },
  { code: 'g', label: 'g' },
  { code: 'l', label: 'L' },
  { code: 'ml', label: 'ml' },
  { code: 'each', label: 'each' },
];

const MASS = { kg: 1000, g: 1, gr: 1, gram: 1, grams: 1, kgs: 1000 };
const VOL = { l: 1000, lt: 1000, litre: 1000, liter: 1000, ml: 1 };
const COUNT = new Set(['each', 'ea', 'pcs', 'pc', 'unit', 'units', 'piece', 'pieces']);

const fam = (u) => {
  const k = String(u || '').toLowerCase();
  if (k in MASS) return 'mass';
  if (k in VOL) return 'vol';
  if (COUNT.has(k)) return 'count';
  return null;
};

const round4 = (n) => Math.round(n * 10000) / 10000;

/**
 * Convert one pack of `size` `fromUom` into the product's `stockUom`.
 * Returns a number, or null when the families don't match (caller falls back
 * to a manual conversion).
 */
export function convertPackToStock(size, fromUom, stockUom) {
  const s = Number(size);
  if (!Number.isFinite(s) || s <= 0 || !fromUom || !stockUom) return null;
  const ff = fam(fromUom), sf = fam(stockUom);
  if (!ff || !sf || ff !== sf) return null;
  if (ff === 'count') return round4(s); // each → each
  const from = String(fromUom).toLowerCase();
  const stock = String(stockUom).toLowerCase();
  const table = ff === 'mass' ? MASS : VOL;
  return round4((s * table[from]) / table[stock]);
}

/**
 * Derive the conversion factor + a human "working" string.
 * @returns {{ value:number, working:string }|null} null when not auto-derivable.
 */
export function computeConversion({ packSize, packSizeUom, packQty, stockUom }) {
  const per = convertPackToStock(packSize, packSizeUom, stockUom);
  if (per == null) return null;
  const qty = Number(packQty) > 0 ? Number(packQty) : 1;
  const value = round4(per * qty);
  const su = stockUom;
  const working = qty === 1
    ? `${packSize} ${packSizeUom} = ${value} ${su}`
    : `${packSize} ${packSizeUom} = ${per} ${su} × ${qty} = ${value} ${su}`;
  return { value, working };
}

/**
 * Parse a free-text pack/description (invoice line or label) into pack fields.
 * Handles "10 × 2kg", "case of 6 × 500g", "25kg", "5L", "per kg", lone "kg".
 * @returns {{ packQty:number, packSize:number, packSizeUom:string }|null}
 */
export function parsePack(text) {
  if (!text) return null;
  const t = String(text).toLowerCase();
  const U = '(kg|kgs|g|gr|gram|grams|ml|l|lt|litre|liter)';
  let m = t.match(new RegExp(`(\\d+(?:\\.\\d+)?)\\s*[x×]\\s*(\\d+(?:\\.\\d+)?)\\s*${U}\\b`))
       || t.match(new RegExp(`(?:case|bale|bag|box|carton|pack|crate)\\s*of\\s*(\\d+)\\D*?(\\d+(?:\\.\\d+)?)\\s*${U}\\b`));
  if (m) return { packQty: parseFloat(m[1]), packSize: parseFloat(m[2]), packSizeUom: normUnit(m[3]) };
  m = t.match(new RegExp(`(\\d+(?:\\.\\d+)?)\\s*${U}\\b`));
  if (m) return { packQty: 1, packSize: parseFloat(m[1]), packSizeUom: normUnit(m[2]) };
  m = t.match(/\b(?:per|p)\s*[/.]?\s*(kg|kgs|kilo|kilogram|g|gram|grams|l|lt|litre|liter|ml)\b/)
   || t.match(/(?:^|\s)(kg|kgs|kilo|kilogram|g|gram|grams|l|lt|litre|liter|ml)(?:\s|$)/);
  if (m) return { packQty: 1, packSize: 1, packSizeUom: normUnit(m[1]) };
  return null;
}

// Collapse unit aliases to the canonical measurement codes we store.
function normUnit(u) {
  const k = String(u || '').toLowerCase();
  if (['kg', 'kgs', 'kilo', 'kilogram'].includes(k)) return 'kg';
  if (['g', 'gr', 'gram', 'grams'].includes(k)) return 'g';
  if (['l', 'lt', 'litre', 'liter'].includes(k)) return 'l';
  if (k === 'ml') return 'ml';
  return k;
}
