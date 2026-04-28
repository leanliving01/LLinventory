/**
 * Universal KPI status classifier.
 * Returns 'good' | 'warn' | 'bad' | 'neutral'
 *
 * Usage:
 *   getKpiStatus(value, { good: v => v > 95, warn: v => v > 80 })
 *   getKpiStatus(value, 'lowStockCount')   // built-in preset
 *
 * When a string preset name is passed, uses built-in thresholds.
 */

const PRESETS = {
  // Lower is better
  lowStockCount: { good: v => v === 0, warn: v => v <= 3 },
  wastagePercent: { good: v => v < 3, warn: v => v < 5 },
  wastageValue: { good: v => v === 0, warn: v => v < 500 },

  // Higher is better
  productionThroughput: { good: v => v >= 95, warn: v => v >= 80 },
  onTimeDelivery: { good: v => v >= 95, warn: v => v >= 90 },
  fulfillmentLag: { good: v => v < 12, warn: v => v < 24 },

  // Specific
  pendingOrders: { good: v => v <= 5, warn: v => v <= 15 },
  poOutstanding: { good: v => v === 0, warn: v => v < 10000 },
  committedVsOnHand: { good: v => v < 0.8, warn: v => v < 1.0 },
  parCoverage: { good: v => v > 3, warn: v => v > 1 },
  revenue: { good: () => true }, // Revenue is always "good" — it's informational
  poSpend: { good: () => true },
  productionRuns: { good: () => true },
  activeProducts: { good: () => true },
};

export default function getKpiStatus(value, rules) {
  if (typeof rules === 'string') {
    rules = PRESETS[rules];
  }
  if (!rules) return 'neutral';

  const num = typeof value === 'number' ? value : parseFloat(value) || 0;

  if (rules.good && rules.good(num)) return 'good';
  if (rules.warn && rules.warn(num)) return 'warn';
  return 'bad';
}

export const STATUS_COLORS = {
  good: {
    bg: 'bg-status-good-subtle',
    text: 'text-status-good',
    border: 'border-status-good',
    icon: 'text-status-good',
    dot: 'bg-status-good',
  },
  warn: {
    bg: 'bg-status-warn-subtle',
    text: 'text-status-warn',
    border: 'border-status-warn',
    icon: 'text-status-warn',
    dot: 'bg-status-warn',
  },
  bad: {
    bg: 'bg-status-bad-subtle',
    text: 'text-status-bad',
    border: 'border-status-bad',
    icon: 'text-status-bad',
    dot: 'bg-status-bad',
  },
  info: {
    bg: 'bg-status-info-subtle',
    text: 'text-status-info',
    border: 'border-status-info',
    icon: 'text-status-info',
    dot: 'bg-status-info',
  },
  neutral: {
    bg: 'bg-muted',
    text: 'text-muted-foreground',
    border: 'border-border',
    icon: 'text-muted-foreground',
    dot: 'bg-muted-foreground',
  },
};