/**
 * Production grouping utilities for Phase 1.
 * Groups finished_meal Products by base recipe across portion variants (MLM/MWL/WLM/WWL).
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
 * Detect the variant code from a product SKU.
 * Examples: MLM3 → MLM, WLM13 → WLM, SweChiChi → null (BYO/base), LC5 → LC
 */
export function detectVariant(sku) {
  if (!sku) return null;
  for (const code of VARIANT_CODES) {
    if (sku.startsWith(code) && /^\d+$/.test(sku.slice(code.length))) {
      return code;
    }
  }
  return null;
}

/**
 * Extract the meal number from a variant SKU.
 * MLM3 → 3, WLM13 → 13
 */
export function extractMealNumber(sku) {
  if (!sku) return null;
  const variant = detectVariant(sku);
  if (!variant) return null;
  return parseInt(sku.slice(variant.length), 10);
}

/**
 * Determine if a finished_meal is Low Carb based on category or tags.
 */
export function isLowCarb(product) {
  if (product.category === LOW_CARB_CATEGORY) return true;
  if (product.tags?.includes('low carb') || product.tags?.includes('Low Carb')) return true;
  // LC SKU prefix check
  if (product.sku && product.sku.startsWith('LC') && /^\d+$/.test(product.sku.slice(2))) return true;
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
  const unmatched = []; // BYO base products to match later

  for (const product of finishedMeals) {
    if (product.status !== 'active') continue;

    // Check Low Carb
    if (isLowCarb(product)) {
      lowCarbRows.push({
        mealNumber: product.sku,
        baseName: product.name,
        variants: { LC: product },
      });
      continue;
    }

    const variant = detectVariant(product.sku);
    if (!variant) {
      // BYO / base product — try to match to MWL column later
      unmatched.push(product);
      continue;
    }

    const mealNum = extractMealNumber(product.sku);
    if (mealNum === null) continue;

    if (!goalMap[mealNum]) {
      goalMap[mealNum] = { mealNumber: mealNum, baseName: null, variants: {} };
    }
    goalMap[mealNum].variants[variant] = product;

    // Use MWL name as base (cleanest — no variant suffix), else strip suffix
    if (variant === 'MWL' || !goalMap[mealNum].baseName) {
      let baseName = product.name;
      // Remove trailing variant suffixes: " MLM", " MWL", " WLM", " WWL", " WWL12", etc.
      baseName = baseName.replace(/\s+(MLM|MWL|WLM|WWL)\d*\s*$/, '').trim();
      goalMap[mealNum].baseName = baseName;
    }
  }

  // Match BYO base products (e.g. SweChiChi) to MWL column by finding
  // the meal group that doesn't yet have an MWL variant.
  // BYO products are 300g = MWL weight and represent the same meal.
  for (const product of unmatched) {
    // Try to find a meal group where this product's name is similar
    // The MLM variant name usually matches closest (same as base but with " MLM" suffix)
    let matched = false;
    for (const group of Object.values(goalMap)) {
      if (group.variants.MWL) continue; // already has MWL

      // Check if product name matches any variant's base name
      const mlmProduct = group.variants.MLM;
      if (mlmProduct) {
        const mlmBase = mlmProduct.name.replace(/\s+MLM\d*\s*$/, '').trim();
        // Compare cleaned names
        if (product.name === mlmBase || product.name.startsWith(mlmBase.slice(0, 20))) {
          group.variants.MWL = product;
          // Update base name to use this cleaner name
          group.baseName = product.name;
          matched = true;
          break;
        }
      }
    }
  }

  const goalRows = Object.values(goalMap).sort((a, b) => a.mealNumber - b.mealNumber);
  lowCarbRows.sort((a, b) => a.baseName.localeCompare(b.baseName));

  return { goalRows, lowCarbRows };
}