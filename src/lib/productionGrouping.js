// Portion variant codes and their display info
// Column display order: MWL (blue) → MLM (green) → WLM (orange) → WWL (pink)
export const VARIANT_CODES = ['MWL', 'MLM', 'WLM', 'WWL'];
export const LOW_CARB_CATEGORY = 'Smart Carb';

export const VARIANT_INFO = {
  MLM: { label: 'MLM', fullLabel: "Men's Lean Muscle", portion_g: 330, bg: 'bg-green-500', text: 'text-white', light: 'bg-green-50', lightText: 'text-green-700' },
  MWL: { label: 'MWL', fullLabel: "Men's Weight Loss", portion_g: 300, bg: 'bg-blue-500', text: 'text-white', light: 'bg-blue-50', lightText: 'text-blue-700' },
  WLM: { label: 'WLM', fullLabel: "Women's Lean Muscle", portion_g: 260, bg: 'bg-orange-500', text: 'text-white', light: 'bg-orange-50', lightText: 'text-orange-700' },
  WWL: { label: 'WWL', fullLabel: "Women's Weight Loss", portion_g: 240, bg: 'bg-pink-400', text: 'text-white', light: 'bg-pink-50', lightText: 'text-pink-700' },
  LC:  { label: 'LC', fullLabel: 'Low Carb', portion_g: 330, bg: 'bg-yellow-400', text: 'text-yellow-900', light: 'bg-yellow-50', lightText: 'text-yellow-700' },
};

// MWL SKUs now use clean numbered format (MWL1–MWL15) matching Shopify and products.sku.
// detectVariant handles them via the regex branch (startsWith('MWL') + digits).
// No mapping table needed.

// Detect the variant code from a numbered product SKU: MLM3 → MLM, MWL1 → MWL, etc.
export function detectVariant(sku) {
  if (!sku) return null;
  for (const code of ['MLM', 'MWL', 'WLM', 'WWL']) {
    if (sku.startsWith(code) && /^\d+$/.test(sku.slice(code.length))) {
      return code;
    }
  }
  return null;
}

// Extract the meal number from a numbered variant SKU: MLM3 → 3, WLM13 → 13, MWL1 → 1
export function extractMealNumber(sku) {
  if (!sku) return null;
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

// Display order for package cards
export const PACKAGE_ORDER = ['MWL', 'MLM', 'WLM', 'WWL', 'LC'];

// Ring stroke colours for SVG donuts (mirrors Tailwind bg classes above)
export const RING_COLORS = {
  MLM: '#22c55e',
  MWL: '#3b82f6',
  WLM: '#f97316',
  WWL: '#f472b6',
  LC:  '#facc15',
};

/**
 * Group finished meals by package type for the package-first production UI.
 * Returns an array of package objects in PACKAGE_ORDER, each with a `meals`
 * array of { baseName, product } for every meal in that package.
 * Empty packages are omitted.
 */
export function groupMealsByPackage(finishedMeals) {
  const goalMap = {};
  const lcMeals = [];

  for (const product of finishedMeals) {
    if (product.status !== 'active') continue;

    if (isLowCarb(product)) {
      lcMeals.push({ baseName: product.name, product });
      continue;
    }

    const variant = detectVariant(product.sku);
    const mealNum = extractMealNumber(product.sku);
    if (!variant || mealNum === null) continue;

    if (!goalMap[mealNum]) goalMap[mealNum] = { mealNumber: mealNum, baseName: null, variants: {} };
    goalMap[mealNum].variants[variant] = product;

    if (variant === 'MWL') {
      goalMap[mealNum].baseName = product.name;
    } else if (!goalMap[mealNum].baseName) {
      goalMap[mealNum].baseName = product.name.replace(/\s+(MLM|MWL|WLM|WWL)\d*\s*$/, '').trim();
    }
  }

  const sortedGoalRows = Object.values(goalMap).sort((a, b) => a.mealNumber - b.mealNumber);
  lcMeals.sort((a, b) => a.baseName.localeCompare(b.baseName));

  const pkgMeals = { MWL: [], MLM: [], WLM: [], WWL: [], LC: [] };
  for (const row of sortedGoalRows) {
    for (const code of ['MWL', 'MLM', 'WLM', 'WWL']) {
      if (row.variants[code]) pkgMeals[code].push({ baseName: row.baseName, product: row.variants[code] });
    }
  }
  pkgMeals.LC = lcMeals;

  return PACKAGE_ORDER
    .filter(code => pkgMeals[code].length > 0)
    .map(code => ({ code, ...VARIANT_INFO[code], meals: pkgMeals[code] }));
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