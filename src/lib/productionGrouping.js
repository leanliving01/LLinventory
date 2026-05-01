/**
 * Production grouping utilities for Phase 1.
 * Groups finished_meal Products by base recipe across portion variants (MLM/MWL/WLM/WWL).
 *
 * MWL SKUs are descriptive names (e.g. SweChiChi, BeeTri) because they double
 * as BYO SKUs. MLM/WLM/WWL use numbered SKUs (MLM1-15, WLM1-15, WWL1-15).
 * This map links MWL descriptive SKUs to their meal number.
 */

// Portion variant codes and their display info
export const VARIANT_CODES = ['MLM', 'MWL', 'WLM', 'WWL'];
export const LOW_CARB_CATEGORY = 'Smart Carb';

export const VARIANT_INFO = {
  MLM: { label: 'MLM', fullLabel: "Men's Lean Muscle", portion_g: 330, bg: 'bg-green-500', text: 'text-white', light: 'bg-green-50', lightText: 'text-green-700' },
  MWL: { label: 'MWL', fullLabel: "Men's Weight Loss", portion_g: 300, bg: 'bg-blue-500', text: 'text-white', light: 'bg-blue-50', lightText: 'text-blue-700' },
  WLM: { label: 'WLM', fullLabel: "Women's Lean Muscle", portion_g: 260, bg: 'bg-orange-500', text: 'text-white', light: 'bg-orange-50', lightText: 'text-orange-700' },
  WWL: { label: 'WWL', fullLabel: "Women's Weight Loss", portion_g: 240, bg: 'bg-pink-400', text: 'text-white', light: 'bg-pink-50', lightText: 'text-pink-700' },
  LC:  { label: 'LC', fullLabel: 'Low Carb', portion_g: 330, bg: 'bg-yellow-400', text: 'text-yellow-900', light: 'bg-yellow-50', lightText: 'text-yellow-700' },
};

/**
 * MWL SKU → meal number mapping.
 * MWL SKUs use descriptive names because they double as BYO (Build Your Own) SKUs.
 * This is the canonical mapping from Cin7 — includes the known anomaly BeeandBea-2 = MWL1.
 */
const MWL_SKU_TO_MEAL = {
  'MWL1': 1,           // Cin7 anomaly: also maps from BeeandBea-2
  'BeeandBea-2': 1,    // Known Cin7 anomaly
  'BeeTri': 2,
  'ChiBreSwePotandMixVeg': 3,
  'ChiBreButandStialowitaSweandSouSau': 4,
  'ChiBreCouandMixVeg': 5,
  'ChiBrePotWedandCreSpi': 6,
  'ChiCur': 7,
  'CotPie': 8,
  'KetButChi': 9,
  'LeaMinPasSheandCor': 10,
  'LeaMinWhiBasRicandBro': 11,
  'LeaMinWhiBasRicandGreBea': 12,
  'SteBroRicandCar': 13,
  'SteSwePotandBro': 14,
  'SweChiChi': 15,
};

/**
 * Detect the variant code from a product SKU.
 * MLM3 → MLM, WLM13 → WLM, SweChiChi → MWL (via map), LC5 → null (handled separately)
 */
export function detectVariant(sku) {
  if (!sku) return null;
  // Check numbered variants: MLM, MWL, WLM, WWL
  for (const code of ['MLM', 'MWL', 'WLM', 'WWL']) {
    if (sku.startsWith(code) && /^\d+$/.test(sku.slice(code.length))) {
      return code;
    }
  }
  // Check MWL map (descriptive SKUs)
  if (MWL_SKU_TO_MEAL[sku] !== undefined) return 'MWL';
  return null;
}

/**
 * Extract the meal number from a variant SKU.
 * MLM3 → 3, WLM13 → 13, SweChiChi → 15 (via map)
 */
export function extractMealNumber(sku) {
  if (!sku) return null;
  // Check MWL map first
  if (MWL_SKU_TO_MEAL[sku] !== undefined) return MWL_SKU_TO_MEAL[sku];
  // Check numbered variants
  for (const code of ['MLM', 'MWL', 'WLM', 'WWL']) {
    if (sku.startsWith(code) && /^\d+$/.test(sku.slice(code.length))) {
      return parseInt(sku.slice(code.length), 10);
    }
  }
  return null;
}

/**
 * Determine if a finished_meal is Low Carb based on category or tags.
 */
export function isLowCarb(product) {
  if (product.category === LOW_CARB_CATEGORY) return true;
  if (product.tags?.includes('low carb') || product.tags?.includes('Low Carb') || product.tags?.includes('Smart carb')) return true;
  return false;
}

/**
 * Group finished_meal products into rows for the production table.
 * Each row = one base recipe with variant columns (MLM/MWL/WLM/WWL) or a single LC column.
 *
 * Returns: { goalRows: [...], lowCarbRows: [...] }
 * Each row: { mealNumber, baseName, variants: { MLM: product, MWL: product, ... } }
 */
export function groupMealsForProduction(finishedMeals) {
  const goalMap = {}; // mealNumber → { baseName, variants }
  const lowCarbRows = [];

  for (const product of finishedMeals) {
    if (product.status !== 'active') continue;

    // Check Low Carb first
    if (isLowCarb(product)) {
      lowCarbRows.push({
        mealNumber: product.sku,
        baseName: product.name,
        variants: { LC: product },
      });
      continue;
    }

    const variant = detectVariant(product.sku);
    const mealNum = extractMealNumber(product.sku);
    if (!variant || mealNum === null) continue; // skip unrecognized products (e.g. SSBR)

    if (!goalMap[mealNum]) {
      goalMap[mealNum] = { mealNumber: mealNum, baseName: null, variants: {} };
    }
    goalMap[mealNum].variants[variant] = product;

    // Use MWL name as base (cleanest name), else strip variant suffix from other variants
    if (variant === 'MWL') {
      goalMap[mealNum].baseName = product.name;
    } else if (!goalMap[mealNum].baseName) {
      let baseName = product.name;
      baseName = baseName.replace(/\s+(MLM|MWL|WLM|WWL)\d*\s*$/, '').trim();
      goalMap[mealNum].baseName = baseName;
    }
  }

  const goalRows = Object.values(goalMap).sort((a, b) => a.mealNumber - b.mealNumber);
  lowCarbRows.sort((a, b) => a.baseName.localeCompare(b.baseName));

  return { goalRows, lowCarbRows };
}