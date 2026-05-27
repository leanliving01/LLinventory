/**
 * Subcategory options per BOM layer.
 * Used in Recipes page, CreateBomModal, and RecipeDetailDrawer.
 */

export const BOM_SUBCATEGORIES = {
  prep: [
    'Meats',
    'Vegetables',
    'Starches',
    'Sauces & Condiments',
    'Spices & Seasoning',
    'Dairy & Eggs',
    'Other',
  ],
  cook: [
    'Meats',
    'Vegetables',
    'Starches',
    'Sauces & Condiments',
    'Spices & Seasoning',
    'Dairy & Eggs',
    'Other',
  ],
  portion: [
    "Men's Lean Muscle",
    "Men's Weight Loss / BYO",
    "Women's Lean Muscle",
    "Women's Weight Loss",
    'Low Carb',
  ],
  pack: [
    'Goal Based',
    'Low Carb',
    'BYO',
    'Supplement',
    'Bundle',
    'Other',
  ],
};

/**
 * Returns subcategory options for a given BOM type.
 */
export function getSubcategories(bomType) {
  return BOM_SUBCATEGORIES[bomType] || [];
}

/**
 * Parse a comma-separated subcategory string into an array.
 * Handles both legacy single values ("Men's Weight Loss / BYO") and
 * multi values ("Men's Weight Loss / BYO,Low Carb").
 */
export function parseSubcategories(str) {
  if (!str) return [];
  return str.split(',').map(s => s.trim()).filter(Boolean);
}

/** Serialise an array of subcategory strings back to a comma-separated string. */
export function stringifySubcategories(arr) {
  return arr.join(',');
}