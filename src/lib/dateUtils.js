/**
 * Central date formatting utility — always renders in Africa/Johannesburg timezone.
 * Use these helpers instead of raw date-fns format() to ensure consistent SA times.
 */

const TZ = 'Africa/Johannesburg';

function toDate(date) {
  if (!date) return null;
  const d = typeof date === 'string' ? new Date(date) : date;
  return isNaN(d.getTime()) ? null : d;
}

/**
 * Full precision — e.g. "02 May 2026, 18:18:45"
 */
export function formatFullSAST(date) {
  const d = toDate(date);
  if (!d) return '—';
  return d.toLocaleString('en-ZA', {
    timeZone: TZ,
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

/**
 * Short date + time without seconds — e.g. "02 May 2026, 18:18"
 */
export function formatDateTimeSAST(date) {
  const d = toDate(date);
  if (!d) return '—';
  return d.toLocaleString('en-ZA', {
    timeZone: TZ,
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

/**
 * Short date only (no time) in SA timezone — e.g. "02 May 2026"
 */
export function formatDateSAST(date) {
  const d = toDate(date);
  if (!d) return '—';
  return d.toLocaleDateString('en-ZA', {
    timeZone: TZ,
    year: 'numeric',
    month: 'short',
    day: '2-digit',
  });
}

/**
 * Time only in SA timezone — e.g. "18:18"
 */
export function formatTimeSAST(date) {
  const d = toDate(date);
  if (!d) return '—';
  return d.toLocaleTimeString('en-ZA', {
    timeZone: TZ,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

/**
 * Generic formatter with explicit options (legacy compat).
 */
export function formatSAST(date, opts = {}) {
  const d = toDate(date);
  if (!d) return '—';
  // Filter out undefined values from opts
  const clean = { timeZone: TZ };
  const defaults = {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  };
  const merged = { ...defaults, ...opts };
  for (const [k, v] of Object.entries(merged)) {
    if (v !== undefined) clean[k] = v;
  }
  clean.timeZone = TZ; // never allow override
  return d.toLocaleString('en-ZA', clean);
}