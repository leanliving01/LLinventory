import { resolveSubcategory, resolveSubcategoryColor, makeSubcategorySorter } from '@/lib/productClassification';

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
  // Single "Qty" column for meals that don't follow the goal/Low-Carb variant
  // scheme (e.g. Winter Warmer Range WWR#). Used by the Ad-Hoc run picker.
  OTHER: { label: 'Qty', fullLabel: 'Quantity', portion_g: null, bg: 'bg-slate-500', text: 'text-white', light: 'bg-slate-50', lightText: 'text-slate-700' },
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

// Stable key from a subcategory name, used as the package `code`.
function slugify(name) {
  return (name || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'other';
}

// Trim a trailing variant-code suffix (e.g. " MWL1") for a cleaner display name.
function cleanMealName(product) {
  const n = (product.name || '').replace(/\s+(MLM|MWL|WLM|WWL)\d*\s*$/i, '').trim();
  return n || product.name || '';
}

/**
 * Group finished meals into "packages" for the package-first production UI,
 * driven entirely by each product's resolved Subcategory (the single source of
 * truth shared with the catalog — see resolveSubcategory). This makes the
 * dashboard data-driven: any new subcategory automatically becomes a new
 * package card, and NO meal is ever silently dropped (unknown → "Other Meals").
 *
 * @param finishedMeals  active finished_meal products
 * @param subcatRows     managed product_subcategories rows (for order + colour);
 *                       optional — falls back to canonical defaults when empty.
 * Returns an array of { code, fullLabel, label, color, meals:[{baseName, product}] }.
 */
export function groupMealsByPackage(finishedMeals, subcatRows = []) {
  const rows = (subcatRows || []).filter(r => r.product_type === 'finished_meal');

  // Stored colours keyed by lowercased subcategory name.
  const colorMap = {};
  rows.forEach(r => {
    const key = (r.name || '').toLowerCase();
    if (key && r.color) colorMap[key] = r.color;
  });

  // Bucket every active meal by its resolved subcategory.
  const buckets = {};
  for (const product of finishedMeals) {
    if (product.status !== 'active') continue;
    const name = resolveSubcategory(product) || 'Other Meals';
    if (!buckets[name]) buckets[name] = [];
    buckets[name].push({ baseName: cleanMealName(product), product });
  }

  // Sort meals within each package by SKU (natural numeric order), then name.
  Object.values(buckets).forEach(meals => {
    meals.sort((a, b) =>
      (a.product.sku || '').localeCompare(b.product.sku || '', undefined, { numeric: true }) ||
      a.baseName.localeCompare(b.baseName));
  });

  // Order packages: managed rows' sort_order first, then canonical defaults,
  // then alphabetical, with any "Other…" group pushed last.
  const managedOrder = rows
    .slice()
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
    .map(r => r.name)
    .filter(Boolean);
  const sorter = makeSubcategorySorter('finished_meal', managedOrder.length ? managedOrder : undefined);
  const names = Object.keys(buckets).sort(sorter);

  return names.map(name => ({
    code: slugify(name),
    fullLabel: name,
    label: name,
    color: resolveSubcategoryColor(name, colorMap) || '#6b7280',
    meals: buckets[name],
  }));
}

/**
 * Group finished_meal products into rows for the production table.
 * Each row = one base recipe with variant columns (MLM/MWL/WLM/WWL) or a single LC column.
 *
 * Returns: { goalRows: [...], lowCarbRows: [...], otherRows: [...] }
 * Each row: { mealNumber, baseName, variants: { MLM: product, MWL: product, ... } }
 *
 * `otherRows` holds active finished meals that don't follow the goal-variant or
 * Low-Carb scheme (e.g. Winter Warmer Range WWR#). Each is a single-column row
 * keyed under the synthetic `OTHER` variant. This bucket is additive — callers
 * that only read goalRows/lowCarbRows are unaffected.
 */
export function groupMealsForProduction(finishedMeals) {
  const goalMap = {}; // mealNumber → { baseName, variants }
  const lowCarbRows = [];
  const otherRows = [];

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
    if (!variant || mealNum === null) {
      // Non-variant finished meal (e.g. WWR#) — keep it selectable as a single
      // "Qty" column instead of silently dropping it.
      otherRows.push({
        mealNumber: product.sku || product.id,
        baseName: product.name,
        variants: { OTHER: product },
      });
      continue;
    }

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
  otherRows.sort((a, b) =>
    String(a.mealNumber).localeCompare(String(b.mealNumber), undefined, { numeric: true }) ||
    a.baseName.localeCompare(b.baseName));

  return { goalRows, lowCarbRows, otherRows };
}