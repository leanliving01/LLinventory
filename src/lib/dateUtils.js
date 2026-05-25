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
  let input = date;
  // Normalize ISO strings: trim microsecond precision (>3 decimals) which some
  // JS engines can't parse, and ensure a timezone suffix is present.
  if (typeof input === 'string') {
    // Replace 4-6 digit fractional seconds with 3-digit milliseconds
    input = input.replace(/(\.\d{3})\d+/, '$1');
    // If the string has no timezone indicator, assume UTC
    if (!/[Zz]|[+-]\d{2}:\d{2}$/.test(input)) {
      input += 'Z';
    }
  }
  const d = typeof input === 'string' ? new Date(input) : input;
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
 * Legacy generic formatter — now uses the same manual UTC+2 shift
 * instead of relying on Intl timeZone support (inconsistent in sandbox iframes).
 */
export function formatSAST(date) {
  return formatFullSAST(date);
}