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

// ── BOM capability (single source of truth) ────────────────────────────────
// Which product categories can carry a manufacturing BOM, and of which class.
//   production BOM  → physically made (prep/cook/portion): raw → WIP → portioned meal.
//   packing BOM     → finished meals assembled & packed into a sellable box.
// Every BOM entry-point surface (ProductCookBomCard, CatalogDetailDrawer,
// Recipes list, RecipeProductDetail) MUST read these instead of keeping its own
// hardcoded type list, so enabling a new produced-in-house category is a
// one-line change here.
export const PRODUCTION_BOM_TYPES = ['wip_bulk', 'sauce', 'finished_meal'];
export const PACKING_BOM_TYPES = ['package', 'bundle'];

export function canHaveProductionBom(type) {
  return PRODUCTION_BOM_TYPES.includes(type);
}

export function canHavePackingBom(type) {
  return PACKING_BOM_TYPES.includes(type);
}

/** Any product category that can carry a manufacturing BOM (production or packing). */
export function canHaveBom(type) {
  return canHaveProductionBom(type) || canHavePackingBom(type);
}

/** The default BOM class to offer when starting a BOM for a given category. */
export function defaultBomClassForType(type) {
  return canHavePackingBom(type) ? 'packing' : 'production';
}

export function getCategoryLabel(type) {
  return CATEGORY_LABELS[type] || type || '—';
}

export function getCategoryColor(type) {
  return CATEGORY_COLORS[type] || 'bg-gray-100 text-gray-700';
}

// Slightly darker background-only classes for count section headers (category level).
// Text colour is always set to text-gray-900 by the caller so the bg is the identity.
export const CATEGORY_HEADER_BG = {
  raw:           'bg-amber-200',
  packaging:     'bg-gray-300',
  wip_bulk:      'bg-orange-200',
  finished_meal: 'bg-green-200',
  supplement:    'bg-purple-200',
  package:       'bg-blue-200',
  sauce:         'bg-red-200',
  solo_serve:    'bg-pink-200',
  bundle:        'bg-indigo-200',
  service:       'bg-slate-200',
};

// Background-only class for subcategory headers in count views (one shade lighter than category).
// Returns null for subcategories that have no special colour.
export function getSubcategoryColor(subcategory) {
  const s = subcategory || '';
  if (s.includes('MLM') || s.includes("Men's Lean Muscle"))   return 'bg-green-100';
  if (s.includes('MWL') || s.includes("Men's Weight Loss"))   return 'bg-blue-100';
  if (s.includes('WLM') || s.includes("Women's Lean Muscle")) return 'bg-orange-100';
  if (s.includes('WWL') || s.includes("Women's Weight Loss")) return 'bg-pink-100';
  if (s.includes('Low Carb') || s.includes('Smart Carb'))     return 'bg-yellow-100';
  if (s.includes('Winter Warmer') || s.includes('WWR'))       return 'bg-sky-100';
  return null;
}

// ── Subcategory display colours (hex) ──────────────────────────────────────
// A subcategory's colour is the identity of a "package" across the app
// (Production Planning cards/sections, catalog group headers, stock-count
// headers). Source of truth: the `color` column on the managed
// product_subcategories row. When unset, fall back to these keyword defaults so
// the familiar palette is preserved out of the box. Case-sensitive substring
// matching mirrors getSubcategoryColor — capitalised full names avoid the
// "women's" ⊃ "men's" collision; code tokens (MLM/MWL/WLM/WWL) are unambiguous.
export function defaultSubcategoryHex(subcategory) {
  const s = subcategory || '';
  if (s.includes('MLM') || s.includes("Men's Lean Muscle"))   return '#22c55e'; // green
  if (s.includes('MWL') || s.includes("Men's Weight Loss"))   return '#3b82f6'; // blue
  if (s.includes('WLM') || s.includes("Women's Lean Muscle")) return '#f97316'; // orange
  if (s.includes('WWL') || s.includes("Women's Weight Loss")) return '#f472b6'; // pink
  if (s.includes('Low Carb') || s.includes('Smart Carb'))     return '#facc15'; // yellow
  if (s.includes('Winter Warmer') || s.includes('WWR'))       return '#0ea5e9'; // sky
  return null;
}

/**
 * Resolve the display hex for a subcategory: stored colour (from a name→hex
 * map built off the managed rows) → keyword default → null. Callers that need a
 * guaranteed colour should `|| '#6b7280'`; callers with their own fallback
 * (e.g. an existing Tailwind class) should keep it when this returns null.
 */
export function resolveSubcategoryColor(subcategory, colorMap = null) {
  const name = (subcategory || '').trim();
  if (!name) return null;
  if (colorMap) {
    const stored = colorMap[name.toLowerCase()];
    if (stored) return stored;
  }
  return defaultSubcategoryHex(name);
}

// Curated swatches offered first in the colour picker (a custom hex is still
// allowed via the native picker).
export const SUBCATEGORY_COLOR_PALETTE = [
  '#3b82f6', '#22c55e', '#f97316', '#f472b6', '#facc15', '#0ea5e9',
  '#ef4444', '#a855f7', '#14b8a6', '#6366f1', '#f59e0b', '#64748b',
];

/** Convert a #rrggbb / #rgb hex to an rgba() string with the given alpha. */
export function hexToRgba(hex, alpha = 1) {
  if (!hex) return null;
  let h = String(hex).replace('#', '').trim();
  if (h.length === 3) h = h.split('').map(c => c + c).join('');
  if (h.length !== 6) return hex;
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
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
    'Low Carb Packaging',
    'Winter Warmer Packaging',
    'Other Packaging',
  ],
  finished_meal: [
    'Low Carb Meals',
    "Men's Lean Muscle Meals (MLM)",
    "Men's Weight Loss / BYO Meals (MWL)",
    "Women's Lean Muscle Meals (WLM)",
    "Women's Weight Loss Meals (WWL)",
    'Winter Warmer Range',
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
    'Winter Warmer Packages',
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
