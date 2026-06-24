/**
 * Smart subcategorization logic for each product type.
 * Returns a string category name for grouping.
 */

// ── Raw Materials: use pick_category ──
export function getRawSubcategory(product) {
  return product.pick_category || 'Other';
}

// ── Packaging: group by sleeve prefix (WLM, WWL, MLM, MWL) or Other ──
const SLEEVE_PREFIXES = ['WLM', 'WWL', 'MLM', 'MWL'];
const SLEEVE_LABELS = {
  WLM: "Women's Lean Muscle Sleeves (WLM)",
  WWL: "Women's Weight Loss Sleeves (WWL)",
  MLM: "Men's Lean Muscle Sleeves (MLM)",
  MWL: "Men's Weight Loss / BYO Sleeves (MWL)",
};

export function getPackagingSubcategory(product) {
  const sku = (product.sku || '').toUpperCase();
  for (const prefix of SLEEVE_PREFIXES) {
    if (sku.startsWith(prefix)) return SLEEVE_LABELS[prefix];
  }
  return 'Other Packaging';
}

// ── Finished Meals: group by SKU prefix (WLM, WWL, MLM, MWL) ──
const MEAL_LABELS = {
  WLM: "Women's Lean Muscle Meals (WLM)",
  WWL: "Women's Weight Loss Meals (WWL)",
  MLM: "Men's Lean Muscle Meals (MLM)",
  MWL: "Men's Weight Loss / BYO Meals (MWL)",
};

export function getFinishedMealSubcategory(product) {
  const sku = (product.sku || '').toUpperCase();
  for (const prefix of SLEEVE_PREFIXES) {
    if (sku.startsWith(prefix)) return MEAL_LABELS[prefix];
  }
  // Winter Warmer Range (seasonal soups/stews, SKUs WWR1, WWR2, …) — group as
  // its own package so it appears on the production plan without manual tagging.
  if (sku.startsWith('WWR')) return 'Winter Warmer Range';
  // Check name patterns for low carb / smart carb
  const name = (product.name || '').toLowerCase();
  const cat = (product.category || '').toLowerCase();
  if (name.includes('low carb') || name.includes('smart carb') || cat.includes('smart carb') || sku.startsWith('SC') || sku.startsWith('LC')) {
    return 'Low Carb Meals';
  }
  return 'Other Meals';
}

// ── Bulk Cooked (WIP): categorize by ingredient type from name ──
const BULK_KEYWORDS = {
  Meats: ['chicken', 'beef', 'steak', 'mince', 'lamb', 'pork', 'turkey', 'fish', 'salmon', 'hake', 'trinchado', 'cottage pie'],
  Starches: ['rice', 'potato', 'mash', 'pasta', 'noodle', 'couscous'],
  Vegetables: ['veg', 'carrot', 'bean', 'broccoli', 'butternut', 'spinach', 'cauliflower', 'cabbage', 'mushroom', 'pepper', 'onion', 'pumpkin', 'corn', 'zucchini', 'eggplant'],
  Sauces: ['sauce', 'gravy', 'chili', 'curry', 'pesto', 'marinade', 'dressing'],
  'Stir-Fry & Mixed': ['stir-fry', 'stir fry', 'mixed veg', 'medley'],
};

export function getBulkCookedSubcategory(product) {
  const name = (product.name || '').toLowerCase();
  for (const [cat, keywords] of Object.entries(BULK_KEYWORDS)) {
    if (keywords.some(kw => name.includes(kw))) return cat;
  }
  return 'Other';
}

// ── Supplements: group by product family from name ──
export function getSupplementSubcategory(product) {
  const name = (product.name || '').toLowerCase();
  if (name.includes('super greens') || name.includes('gut')) return 'Super Greens + Gut Support';
  if (name.includes('slim shake')) return 'Slim Shake';
  if (name.includes('protein water')) return 'Protein Water';
  if (name.includes('protein porridge') || name.includes('proats')) return 'Protein Porridge';
  if (name.includes('everyday energy') || name.includes('energy')) return 'Everyday Energy';
  if (name.includes('collagen')) return 'Collagen';
  if (name.includes('peanut butter') || name.includes('nut butter')) return 'Nut Butters';
  if (name.includes('creatine')) return 'Creatine';
  if (name.includes('whey') || name.includes('protein')) return 'Protein';
  return 'Other Supplements';
}

// ── Packages: group by package line ──
export function getPackageSubcategory(product) {
  const name = (product.name || '').toLowerCase();
  const sku = (product.sku || '').toUpperCase();
  // Winter Warmer packages (boxes of seasonal soups/stews, SKUs WWR15/30/60).
  // Mirror getFinishedMealSubcategory's WWR rule so the seasonal range self-files
  // on the package side too, regardless of name casing.
  if (sku.startsWith('WWR') || name.includes('winter warmer')) return 'Winter Warmer Packages';
  if (name.includes('low carb') || name.includes('smart carb') || sku.startsWith('SCP')) return 'Low Carb Packages';
  // IMPORTANT: Women's checks MUST come before Men's — "women's lean muscle" contains "men's lean muscle" as substring
  if (name.includes("women's lean muscle") || sku.startsWith('WOMLEAMUS')) return "Women's Lean Muscle Packages";
  if (name.includes("women's weight loss") || sku.startsWith('WOMWEILOS')) return "Women's Weight Loss Packages";
  if (name.includes("men's lean muscle") || sku.startsWith('MENLEAMUS')) return "Men's Lean Muscle Packages";
  if (name.includes("men's weight loss") || sku.startsWith('MENWEILOS')) return "Men's Weight Loss Packages";
  if (name.includes('byo') || name.includes('build your own')) return 'Build Your Own (BYO)';
  return 'Other Packages';
}

/**
 * Master dispatcher — returns the subcategory for a product given its type.
 * Returns null for types that don't have subcategorization.
 */
export function getProductSubcategory(product) {
  switch (product.type) {
    case 'raw': return getRawSubcategory(product);
    case 'packaging': return getPackagingSubcategory(product);
    case 'finished_meal': return getFinishedMealSubcategory(product);
    case 'wip_bulk': return getBulkCookedSubcategory(product);
    case 'supplement': return getSupplementSubcategory(product);
    case 'package': return getPackageSubcategory(product);
    default: return null;
  }
}

// Types that support subcategorization
export const SUBCATEGORIZED_TYPES = ['raw', 'packaging', 'finished_meal', 'wip_bulk', 'supplement', 'package'];