// ---------------------------------------------------------------------------
// Profit visual language — shared margin tiers, colours and package labels for
// the Order Profitability dashboard. One source of truth so the meal-box gauge,
// charts and tables all speak the same colour story.
// ---------------------------------------------------------------------------

// Friendly names for the package_family enum (MWL/MLM/WWL/WLM/LOW_CARB/BYO).
export const PACKAGE_LABELS = {
  MWL: "Men's Weight Loss",
  MLM: "Men's Lean Muscle",
  WWL: "Women's Weight Loss",
  WLM: "Women's Lean Muscle",
  LOW_CARB: 'Low Carb',
  BYO: 'Build Your Own',
  STANDALONE: 'Standalone Items',
  OTHER: 'Other Packages',
};

export function packageLabel(key) {
  return PACKAGE_LABELS[key] || key || '—';
}

// Margin tiers — the "how healthy is this profit" ladder.
// Tuned for a meal-prep business where a healthy gross margin sits ~45-55%.
export function marginTier(margin) {
  const m = Number(margin) || 0;
  if (m >= 50) return 'excellent';
  if (m >= 35) return 'good';
  if (m >= 20) return 'ok';
  if (m >= 0) return 'low';
  return 'loss';
}

export const TIER = {
  excellent: { color: '#16a34a', glow: '#22c55e', label: 'Excellent', emoji: '🔥' },
  good: { color: '#22c55e', glow: '#4ade80', label: 'Healthy', emoji: '✅' },
  ok: { color: '#eab308', glow: '#facc15', label: 'Okay', emoji: '🟡' },
  low: { color: '#f97316', glow: '#fb923c', label: 'Thin', emoji: '⚠️' },
  loss: { color: '#ef4444', glow: '#f87171', label: 'Losing', emoji: '🔻' },
};

export function marginColor(margin) {
  return TIER[marginTier(margin)].color;
}

export function tierMeta(margin) {
  return TIER[marginTier(margin)];
}

// The "fill" the meal-box gauge shows. The user's mental model: 50% margin = a
// box filled halfway; a great margin overflows. We map margin% straight to a
// fill fraction (0..1), and flag overflow above a healthy threshold so a
// thriving product literally bubbles over the top.
export const OVERFLOW_MARGIN = 55;

export function fillFraction(margin) {
  const m = Number(margin) || 0;
  return Math.max(0, Math.min(1, m / 100));
}

export function isOverflowing(margin) {
  return (Number(margin) || 0) >= OVERFLOW_MARGIN;
}
