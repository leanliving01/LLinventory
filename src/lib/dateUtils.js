/**
 * Central date formatting utility — always renders in Africa/Johannesburg (SAST = UTC+2).
 * South Africa does not observe daylight saving, so the offset is always +2 hours.
 *
 * We manually apply the +2h offset rather than relying on Intl timeZone support,
 * which some browser/iframe environments handle inconsistently.
 */

const SAST_OFFSET_MS = 2 * 60 * 60 * 1000; // +2 hours in milliseconds

/**
 * Convert any date input to a Date object shifted to SAST.
 * The returned Date's UTC methods will give SAST values.
 */
function toSAST(date) {
  if (!date) return null;
  const d = typeof date === 'string' ? new Date(date) : date;
  if (isNaN(d.getTime())) return null;
  return new Date(d.getTime() + SAST_OFFSET_MS);
}

function pad(n) { return String(n).padStart(2, '0'); }

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * Full precision — e.g. "02 May 2026, 18:52:47"
 */
export function formatFullSAST(date) {
  const d = toSAST(date);
  if (!d) return '—';
  return `${pad(d.getUTCDate())} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}, ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}

/**
 * Short date + time without seconds — e.g. "02 May 2026, 18:52"
 */
export function formatDateTimeSAST(date) {
  const d = toSAST(date);
  if (!d) return '—';
  return `${pad(d.getUTCDate())} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}, ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

/**
 * Short date only (no time) — e.g. "02 May 2026"
 */
export function formatDateSAST(date) {
  const d = toSAST(date);
  if (!d) return '—';
  return `${pad(d.getUTCDate())} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/**
 * Time only — e.g. "18:52"
 */
export function formatTimeSAST(date) {
  const d = toSAST(date);
  if (!d) return '—';
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

/**
 * Legacy generic formatter — kept for backward compat but now uses manual SAST shift.
 */
export function formatSAST(date, opts = {}) {
  // If caller passes custom Intl opts, fall back to Intl with explicit timeZone
  const d = typeof date === 'string' ? new Date(date) : date;
  if (!d || isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-ZA', {
    timeZone: 'Africa/Johannesburg',
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    ...opts,
  });
}