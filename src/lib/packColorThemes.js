/**
 * Centralized pack color theme config.
 * Each theme defines classes for:
 *  - header bg/border (the group heading)
 *  - item border accent (the meal cards)
 *  - badge styling
 *  - icon color
 *
 * All use design-token-compatible Tailwind classes.
 * Dark mode is handled via dark: variants.
 */

const PACK_COLOR_THEMES = {
  green: {
    label: 'Green',
    dot: 'bg-emerald-500',
    headerBg: 'bg-emerald-50 dark:bg-emerald-900/20',
    headerBorder: 'border-emerald-300 dark:border-emerald-700',
    headerText: 'text-emerald-700 dark:text-emerald-300',
    itemBorder: 'border-emerald-200 dark:border-emerald-800',
    itemBg: 'bg-emerald-50/50 dark:bg-emerald-900/10',
    badgeBg: 'bg-emerald-100 dark:bg-emerald-900/30',
    badgeText: 'text-emerald-700 dark:text-emerald-300',
    icon: 'text-emerald-600 dark:text-emerald-400',
    progressBar: 'bg-emerald-500',
  },
  blue: {
    label: 'Blue',
    dot: 'bg-blue-500',
    headerBg: 'bg-blue-50 dark:bg-blue-900/20',
    headerBorder: 'border-blue-300 dark:border-blue-700',
    headerText: 'text-blue-700 dark:text-blue-300',
    itemBorder: 'border-blue-200 dark:border-blue-800',
    itemBg: 'bg-blue-50/50 dark:bg-blue-900/10',
    badgeBg: 'bg-blue-100 dark:bg-blue-900/30',
    badgeText: 'text-blue-700 dark:text-blue-300',
    icon: 'text-blue-600 dark:text-blue-400',
    progressBar: 'bg-blue-500',
  },
  pink: {
    label: 'Pink',
    dot: 'bg-pink-500',
    headerBg: 'bg-pink-50 dark:bg-pink-900/20',
    headerBorder: 'border-pink-300 dark:border-pink-700',
    headerText: 'text-pink-700 dark:text-pink-300',
    itemBorder: 'border-pink-200 dark:border-pink-800',
    itemBg: 'bg-pink-50/50 dark:bg-pink-900/10',
    badgeBg: 'bg-pink-100 dark:bg-pink-900/30',
    badgeText: 'text-pink-700 dark:text-pink-300',
    icon: 'text-pink-600 dark:text-pink-400',
    progressBar: 'bg-pink-500',
  },
  orange: {
    label: 'Orange',
    dot: 'bg-orange-500',
    headerBg: 'bg-orange-50 dark:bg-orange-900/20',
    headerBorder: 'border-orange-300 dark:border-orange-700',
    headerText: 'text-orange-700 dark:text-orange-300',
    itemBorder: 'border-orange-200 dark:border-orange-800',
    itemBg: 'bg-orange-50/50 dark:bg-orange-900/10',
    badgeBg: 'bg-orange-100 dark:bg-orange-900/30',
    badgeText: 'text-orange-700 dark:text-orange-300',
    icon: 'text-orange-600 dark:text-orange-400',
    progressBar: 'bg-orange-500',
  },
  purple: {
    label: 'Purple',
    dot: 'bg-purple-500',
    headerBg: 'bg-purple-50 dark:bg-purple-900/20',
    headerBorder: 'border-purple-300 dark:border-purple-700',
    headerText: 'text-purple-700 dark:text-purple-300',
    itemBorder: 'border-purple-200 dark:border-purple-800',
    itemBg: 'bg-purple-50/50 dark:bg-purple-900/10',
    badgeBg: 'bg-purple-100 dark:bg-purple-900/30',
    badgeText: 'text-purple-700 dark:text-purple-300',
    icon: 'text-purple-600 dark:text-purple-400',
    progressBar: 'bg-purple-500',
  },
  teal: {
    label: 'Teal',
    dot: 'bg-teal-500',
    headerBg: 'bg-teal-50 dark:bg-teal-900/20',
    headerBorder: 'border-teal-300 dark:border-teal-700',
    headerText: 'text-teal-700 dark:text-teal-300',
    itemBorder: 'border-teal-200 dark:border-teal-800',
    itemBg: 'bg-teal-50/50 dark:bg-teal-900/10',
    badgeBg: 'bg-teal-100 dark:bg-teal-900/30',
    badgeText: 'text-teal-700 dark:text-teal-300',
    icon: 'text-teal-600 dark:text-teal-400',
    progressBar: 'bg-teal-500',
  },
};

/** Default (neutral) theme when no color is assigned */
const DEFAULT_THEME = {
  label: 'Default',
  dot: 'bg-muted-foreground',
  headerBg: 'bg-muted/50',
  headerBorder: 'border-border',
  headerText: 'text-foreground',
  itemBorder: 'border-border',
  itemBg: 'bg-card',
  badgeBg: 'bg-muted',
  badgeText: 'text-muted-foreground',
  icon: 'text-primary',
  progressBar: 'bg-primary',
};

/** "Done" override — always green regardless of original theme */
const DONE_THEME = {
  headerBg: 'bg-green-50 dark:bg-green-900/20',
  headerBorder: 'border-green-200 dark:border-green-800',
  headerText: 'text-green-700 dark:text-green-300',
  itemBorder: 'border-green-200 dark:border-green-800',
  itemBg: 'bg-green-50 dark:bg-green-900/20',
  badgeBg: 'bg-green-100',
  badgeText: 'text-green-700',
  icon: 'text-green-600',
};

export function getPackTheme(colorKey) {
  return PACK_COLOR_THEMES[colorKey] || DEFAULT_THEME;
}

export function getPackThemeOrDone(colorKey, isDone) {
  if (isDone) return { ...getPackTheme(colorKey), ...DONE_THEME };
  return getPackTheme(colorKey);
}

export { PACK_COLOR_THEMES, DEFAULT_THEME, DONE_THEME };