// Shared constants and grouping utilities for the meal-centric table layout

export const PACKAGE_TYPES = ['MWL', 'MLM', 'WLM', 'WWL', 'LOW_CARB'];

export const PACKAGE_LABELS = {
  MWL: "Men's WL",
  MLM: "Men's LM",
  WLM: "Women's LM",
  WWL: "Women's WL",
  LOW_CARB: "Low Carb",
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