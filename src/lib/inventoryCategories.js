/**
 * Dashboard category grouping for the Inventory Dashboard.
 *
 * Product `type` values are technical (finished_meal, supplement, packaging,
 * raw, sauce, wip_bulk…). The dashboard rolls them up into a handful of
 * human groups that each get their own section / colour / chart.
 */

export const CATEGORY_GROUPS = [
  {
    key: 'meals',
    label: 'Ready-Made Meals',
    short: 'Meals',
    types: ['finished_meal'],
    // chart colour (hsl var index) + tailwind accent
    chart: 'hsl(var(--chart-1))',
    accent: 'text-emerald-600',
    dot: 'bg-emerald-500',
  },
  {
    key: 'supplements',
    label: 'Supplements',
    short: 'Supplements',
    types: ['supplement'],
    chart: 'hsl(var(--chart-2))',
    accent: 'text-sky-600',
    dot: 'bg-sky-500',
  },
  {
    key: 'raw',
    label: 'Raw Ingredients',
    short: 'Raw',
    // Not all tracked yet — but ready for when they are.
    types: ['raw', 'raw_material', 'ingredient', 'sauce', 'wip_bulk'],
    chart: 'hsl(var(--chart-3))',
    accent: 'text-amber-600',
    dot: 'bg-amber-500',
  },
  {
    key: 'packaging',
    label: 'Packaging',
    short: 'Packaging',
    types: ['packaging'],
    chart: 'hsl(var(--chart-4))',
    accent: 'text-violet-600',
    dot: 'bg-violet-500',
  },
];

/** The "All" pseudo-group used by the tabs. */
export const ALL_GROUP = { key: 'all', label: 'All Inventory', short: 'All', types: null };

/** Find the group a product type belongs to (or null). */
export function groupForType(type) {
  return CATEGORY_GROUPS.find((g) => g.types?.includes(type)) || null;
}

/** Resolve a group key → group object (defaults to ALL_GROUP). */
export function getGroup(key) {
  if (!key || key === 'all') return ALL_GROUP;
  return CATEGORY_GROUPS.find((g) => g.key === key) || ALL_GROUP;
}

/**
 * Does a product type match the selected group's type list?
 * `types == null` (the All group) matches everything.
 */
export function typeInGroup(type, types) {
  if (!types || types.length === 0) return true;
  return types.includes(type);
}
