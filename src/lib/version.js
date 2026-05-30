/* global __APP_VERSION__, __BUILD_TIME__ */
// Injected at build time by vite.config.js (define).
export const APP_VERSION = (typeof __APP_VERSION__ !== 'undefined') ? __APP_VERSION__ : 'dev';
export const BUILD_TIME = (typeof __BUILD_TIME__ !== 'undefined') ? __BUILD_TIME__ : '';

// Short, human-friendly build timestamp (e.g. "2026-05-30 14:30")
export function formatBuildTime() {
  if (!BUILD_TIME) return '';
  const d = new Date(BUILD_TIME);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleString('en-ZA', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
    timeZone: 'Africa/Johannesburg',
  });
}
