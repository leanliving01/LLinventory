/**
 * Centralised product classification model.
 *
 * The product `type` column is the canonical **Category** (its labels match the
 * business category list exactly). The `subcategory` text column is the
 * canonical **Subcategory**. The legacy free-text `category` column is no longer
 * shown in the UI — its content is backfilled into `subcategory` (see
 * migration 034) and normalised via LEGACY_SUBCATEGORY_MAP.
 *
 * This module is the single source of truth shared by the Products page
 * (Catalog) and the Inventory Overview page.
 */

import { getProductSubcategory, SUBCATEGORIZED_TYPES } from '@/lib/productSubcategories';

export { getProductSubcategory, SUBCATEGORIZED_TYPES };

// ── Category (= product.type) ──────────────────────────────────────────────
export const CATEGORY_LABELS = {
  raw: 'Raw Material',
  packaging: 'Packaging',
  wip_bulk: 'Bulk Cooked',
  finished_meal: 'Finished Meal',
  supplement: 'Supplement',
  package: 'Package',
  sauce: 'Sauce',
  solo_serve: 'Solo Serve',
  bundle: 'Bundle',
  service: 'Service',
};

export const CATEGORY_COLORS = {
  raw: 'bg-amber-100 text-amber-700',
  packaging: 'bg-gray-100 text-gray-700',
  wip_bulk: 'bg-orange-100 text-orange-700',
  finished_meal: 'bg-green-100 text-green-700',
  supplement: 'bg-purple-100 text-purple-700',
  package: 'bg-blue-100 text-blue-700',
  sauce: 'bg-red-100 text-red-700',
  solo_serve: 'bg-pink-100 text-pink-700',
  bundle: 'bg-indigo-100 text-indigo-700',
  service: 'bg-slate-100 text-slate-700',
};

// Preferred display order for category tabs (matches the business list).
export const CATEGORY_ORDER = [
  'raw', 'packaging', 'finished_meal', 'wip_bulk', 'supplement',
  'package', 'solo_serve', 'sauce', 'bundle', 'service',
];

// Back-compat aliases (some callers still import TYPE_LABELS/TYPE_COLORS).
export const TYPE_LABELS = CATEGORY_LABELS;
export const TYPE_COLORS = CATEGORY_COLORS;

export function getCategoryLabel(type) {
  return CATEGORY_LABELS[type] || type || '—';
}

export function getCategoryColor(type) {
  return CATEGORY_COLORS[type] || 'bg-gray-100 text-gray-700';
}

// Returns a Tailwind bg+text class for a subcategory label, using the brand
// colours already established in mealGrouping/productionGrouping (light shades).
export function getSubcategoryColor(subcategory) {
  const s = subcategory || '';
  if (s.includes('MLM') || s.includes("Men's Lean Muscle"))  return 'bg-green-50 text-green-700';
  if (s.includes('MWL') || s.includes("Men's Weight Loss"))  return 'bg-blue-50 text-blue-700';
  if (s.includes('WLM') || s.includes("Women's Lean Muscle")) return 'bg-orange-50 text-orange-700';
  if (s.includes('WWL') || s.includes("Women's Weight Loss")) return 'bg-pink-50 text-pink-700';
  if (s.includes('Low Carb') || s.includes('Smart Carb'))    return 'bg-yellow-50 text-yellow-700';
  return null;
}

// ── Subcategory (= product.subcategory) ────────────────────────────────────
// Predefined valid subcategories per category. Used for grouping order and as
// the bulk-edit dropdown options. Auto-detect (getProductSubcategory) remains
// the fallback for products without a stored subcategory.
export const SUBCATEGORIES_BY_CATEGORY = {
  raw: [
    'Meats', 'Vegetables', 'Starches', 'Spices & Seasoning',
    'Sauces & Condiments', 'Dairy & Eggs', 'Oils & Fats',
    'Dry Goods', 'Packaging', 'Other',
  ],
  packaging: [
    "Women's Lean Muscle Sleeves (WLM)",
    "Women's Weight Loss Sleeves (WWL)",
    "Men's Lean Muscle Sleeves (MLM)",
    "Men's Weight Loss / BYO Sleeves (MWL)",
    'Other Packaging',
  ],
  finished_meal: [
    'Low Carb Meals',
    "Men's Lean Muscle Meals (MLM)",
    "Men's Weight Loss / BYO Meals (MWL)",
    "Women's Lean Muscle Meals (WLM)",
    "Women's Weight Loss Meals (WWL)",
    'Other Meals',
  ],
  wip_bulk: ['Meats', 'Starches', 'Vegetables', 'Sauces', 'Stir-Fry & Mixed', 'Other'],
  supplement: [
    'Super Greens + Gut Support', 'Slim Shake', 'Protein Water',
    'Protein Porridge', 'Everyday Energy', 'Collagen', 'Nut Butters',
    'Creatine', 'Protein', 'Other Supplements',
  ],
  package: [
    'Low Carb Packages',
    "Men's Lean Muscle Packages",
    "Men's Weight Loss Packages",
    "Women's Lean Muscle Packages",
    "Women's Weight Loss Packages",
    'Build Your Own (BYO)',
    'Other Packages',
  ],
  sauce: ['Other'],
  solo_serve: ['Other'],
  bundle: ['Other'],
  service: ['Other'],
};

// Normalises known legacy free-text `category` values onto a predefined
// subcategory (used during backfill / display normalisation only).
export const LEGACY_SUBCATEGORY_MAP = {
  'smart carb': 'Low Carb Meals',
  'low carb': 'Low Carb Meals',
};

export function getSubcategoriesForCategory(type) {
  return SUBCATEGORIES_BY_CATEGORY[type] || ['Other'];
}

/**
 * Resolve the Subcategory to display for a product.
 * Priority: stored subcategory → legacy-mapped value → auto-detect → 'Other'.
 * Never reads the legacy `category` field for display directly.
 */
export function resolveSubcategory(product) {
  if (!product) return 'Other';
  const stored = (product.subcategory || '').trim();
  if (stored) {
    const mapped = LEGACY_SUBCATEGORY_MAP[stored.toLowerCase()];
    return mapped || stored;
  }
  const auto = getProductSubcategory(product);
  if (auto) return auto;
  return 'Other';
}

/**
 * Sort comparator for subcategory group names: predefined order first
 * (following SUBCATEGORIES_BY_CATEGORY), then alphabetical, with any
 * "Other"-style group pushed last.
 */
export function makeSubcategorySorter(type, customOrder) {
  const order = (customOrder && customOrder.length) ? customOrder : (SUBCATEGORIES_BY_CATEGORY[type] || []);
  const index = (name) => {
    const i = order.indexOf(name);
    return i === -1 ? Number.MAX_SAFE_INTEGER : i;
  };
  return (a, b) => {
    const aOther = /^other/i.test(a);
    const bOther = /^other/i.test(b);
    if (aOther && !bOther) return 1;
    if (bOther && !aOther) return -1;
    const ia = index(a);
    const ib = index(b);
    if (ia !== ib) return ia - ib;
    return a.localeCompare(b);
  };
}
