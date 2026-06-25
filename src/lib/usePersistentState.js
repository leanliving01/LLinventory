import { useState, useEffect } from 'react';

/**
 * Like useState, but the value survives navigation/remount within the same
 * browser session (sessionStorage). Use it for list/filter UI state so that
 * navigating into a detail page and pressing "back" returns the user to the
 * exact view they left — active tab, search, expanded groups, etc.
 *
 * Scoped to sessionStorage (not localStorage) on purpose: the state should
 * persist while the user is working but reset on a fresh visit / new tab.
 *
 * @param {string} key      unique storage key (namespace per page, e.g. "catalog:typeFilter")
 * @param {*}      fallback default value when nothing is stored yet
 */
export function usePersistentState(key, fallback) {
  const [value, setValue] = useState(() => {
    try {
      const raw = sessionStorage.getItem(key);
      return raw != null ? JSON.parse(raw) : fallback;
    } catch {
      return fallback;
    }
  });

  useEffect(() => {
    try {
      sessionStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* storage full / unavailable — non-fatal */
    }
  }, [key, value]);

  return [value, setValue];
}

/**
 * Remember and restore the window scroll position for a page across navigation.
 * Call once near the top of a page component. Restoration waits until `ready`
 * is true (e.g. data finished loading) so the page is tall enough to scroll.
 *
 * @param {string}  key   unique storage key, e.g. "catalog:scroll"
 * @param {boolean} ready when the content is rendered and the page can scroll
 */
export function useScrollRestoration(key, ready = true) {
  // Save scroll position continuously.
  useEffect(() => {
    const onScroll = () => {
      try { sessionStorage.setItem(key, String(window.scrollY)); } catch { /* noop */ }
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [key]);

  // Restore once the content is ready (next frame, so layout is settled).
  useEffect(() => {
    if (!ready) return;
    let raw;
    try { raw = sessionStorage.getItem(key); } catch { raw = null; }
    if (raw == null) return;
    const y = parseInt(raw, 10);
    if (!Number.isFinite(y) || y <= 0) return;
    const id = requestAnimationFrame(() => window.scrollTo(0, y));
    return () => cancelAnimationFrame(id);
  }, [key, ready]);
}
