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
    'Bundle',
  ],
};

/**
 * Returns subcategory options for a given BOM type.
 */
export function getSubcategories(bomType) {
  return BOM_SUBCATEGORIES[bomType] || [];
}