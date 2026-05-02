/**
 * Central date formatting utility — always renders in Africa/Johannesburg timezone.
 * Use these helpers instead of raw date-fns format() to ensure consistent SA times.
 */

const TZ = 'Africa/Johannesburg';

/**
 * Format a date string/Date to a display string in SA timezone.
 * @param {string|Date} date - ISO string or Date object
 * @param {object} opts - Intl.DateTimeFormat options override
 * @returns {string} formatted date string in SAST
 */
export function formatSAST(date, opts = {}) {
  if (!date) return '—';
  const d = typeof date === 'string' ? new Date(date) : date;
  if (isNaN(d.getTime())) return '—';

  const defaults = {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    timeZone: TZ,
  };

  return new Intl.DateTimeFormat('en-ZA', { ...defaults, ...opts }).format(d);
}

/**
 * Short date only (no time) in SA timezone — e.g. "02 May 2026"
 */
export function formatDateSAST(date) {
  return formatSAST(date, { hour: undefined, minute: undefined, second: undefined });
}

/**
 * Short date + time without seconds — e.g. "02 May 2026, 18:18"
 */
export function formatDateTimeSAST(date) {
  return formatSAST(date, { second: undefined });
}

/**
 * Full precision — e.g. "02 May 2026, 18:18:45"
 */
export function formatFullSAST(date) {
  return formatSAST(date);
}

/**
 * Time only in SA timezone — e.g. "18:18"
 */
export function formatTimeSAST(date) {
  return formatSAST(date, {
    year: undefined,
    month: undefined,
    day: undefined,
    second: undefined,
  });
}