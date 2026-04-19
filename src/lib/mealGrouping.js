// Shared constants and grouping utilities for the meal-centric table layout

// Goal-related package types (shown in goal-related table)
export const GOAL_PACKAGE_TYPES = ['MWL', 'MLM', 'WLM', 'WWL'];

// Low carb package type (shown in low carb table)
export const LOW_CARB_PACKAGE_TYPES = ['LOW_CARB'];

// All package types combined
export const PACKAGE_TYPES = [...GOAL_PACKAGE_TYPES, ...LOW_CARB_PACKAGE_TYPES];

// Short abbreviation labels
export const PACKAGE_LABELS = {
  MWL: 'MWL',
  MLM: 'MLM',
  WLM: 'WLM',
  WWL: 'WWL',
  LOW_CARB: 'LC',
};

// Brand colors per package type (bg, text, border for header styling)
export const PACKAGE_COLORS = {
  MWL: { bg: 'bg-blue-500', text: 'text-white', light: 'bg-blue-50', lightText: 'text-blue-700', border: 'border-blue-200' },
  MLM: { bg: 'bg-green-500', text: 'text-white', light: 'bg-green-50', lightText: 'text-green-700', border: 'border-green-200' },
  WLM: { bg: 'bg-orange-500', text: 'text-white', light: 'bg-orange-50', lightText: 'text-orange-700', border: 'border-orange-200' },
  WWL: { bg: 'bg-pink-400', text: 'text-white', light: 'bg-pink-50', lightText: 'text-pink-700', border: 'border-pink-200' },
  LOW_CARB: { bg: 'bg-yellow-400', text: 'text-yellow-900', light: 'bg-yellow-50', lightText: 'text-yellow-700', border: 'border-yellow-200' },
};

/**
 * Groups SKUs by meal_name. Returns an array of { mealName, mealId, familyType, skusByType }
 * where skusByType is { MWL: sku, MLM: sku, ... }
 */
export function groupSkusByMeal(skus, meals = []) {
  const mealMap = {};

  skus.forEach(sku => {
    if (sku.is_active === false) return;
    const key = sku.meal_name || 'Unknown';
    if (!mealMap[key]) {
      const meal = meals.find(m => m.id === sku.meal_id);
      mealMap[key] = {
        mealName: key,
        mealId: sku.meal_id,
        familyType: meal?.family_type || 'goal_related',
        skusByType: {},
      };
    }
    mealMap[key].skusByType[sku.package_type] = sku;
  });

  return Object.values(mealMap).sort((a, b) => a.mealName.localeCompare(b.mealName));
}