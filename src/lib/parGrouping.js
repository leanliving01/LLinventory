import {
  resolveSubcategory,
  resolveSubcategoryColor,
  makeSubcategorySorter,
  CATEGORY_LABELS,
  CATEGORY_ORDER,
} from '@/lib/productClassification';

/**
 * Par-level grouping across EVERY product category — not just finished meals.
 *
 * The Par Levels screen used to load only finished_meal products. This groups
 * any product set into Category (product.type) → Subcategory (resolveSubcategory)
 * → products, so supplements, raw materials, packaging, packages, etc. all get
 * par-level rows too. Finished meals still bucket by their package subcategory
 * exactly as before (Winter Warmer and future packages appear automatically),
 * keeping that view unchanged.
 *
 * Returns a flat, ordered array of groups — one per (category, subcategory):
 *   { code, category, categoryLabel, fullLabel, label, color, meals:[{ baseName, product }] }
 * `meals` is the generic item list (named for back-compat with the detail table).
 */

// Per-category fallback hex (subcategories outside the meal palette have no
// keyword colour). Mirrors the muted family used by CATEGORY_COLORS.
const CATEGORY_HEX = {
  raw:           '#d97706', // amber
  packaging:     '#6b7280', // gray
  wip_bulk:      '#ea580c', // orange
  finished_meal: '#16a34a', // green
  supplement:    '#9333ea', // purple
  package:       '#2563eb', // blue
  sauce:         '#dc2626', // red
  solo_serve:    '#db2777', // pink
  bundle:        '#4f46e5', // indigo
  service:       '#475569', // slate
};

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

export function groupProductsForPar(products = [], subcatRows = []) {
  // Stored subcategory colours keyed by lowercased name (any product type).
  const colorMap = {};
  (subcatRows || []).forEach(r => {
    const key = (r.name || '').toLowerCase();
    if (key && r.color) colorMap[key] = r.color;
  });

  // Bucket every active product by Category → Subcategory.
  const buckets = {}; // code → group
  for (const product of products) {
    if (product.status && product.status !== 'active') continue;
    const category = product.type || 'other';
    const subcat = resolveSubcategory(product) || 'Other';
    const code = `${slugify(category)}__${slugify(subcat)}`;
    if (!buckets[code]) {
      buckets[code] = {
        code,
        category,
        categoryLabel: CATEGORY_LABELS[category] || category || 'Other',
        fullLabel: subcat,
        label: subcat,
        color: resolveSubcategoryColor(subcat, colorMap) || CATEGORY_HEX[category] || '#6b7280',
        meals: [],
      };
    }
    const baseName = category === 'finished_meal' ? cleanMealName(product) : (product.name || '');
    buckets[code].meals.push({ baseName, product });
  }

  // Sort items within each group by SKU (natural), then name.
  Object.values(buckets).forEach(g => {
    g.meals.sort((a, b) =>
      (a.product.sku || '').localeCompare(b.product.sku || '', undefined, { numeric: true }) ||
      a.baseName.localeCompare(b.baseName));
  });

  // Order: by Category (CATEGORY_ORDER), then by Subcategory within the category.
  const catRank = (cat) => {
    const i = CATEGORY_ORDER.indexOf(cat);
    return i === -1 ? Number.MAX_SAFE_INTEGER : i;
  };
  const groups = Object.values(buckets);
  groups.sort((a, b) => {
    const ca = catRank(a.category), cb = catRank(b.category);
    if (ca !== cb) return ca - cb;
    if (a.category !== b.category) return a.category.localeCompare(b.category);
    return makeSubcategorySorter(a.category)(a.fullLabel, b.fullLabel);
  });
  return groups;
}

/** Ordered list of categories present in a grouped set, for the nav chips. */
export function categoriesFromGroups(groups = []) {
  const seen = new Map(); // category → label
  groups.forEach(g => { if (!seen.has(g.category)) seen.set(g.category, g.categoryLabel); });
  const catRank = (cat) => {
    const i = CATEGORY_ORDER.indexOf(cat);
    return i === -1 ? Number.MAX_SAFE_INTEGER : i;
  };
  return [...seen.entries()]
    .map(([category, label]) => ({ category, label }))
    .sort((a, b) => catRank(a.category) - catRank(b.category) || a.label.localeCompare(b.label));
}
